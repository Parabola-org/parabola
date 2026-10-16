#!/usr/bin/env node
// End-to-end Arc/Stellar smoke against live testnets. Run after pnpm build.
// Do not retry a transfer on a timeout: the source-chain burn may already exist.
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@stellar/stellar-sdk";
import { transfer, resolveBurn, arcMainnetChain, arcTestnetChain, TransferError } from "../dist/index.js";
import { runSmokeStep, formatStepSummary } from "./smoke-step-runner.mjs";

const NETWORK = process.env.NETWORK === "mainnet" ? "mainnet" : "testnet";
const FROM = process.env.FROM ?? "both";
const SMOKE_AMOUNT = process.env.SMOKE_AMOUNT ?? "1.00";
const ARC_PRIVATE_KEY = process.env.ARC_PRIVATE_KEY;
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY;
const STELLAR_RPC_URL = process.env.STELLAR_RPC_URL;

if (!ARC_PRIVATE_KEY || !STELLAR_SECRET_KEY) {
  console.error("Missing ARC_PRIVATE_KEY and/or STELLAR_SECRET_KEY. Use funded testnet keys from https://faucet.circle.com and the .env.example instructions.");
  process.exitCode = 1;
} else {
  const arcChain = NETWORK === "mainnet" ? arcMainnetChain : arcTestnetChain;
  const arcAccount = privateKeyToAccount(ARC_PRIVATE_KEY);
  const arcSigner = { walletClient: createWalletClient({ account: arcAccount, chain: arcChain, transport: http() }) };
  const stellarKeypair = Keypair.fromSecret(STELLAR_SECRET_KEY);
  const stellarSigner = { publicKey: stellarKeypair.publicKey(), keypair: stellarKeypair };
  const cases = [];

  if (FROM === "arc" || FROM === "both") cases.push({
    name: "arc -> stellar (standard)",
    params: { from: "arc", to: "stellar", amount: SMOKE_AMOUNT,
      recipient: stellarKeypair.publicKey(), speed: "standard", signer: arcSigner,
      network: NETWORK, options: { destinationSigner: stellarSigner, stellarRpcUrl: STELLAR_RPC_URL } },
  });
  if (FROM === "stellar" || FROM === "both") cases.push({
    name: "stellar -> arc (standard)",
    params: { from: "stellar", to: "arc", amount: SMOKE_AMOUNT,
      recipient: arcAccount.address, speed: "standard", signer: stellarSigner,
      network: NETWORK, options: { destinationSigner: arcSigner, stellarRpcUrl: STELLAR_RPC_URL } },
  });

  if (cases.length === 0) {
    console.error(`Invalid FROM=${FROM}. Expected arc, stellar, or both.`);
    process.exitCode = 1;
  } else {
    console.log(`Running smoke cases against ${NETWORK}.`);
    if (NETWORK === "mainnet") console.warn("WARNING: mainnet spends real USDC and gas.");
    const summary = [];
    for (const {name, params} of cases) {
      console.log(`\n--- ${name} ---`);
      // transfer() performs approval, burn, attestation polling and mint as one SDK
      // operation. It must be treated as non-idempotent: retrying the entire
      // operation on a transient error could burn more USDC.
      const result = await runSmokeStep(name, async () => {
        const value = await transfer(params);
        if (value.status !== "success" || !value.mintTxHash)
          throw new Error(`Transfer incomplete: ${value.status}; mintTxHash=${value.mintTxHash ?? "missing"}`);
        return value;
      }, { safeToRetry: false, retries: 0 });
      summary.push(result);
      if (result.status === "PASS") {
        console.log(JSON.stringify(result.value, null, 2));
      } else {
        const error = result.error;
        console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error);
        if (error instanceof TransferError) {
          console.error(`  burnTxHash: ${error.burnTxHash}`);
          // After a confirmed burn, only retry the read-only Iris lookup.
          // Never automatically replay burn or mint with an ambiguous outcome.
          if (error.burnTxHash) {
            const inspection = await runSmokeStep(name + ': inspect burn',
              () => resolveBurn({ from: params.from, burnTxHash: error.burnTxHash, network: NETWORK }),
              { safeToRetry: true, retries: 2 });
            summary.push(inspection);
            if (inspection.status === 'PASS') console.log('  burn inspection: ' + JSON.stringify(inspection.value));
            else console.error('  burn inspection inconclusive; inspect chain state before recovery.');
          }
          if (error.attestationHash) console.error(`  attestationHash: ${error.attestationHash}`);
          console.error("  Recover with completeMint(" + JSON.stringify({
            from: params.from, to: params.to, network: params.network,
            burnTxHash: error.burnTxHash, signer: "<destination-chain signer>",
          }, null, 2) + ")");
        }
      }
    }
    console.log("\nSmoke step summary:\n" + formatStepSummary(summary));
    if (summary.some(row => row.status === "FAIL")) process.exitCode = 1;
    else console.log("All smoke test cases passed.");
  }
}
