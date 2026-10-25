// src/chains/stellar.ts

import { Server, TransactionResponse } from "soroban-client";

/**
 * Polls a Stellar transaction until it is confirmed or fails.
 *
 * This function is resilient to transient RPC errors (e.g., connection resets,
 * 5xx responses from the Soroban RPC). When such an error occurs the polling
 * loop continues without losing any previously retrieved information,
 * notably the `burnTxHash` that may be present in the transaction's result
 * meta.
 *
 * @param server        An initialized Soroban RPC server instance.
 * @param txHash        The transaction hash to poll.
 * @param maxAttempts   Maximum number of polling attempts before giving up.
 * @param intervalMs    Milliseconds to wait between attempts.
 *
 * @returns An object containing the final status and, if available,
 *          the `burnTxHash` extracted from the transaction result.
 *
 * @throws If a non‑transient error occurs or the maximum number of attempts
 *         is exceeded.
 */
export async function pollTransactionStatus(
  server: Server,
  txHash: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<{ status: string; burnTxHash?: string }> {
  let attempts = 0;
  let burnTxHash: string | undefined = undefined;

  // Helper to pause execution for a given amount of time.
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Determines whether an error is transient and therefore safe to retry.
  const isTransientError = (err: any): boolean => {
    if (!err) return false;

    // Network‑level errors (e.g., ECONNRESET, ETIMEDOUT)
    if (err.code && typeof err.code === "string") {
      const transientCodes = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND"];
      if (transientCodes.includes(err.code)) return true;
    }

    // HTTP‑level errors from the RPC (status >= 500)
    if (err.status && typeof err.status === "number") {
      if (err.status >= 500) return true;
    }

    // Soroban‑client may wrap errors in a `response` field.
    if (err.response && err.response.status && err.response.status >= 500) {
      return true;
    }

    return false;
  };

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const tx: TransactionResponse = await server.getTransaction(txHash);

      // If the transaction is still pending, the RPC returns a 404‑like
      // response. In that case `tx` will be undefined; continue polling.
      if (!tx) {
        await delay(intervalMs);
        continue;
      }

      // Extract burnTxHash if present and not already stored.
      if (!burnTxHash && tx.result_meta_xdr) {
        try {
          // The result meta XDR may contain the burnTxHash in the
          // transaction result. Decode it safely.
          const meta = server.getTransactionResultMeta(tx.result_meta_xdr);
          // The exact location of burnTxHash depends on the contract's
          // implementation; we assume it is stored in the first
          // `contractEvent`'s `data` as a string.
          const event = meta?.events?.[0];
          if (event?.data?.value?.bytes) {
            // Convert raw bytes to hex string.
            burnTxHash = Buffer.from(event.data.value.bytes).toString("hex");
          }
        } catch {
          // If decoding fails, we simply ignore and keep burnTxHash undefined.
        }
      }

      // Determine final status.
      const status = tx.successful ? "success" : "failed";
      return { status, burnTxHash };
    } catch (err: any) {
      // If the error is transient, log (optional) and retry after a delay.
      if (isTransientError(err)) {
        // Optional: console.warn(`Transient RPC error while polling ${txHash}:`, err.message);
        await delay(intervalMs);
        continue;
      }

      // Non‑transient errors should abort the polling.
      throw err;
    }
  }

  // If we exit the loop we exhausted attempts without a definitive result.
  throw new Error(
    `Polling for transaction ${txHash} timed out after ${maxAttempts} attempts`
  );
}