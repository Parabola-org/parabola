#!/usr/bin/env node
// End-to-end smoke test against live Arc and Stellar testnets. Unlike the
// mocked unit tests in tests/, this exercises the real depositForBurn /
// receiveMessage / mint_and_forward calls and waits on real Iris attestations.
//
// Requires funded testnet keys (see .env.example, fund via
// https://faucet.circle.com) and a built package (`pnpm build` first), since
// this imports from dist/, not src/, so it also catches bundling regressions
// that unit tests against src/ can't see.
//
// Not run in the default CI workflow: it needs funded secrets and takes
// 20s-5min per transfer depending on speed. Run manually, or wire into a
// workflow_dispatch job once ARC_PRIVATE_KEY / STELLAR_SECRET_KEY exist as
// repo secrets.
//
// The run is decomposed into named steps (precheck, burn+attest, mint) with
// per-step retry/backoff for infrastructure-shaped failures only — a public
// testnet flake should not read as a broken SDK, and a deterministic failure
// should not retry. The summary table at the end reports every step's status
// and duration, and the exit code reflects the overall outcome.

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@stellar/stellar-sdk";
import {
  transfer,
  completeMint,
  checkStellarRecipientReady,
  arcMainnetChain,
  arcTestnetChain,
  TransferError,
  SubmissionTimeoutError,
  IrisRequestError,
} from "../dist/index.js";

const ARC_PRIVATE_KEY = process.env.ARC_PRIVATE_KEY;
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY;

// Defaults to testnet. Set NETWORK=mainnet to smoke against mainnet, which
// moves real USDC and spends real Arc gas on every case below.
const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const STELLAR_RPC_URL = process.env.STELLAR_RPC_URL;

// Amount burned per case, in USDC. Override with SMOKE_AMOUNT to test with less
// on mainnet (for example SMOKE_AMOUNT=0.10).
const SMOKE_AMOUNT = process.env.SMOKE_AMOUNT ?? "1.00";

// Which leg(s) to run, named by source chain. Set FROM=arc to run only arc -> stellar
// or FROM=stellar to run only stellar -> arc (useful for a first mainnet run that
// validates the full burn, attest, and mint path with one transfer before committing
// the second). Anything else runs both.
const FROM = process.env.FROM ?? "both";

// Retry policy for transient infrastructure failures (testnet RPC 5xx, faucet/
// rate-limit flakes, Iris still indexing). Deterministic failures never retry.
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 5_000;

const isRetryable = (error) => {
  if (error instanceof IrisRequestError) return true;
  if (error instanceof SubmissionTimeoutError) return true;
  if (error instanceof TransferError) return true; // post-burn: attestation wait or mint hiccup
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONN|ETIMEDOUT|socket hangup|5\d\d|429|rate.?limit/i.test(message)
    || (error instanceof Error && error.name === "StellarRpcError");
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!ARC_PRIVATE_KEY || !STELLAR_SECRET_KEY) {
  console.error(
    "Missing ARC_PRIVATE_KEY and/or STELLAR_SECRET_KEY.\n" +
      "Fund testnet accounts at https://faucet.circle.com, copy .env.example to .env, " +
      "fill in both keys, then export them in your shell (or, on Node 20.6+, run with " +
      "`node --env-file=.env scripts/testnet-smoke.mjs`) before re-running `pnpm smoke`.",
  );
  process.exit(1);
}

const arcChain = NETWORK === "mainnet" ? arcMainnetChain : arcTestnetChain;
const arcAccount = privateKeyToAccount(ARC_PRIVATE_KEY);
const arcSigner = {
  walletClient: createWalletClient({ account: arcAccount, chain: arcChain, transport: http() }),
};

const stellarKeypair = Keypair.fromSecret(STELLAR_SECRET_KEY);
const stellarSigner = { publicKey: stellarKeypair.publicKey(), keypair: stellarKeypair };

const summary = [];

function recoverable(error, params) {
  // Whatever the step, a post-burn failure keeps the hash — print it loudly so
  // a human can finish the transfer by hand instead of the handle being lost.
  const burnTxHash = error instanceof TransferError ? error.burnTxHash
    : error instanceof SubmissionTimeoutError ? error.hash : undefined;
  if (!burnTxHash) return;
  console.error(`  burnTxHash: ${burnTxHash}`);
  if (error instanceof TransferError && error.attestationHash) {
    console.error(`  attestationHash: ${error.attestationHash}`);
  }
  console.error(
    "  Recover with completeMint(" +
      JSON.stringify(
        {
          from: params.from,
          to: params.to,
          network: params.network,
          burnTxHash,
          signer: "<destination-chain signer>",
        },
        null,
        2,
      ) +
      ")",
  );
}

async function runStep(caseName, stepName, params, fn) {
  let attempt = 0;
  const start = Date.now();
  for (;;) {
    attempt += 1;
    try {
      const out = await fn(attempt);
      summary.push({ case: caseName, step: stepName, status: "PASS", ms: Date.now() - start, attempts: attempt });
      return out;
    } catch (error) {
      if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        console.log(
          `  retry ${attempt}/${MAX_ATTEMPTS - 1} for ${stepName}: ` +
            `${error instanceof Error ? error.message : error} — waiting ${delay / 1000}s`,
        );
        await sleep(delay);
        continue;
      }
      summary.push({ case: caseName, step: stepName, status: "FAIL", ms: Date.now() - start, attempts: attempt });
      recoverable(error, params);
      throw error;
    }
  }
}

async function runCase(name, params) {
  console.log(`\n--- ${name} ---`);
  const { destinationSigner, ...transferOptions } = params.options ?? {};
  try {
    await runStep(name, "precheck", params, async () => {
      if (params.to === "stellar") {
        const status = await checkStellarRecipientReady(params.recipient, params.network, STELLAR_RPC_URL);
        if (!status.ready) {
          throw new Error(
            `Stellar recipient not ready: ${JSON.stringify(status)} — fund the account and add the USDC trustline`,
          );
        }
      }
      // Arc destinations carry no on-chain precheck here; the address format is
      // validated by the transfer itself.
    });

    // The burn + attestation window: transfer() without destinationSigner stops
    // at "pending" once the burn is attested, which keeps the two remote-wait
    // stages on one retryable step and hands the hash to the mint step.
    const pending = await runStep(name, "burn+attest", params, () =>
      transfer({
        ...params,
        options: { ...transferOptions, stellarRpcUrl: STELLAR_RPC_URL },
      }),
    );
    if (pending.status !== "pending" && pending.status !== "success") {
      throw new Error(`expected pending/success from burn+attest, got "${pending.status}"`);
    }
    console.log(`  burnTxHash: ${pending.burnTxHash}`);

    await runStep(name, "mint", params, () =>
      completeMint({
        from: params.from,
        to: params.to,
        network: params.network,
        burnTxHash: pending.burnTxHash,
        signer: destinationSigner,
      }),
    );
  } catch (error) {
    console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error);
    return false;
  }
  return true;
}

console.log(`Running smoke cases against ${NETWORK}.`);
if (NETWORK === "mainnet") {
  console.log("WARNING: mainnet moves real USDC and spends real Arc gas.");
}

let failures = 0;

if (FROM === "arc" || FROM === "both") {
  const ok = await runCase("arc -> stellar (standard)", {
    from: "arc",
    to: "stellar",
    amount: SMOKE_AMOUNT,
    recipient: stellarKeypair.publicKey(),
    speed: "standard",
    signer: arcSigner,
    network: NETWORK,
    options: { destinationSigner: stellarSigner },
  });
  if (!ok) failures++;
}

if (FROM === "stellar" || FROM === "both") {
  const ok = await runCase("stellar -> arc (standard)", {
    from: "stellar",
    to: "arc",
    amount: SMOKE_AMOUNT,
    recipient: arcAccount.address,
    speed: "standard",
    signer: stellarSigner,
    network: NETWORK,
    options: { destinationSigner: arcSigner },
  });
  if (!ok) failures++;
}

console.log("\n=== Step summary ===");
for (const row of summary) {
  console.log(
    `${row.status === "PASS" ? "PASS" : "FAIL"}  ${row.case} / ${row.step} ` +
      `(${row.ms}ms, ${row.attempts} attempt${row.attempts === 1 ? "" : "s"})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} smoke test case(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke test cases passed.");
