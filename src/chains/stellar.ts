import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import {
  stellarConfig,
  STELLAR_TX_TIMEOUT_SECONDS,
  STELLAR_CONFIRMATION_TIMEOUT_MS,
  STELLAR_INCLUSION_FEE,
} from "../constants.js";
import type { StellarSigner, Network } from "../types.js";
import { SubmissionTimeoutError } from "../errors.js";

const STELLAR_MAX_CONSECUTIVE_FAILURES = 5;

// ... [existing imports and functions remain unchanged]

async function pollTransactionStatus(server: rpc.Server, hash: string): Promise<string> {
  const deadline = Date.now() + STELLAR_CONFIRMATION_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    let result;
    try {
      result = await server.getTransaction(hash);
      consecutiveFailures = 0; // Reset on successful RPC response
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures >= STELLAR_MAX_CONSECUTIVE_FAILURES) {
        throw new SubmissionTimeoutError(
          `Transient RPC errors exceeded max (${STELLAR_MAX_CONSECUTIVE_FAILURES}) for tx ${hash}`,
          hash,
        );
      }
      const waitTime = Math.min(2000, Math.max(0, deadline - Date.now()));
      if (waitTime <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      continue;
    }

    if (result.status === "SUCCESS") return hash;
    if (result.status === "FAILED") {
      throw new Error(`Stellar transaction ${hash} failed`);
    }

    // Wait for next poll iteration
    const waitTime = Math.min(2000, Math.max(0, deadline - Date.now()));
    if (waitTime <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  throw new SubmissionTimeoutError(
    `Timed out waiting for Stellar transaction ${hash} to confirm`,
    hash,
  );
}

// ... [remaining code unchanged]
