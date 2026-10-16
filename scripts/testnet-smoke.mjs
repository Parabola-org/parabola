#!/usr/bin/env node
// End-to-end smoke test against live Arc and Stellar testnets.
// Exercises real depositForBurn / receiveMessage / mint_and_forward calls
// and waits on real Iris attestations.
//
// Requires funded testnet keys (see .env.example, fund via
// https://faucet.circle.com) and a built package (`pnpm build` first), since
// this imports from dist/, not src/, catching bundling regressions.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@stellar/stellar-sdk";
import {
  transfer,
  completeMint,
  getAttestation,
  checkStellarRecipientReady,
  arcMainnetChain,
  arcTestnetChain,
  TransferError,
  AttestationNotReadyError,
  IrisRequestError,
  AmountPrecisionError,
} from "../dist/index.js";

export const ARC_DOMAIN = 26;
export const STELLAR_DOMAIN = 27;

export function domainFor(chain) {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

export function isDeterministicError(error) {
  if (!error) return false;
  if (error instanceof AmountPrecisionError || error.name === "AmountPrecisionError") {
    return true;
  }
  const message = String(error.message ?? error);
  const deterministicPatterns = [
    /invalid address/i,
    /bad address/i,
    /recipient.*(?:not ready|needs|trustline|unfunded|does not exist)/i,
    /insufficient (?:funds|balance)/i,
    /exceeds destination/i,
    /precision/i,
    /missing.*(?:key|secret|env)/i,
    /unauthorized/i,
    /forbidden/i,
    /\b400\b.*bad request/i,
  ];
  return deterministicPatterns.some((p) => p.test(message));
}

export function isTransientError(error) {
  if (!error) return false;
  if (isDeterministicError(error)) return false;

  const status = Number(
    error.status ?? error.statusCode ?? error.cause?.status ?? error.cause?.statusCode,
  );
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = String(error.code ?? error.cause?.code ?? "");
  const transientCodes = new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "ATTESTATION_NOT_READY",
  ]);
  if (transientCodes.has(code)) {
    return true;
  }

  if (error instanceof AttestationNotReadyError || error.name === "AttestationNotReadyError") {
    return true;
  }
  if (error instanceof IrisRequestError || error.name === "IrisRequestError") {
    if (status === 429 || status >= 500) return true;
  }

  const message = String(error.message ?? error);
  const transientPatterns = [
    /\b(?:429|500|502|503|504)\b/,
    /rate limit/i,
    /too many requests/i,
    /temporarily unavailable/i,
    /gateway timeout/i,
    /server error/i,
    /timeout/i,
    /connection reset/i,
    /fetch failed/i,
    /network error/i,
    /rpc.*error/i,
  ];

  return transientPatterns.some((pattern) => pattern.test(message));
}

export async function runSmokeStep(name, operation, options = {}) {
  const {
    maxRetries = 2,
    initialDelayMs = 500,
    backoffFactor = 2,
    safeToRetry = true,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console,
  } = options;

  const start = Date.now();
  let attempts = 0;

  while (true) {
    attempts++;
    try {
      const value = await operation();
      return {
        name,
        status: "PASS",
        durationMs: Date.now() - start,
        attempts,
        value,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const transient = isTransientError(error);

      if (!safeToRetry || !transient || attempts > maxRetries) {
        return {
          name,
          status: "FAIL",
          durationMs,
          attempts,
          error,
        };
      }

      const delayMs = initialDelayMs * Math.pow(backoffFactor, attempts - 1);
      log.warn(
        `  [retry] ${name} encountered transient failure (attempt ${attempts}/${maxRetries + 1}): ${error.message ?? error}. Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }
}

export function formatStepSummary(steps) {
  const lines = [
    "============================================================",
    "Smoke Test Step Summary",
    "============================================================",
  ];

  let passed = 0;
  let failed = 0;

  for (const step of steps) {
    const attemptStr = `${step.attempts} attempt${step.attempts === 1 ? "" : "s"}`;
    const statusStr = step.status.padEnd(4, " ");
    lines.push(`${statusStr}  ${step.name} (${step.durationMs}ms, ${attemptStr})`);
    if (step.status === "PASS") {
      passed++;
    } else {
      failed++;
    }
  }

  lines.push("============================================================");
  lines.push(`Total: ${passed} passed, ${failed} failed (${steps.length} total)`);
  return lines.join("\n");
}

export function formatRecoveryCommand(params, burnTxHash) {
  return (
    "Recover with completeMint(" +
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
    ")"
  );
}

export async function runSmokeCase(name, params, summary, options = {}) {
  console.log(`\n--- Case: ${name} ---`);
  let burnTxHash = null;

  // Step 1: fund/check
  const preflightStep = await runSmokeStep(
    `${name}: fund/check`,
    async () => {
      if (params.to === "stellar") {
        const state = await checkStellarRecipientReady(
          params.recipient,
          params.network,
          params.options?.stellarRpcUrl,
        );
        if (!state.exists || !state.hasTrustline) {
          throw new Error(
            `Stellar recipient ${params.recipient} is not ready: exists=${state.exists}, hasTrustline=${state.hasTrustline}. Please fund and establish a USDC trustline.`,
          );
        }
        return state;
      }
      return { ready: true };
    },
    { safeToRetry: true, maxRetries: 2, ...options.stepOptions },
  );

  summary.push(preflightStep);
  if (preflightStep.status === "FAIL") {
    console.error(`FAIL ${preflightStep.name}:`, preflightStep.error?.message ?? preflightStep.error);
    return;
  }
  console.log(`PASS ${preflightStep.name} (${preflightStep.durationMs}ms)`);

  // Step 2: approve+burn
  let attestationHash = null;
  const burnStep = await runSmokeStep(
    `${name}: approve+burn`,
    async () => {
      try {
        const res = await transfer({
          ...params,
          options: {
            ...params.options,
            destinationSigner: undefined,
            pollInterval: 1000,
            pollTimeout: 3000,
          },
        });
        burnTxHash = res.burnTxHash;
        if (res.attestationHash) {
          attestationHash = res.attestationHash;
        }
        return res;
      } catch (err) {
        if (err instanceof TransferError && err.burnTxHash) {
          burnTxHash = err.burnTxHash;
          if (err.attestationHash) {
            attestationHash = err.attestationHash;
          }
          return { burnTxHash: err.burnTxHash, attestationHash: err.attestationHash };
        }
        throw err;
      }
    },
    { safeToRetry: false, maxRetries: 0, ...options.stepOptions },
  );

  summary.push(burnStep);
  if (burnStep.status === "FAIL" || !burnTxHash) {
    console.error(`FAIL ${burnStep.name}:`, burnStep.error?.message ?? burnStep.error);
    return;
  }
  console.log(`PASS ${burnStep.name} (${burnStep.durationMs}ms, burnTxHash: ${burnTxHash})`);

  // Step 3: attestation wait
  const attestationStep = await runSmokeStep(
    `${name}: attestation wait`,
    async () => {
      if (attestationHash) {
        return { attestation: attestationHash };
      }
      const sourceDomain = domainFor(params.from);
      const useSandbox = params.network === "testnet";
      const pollInterval = params.options?.pollInterval ?? 2000;
      const pollTimeout = params.options?.pollTimeout ?? 120000;
      const deadline = Date.now() + pollTimeout;

      while (Date.now() < deadline) {
        try {
          const att = await getAttestation({
            sourceDomain,
            transactionHash: burnTxHash,
            useSandbox,
          });
          if (att.status === "complete" && att.attestation) {
            attestationHash = att.attestation;
            return att;
          }
        } catch (err) {
          if (!isTransientError(err)) {
            throw err;
          }
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      throw new AttestationNotReadyError(
        `Attestation timed out for burn ${burnTxHash}`,
        burnTxHash,
      );
    },
    { safeToRetry: true, maxRetries: 3, ...options.stepOptions },
  );

  summary.push(attestationStep);
  if (attestationStep.status === "FAIL") {
    console.error(
      `FAIL ${attestationStep.name}:`,
      attestationStep.error?.message ?? attestationStep.error,
    );
    console.error(`  burnTxHash: ${burnTxHash}`);
    console.error(`  ${formatRecoveryCommand(params, burnTxHash)}`);
    return;
  }
  console.log(`PASS ${attestationStep.name} (${attestationStep.durationMs}ms)`);

  // Step 4: mint
  const mintStep = await runSmokeStep(
    `${name}: mint`,
    async () => {
      const mintRes = await completeMint({
        from: params.from,
        to: params.to,
        network: params.network,
        burnTxHash,
        signer: params.options?.destinationSigner,
        options: {
          stellarRpcUrl: params.options?.stellarRpcUrl,
          arcRpcUrl: params.options?.arcRpcUrl,
        },
      });
      if (!mintRes.mintTxHash) {
        throw new Error("completeMint succeeded but returned no mintTxHash");
      }
      return mintRes;
    },
    { safeToRetry: true, maxRetries: 2, ...options.stepOptions },
  );

  summary.push(mintStep);
  if (mintStep.status === "FAIL") {
    console.error(`FAIL ${mintStep.name}:`, mintStep.error?.message ?? mintStep.error);
    console.error(`  burnTxHash: ${burnTxHash}`);
    if (attestationHash) {
      console.error(`  attestationHash: ${attestationHash}`);
    }
    console.error(`  ${formatRecoveryCommand(params, burnTxHash)}`);
    return;
  }
  console.log(
    `PASS ${mintStep.name} (${mintStep.durationMs}ms, mintTxHash: ${mintStep.value?.mintTxHash})`,
  );
}

export async function main() {
  const ARC_PRIVATE_KEY = process.env.ARC_PRIVATE_KEY;
  const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY;
  const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
  const STELLAR_RPC_URL = process.env.STELLAR_RPC_URL;
  const SMOKE_AMOUNT = process.env.SMOKE_AMOUNT ?? "1.00";
  const FROM = process.env.FROM ?? "both";

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

  console.log(`Running smoke cases against ${NETWORK}.`);
  if (NETWORK === "mainnet") {
    console.log("WARNING: mainnet moves real USDC and spends real Arc gas.");
  }

  const summary = [];

  if (FROM === "arc" || FROM === "both") {
    await runSmokeCase(
      "arc -> stellar (standard)",
      {
        from: "arc",
        to: "stellar",
        amount: SMOKE_AMOUNT,
        recipient: stellarKeypair.publicKey(),
        speed: "standard",
        signer: arcSigner,
        network: NETWORK,
        options: { destinationSigner: stellarSigner, stellarRpcUrl: STELLAR_RPC_URL },
      },
      summary,
    );
  }

  if (FROM === "stellar" || FROM === "both") {
    await runSmokeCase(
      "stellar -> arc (standard)",
      {
        from: "stellar",
        to: "arc",
        amount: SMOKE_AMOUNT,
        recipient: arcAccount.address,
        speed: "standard",
        signer: stellarSigner,
        network: NETWORK,
        options: { destinationSigner: arcSigner, stellarRpcUrl: STELLAR_RPC_URL },
      },
      summary,
    );
  }

  console.log("\n" + formatStepSummary(summary));

  const hasFailures = summary.some((s) => s.status === "FAIL");
  if (hasFailures) {
    console.error(`\nSmoke test run finished with failures.`);
    process.exit(1);
  }

  console.log("\nAll smoke test cases passed.");
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFilePath === currentFilePath) {
  main().catch((err) => {
    console.error("Fatal smoke runner error:", err);
    process.exit(1);
  });
}
