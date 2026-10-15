/**
 * Whether a fast transfer's duration estimate exceeds the caller's maxWait ceiling. Both
 * transfer() and estimateFee() check this before quoting/charging a fast fee, so a maxWait
 * too tight for fast always falls back to "standard" in both places identically.
 */
export function fastTransferExceedsMaxWait(
  estimatedDurationSeconds: number,
  maxWait: number | undefined,
): boolean {
  return maxWait !== undefined && estimatedDurationSeconds > maxWait;
}

/**
 * Whether a quoted fast-transfer fee exceeds the caller's maxFee ceiling. Both transfer()
 * and estimateFee() check this against the same raw fee and raw cap, so the fee that would
 * actually be charged and the fee a quote reports cannot drift apart.
 */
export function fastTransferExceedsMaxFee(feeRaw: bigint, maxFeeRaw: bigint | undefined): boolean {
  return maxFeeRaw !== undefined && feeRaw > maxFeeRaw;
}
