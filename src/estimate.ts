import type { EstimateFeeParams, FeeEstimate, ChainId } from "./types.js";
import { ARC_DOMAIN, STELLAR_DOMAIN } from "./constants.js";
import { fetchFastTransferFeeBps } from "./iris/poll.js";
import { toRawAmount, fromRawAmount } from "./utils/amount.js";
import { canUseFastTransfer, FAST_TRANSFER_DURATION_SECONDS } from "./utils/transfer-mode.js";

function domainFor(chain: ChainId): number {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

// Arc's chain finality is sub-second, but Stellar's ~5s ledger close time and
// Iris attestation overhead dominate standard-transfer duration.
const STANDARD_DURATION_SECONDS = 20;

export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  if (params.speed === "standard") {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
    };
  }

  if (
    !canUseFastTransfer({
      requestedSpeed: params.speed,
      maxWait: params.maxWait,
    })
  ) {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
    };
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
    params.maxFee === undefined
      ? undefined
      : parseMaxFee(params.maxFee, params.from);

  if (
    !canUseFastTransfer({
      requestedSpeed: params.speed,
      maxWait: params.maxWait,
      feeRaw,
      maxFeeRaw,
    })
  ) {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
    };
  }

  return {
    protocolFee: fromRawAmount(feeRaw, params.from),
    estimatedDurationSeconds: FAST_TRANSFER_DURATION_SECONDS,
    transferMode: "fast",
  };
}

function parseMaxFee(amount: string, chain: ChainId): bigint {
  // Reuse the same parser as transfer() through toRawAmount's precision rules while
  // keeping this estimate-only parameter from being mistaken for a transfer amount.
  return toRawAmount(amount, chain);
}
