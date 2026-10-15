import type { EstimateFeeParams, FeeEstimate, ChainId } from "./types.js";
import { ARC_DOMAIN, STELLAR_DOMAIN, FAST_TRANSFER_ESTIMATED_DURATION_SECONDS } from "./constants.js";
import { fetchFastTransferFeeBps } from "./iris/poll.js";
import { toRawAmount, fromRawAmount, decimalsForChain } from "./utils/amount.js";
import { parseUsdcAmount } from "./utils/encoding.js";
import { fastTransferExceedsMaxFee, fastTransferExceedsMaxWait } from "./utils/fastTransferPolicy.js";

function domainFor(chain: ChainId): number {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

// Arc's chain finality is sub-second, but Stellar's ~5s ledger close time and
// Iris attestation overhead dominate standard-transfer duration.
const STANDARD_DURATION_SECONDS = 20;

const STANDARD_ESTIMATE: FeeEstimate = {
  protocolFee: "0",
  estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
  transferMode: "standard",
};

export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  if (params.speed === "standard") {
    return STANDARD_ESTIMATE;
  }

  // Checked before quoting a fee so a maxWait too tight for fast skips the Iris round trip,
  // matching how transfer() avoids fetching a fee it is about to discard.
  if (fastTransferExceedsMaxWait(FAST_TRANSFER_ESTIMATED_DURATION_SECONDS, params.maxWait)) {
    return STANDARD_ESTIMATE;
  }

  const network = params.network ?? "mainnet";
  const feeBps = await fetchFastTransferFeeBps(
    domainFor(params.from),
    domainFor(params.to),
    network === "testnet",
  );

  const amountRaw = toRawAmount(params.amount, params.from);
  const feeRaw = (amountRaw * BigInt(feeBps)) / 10_000n;

  const maxFeeRaw =
    params.maxFee !== undefined ? parseUsdcAmount(params.maxFee, decimalsForChain(params.from)) : undefined;
  if (fastTransferExceedsMaxFee(feeRaw, maxFeeRaw)) {
    return STANDARD_ESTIMATE;
  }

  return {
    protocolFee: fromRawAmount(feeRaw, params.from),
    estimatedDurationSeconds: FAST_TRANSFER_ESTIMATED_DURATION_SECONDS,
    transferMode: "fast",
  };
}
