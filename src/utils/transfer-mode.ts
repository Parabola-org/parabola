import type { TransferSpeed } from "../types.js";

/** The estimate used by both transfer() and estimateFee() for a fast transfer. */
export const FAST_TRANSFER_DURATION_SECONDS = 15;

/**
 * Applies the fast-transfer fallback policy shared by transfer() and estimateFee().
 *
 * The fee is optional because callers can reject fast mode from maxWait before making
 * the network request that obtains a fee quote. When a quote is available, maxFee is
 * compared in raw units so Arc (6 decimals) and Stellar (7 decimals) remain precise.
 */
export function canUseFastTransfer(params: {
  requestedSpeed: TransferSpeed;
  maxWait?: number;
  feeRaw?: bigint;
  maxFeeRaw?: bigint;
}): boolean {
  if (params.requestedSpeed !== "fast") return false;
  if (
    params.maxWait !== undefined &&
    FAST_TRANSFER_DURATION_SECONDS > params.maxWait
  ) {
    return false;
  }
  if (
    params.feeRaw !== undefined &&
    params.maxFeeRaw !== undefined &&
    params.feeRaw > params.maxFeeRaw
  ) {
    return false;
  }
  return true;
}
