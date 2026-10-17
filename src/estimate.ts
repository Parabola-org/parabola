import type { EstimateFeeParams, FeeEstimate, ChainId } from "./types.js";
import { ARC_DOMAIN, STELLAR_DOMAIN, FAST_ESTIMATED_DURATION_SECONDS } from "./constants.js";
import { fetchFastTransferFeeBps } from "./iris/poll.js";
import { toRawAmount, fromRawAmount, decimalsForChain } from "./utils/amount.js";
import { parseUsdcAmount } from "./utils/encoding.js";

function domainFor(chain: ChainId): number {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

// Arc's chain finality is sub-second, but Stellar's ~5s ledger close time and
// Iris attestation overhead dominate standard-transfer duration.
const STANDARD_DURATION_SECONDS = 20;

/**
 * Estimates the protocol fee and duration for a transfer, respecting the same
 * maxFee / maxWait fallback knobs that transfer() uses. When fast transfer is
 * requested but a constraint would cause transfer() to downgrade to standard,
 * the estimate reports transferMode: "standard" and fastAvailable: false so the
 * caller sees the same outcome transfer() would produce.
 */
export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  const network = params.network ?? "mainnet";

  if (params.speed === "standard") {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
      fastAvailable: true,
    };
  }

  // Mirror transfer()'s fallback order: maxWait is checked first and short-circuits
  // before any fee fetch, so an estimate that would downgrade on maxWait does not
  // hit the Iris API either.
  if (params.maxWait !== undefined && FAST_ESTIMATED_DURATION_SECONDS > params.maxWait) {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
      fastAvailable: false,
    };
  }

  const feeBps = await fetchFastTransferFeeBps(
    domainFor(params.from),
    domainFor(params.to),
    network === "testnet",
  );

  const amountRaw = toRawAmount(params.amount, params.from);
  const feeRaw = (amountRaw * BigInt(feeBps)) / 10_000n;

  if (params.maxFee !== undefined) {
    const maxFeeRaw = parseUsdcAmount(params.maxFee, decimalsForChain(params.from));
    if (feeRaw > maxFeeRaw) {
      return {
        protocolFee: "0",
        estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
        transferMode: "standard",
        fastAvailable: false,
      };
    }
  }

  return {
    protocolFee: fromRawAmount(feeRaw, params.from),
    estimatedDurationSeconds: FAST_ESTIMATED_DURATION_SECONDS,
    transferMode: "fast",
    fastAvailable: true,
  };
}
