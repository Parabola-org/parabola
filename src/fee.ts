import type { ChainId, Network, TransferMode, TransferSpeed } from "./types.js";
import { ARC_DOMAIN, STELLAR_DOMAIN } from "./constants.js";
import { fetchFastTransferFeeBps } from "./iris/poll.js";
import { toRawAmount, decimalsForChain } from "./utils/amount.js";
import { parseUsdcAmount } from "./utils/encoding.js";

// Arc's chain finality is sub-second, but Stellar's ~5s ledger close time and
// Iris attestation overhead dominate standard-transfer duration.
export const STANDARD_DURATION_SECONDS = 20;
export const FAST_DURATION_SECONDS = 15;

export function domainFor(chain: ChainId): number {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

export interface ResolveTransferModeParams {
  from: ChainId;
  to: ChainId;
  amount: string;
  speed: TransferSpeed;
  network: Network;
  maxFee?: string | undefined;
  maxWait?: number | undefined;
}

export interface ResolvedTransferMode {
  transferMode: TransferMode;
  /** Quoted fast fee in source-chain raw units; 0n whenever the result is standard. */
  feeRaw: bigint;
}

/**
 * The single source of truth that decides whether a fast request actually runs fast.
 * transfer() and estimateFee() both call it, so a quote never disagrees with what
 * transfer() would do.
 * maxWait is checked before Iris is queried, so that fallback costs no network call.
 */
export async function resolveTransferMode(params: ResolveTransferModeParams): Promise<ResolvedTransferMode> {
  if (params.speed === "standard") {
    return { transferMode: "standard", feeRaw: 0n };
  }

  if (params.maxWait !== undefined && FAST_DURATION_SECONDS > params.maxWait) {
    return { transferMode: "standard", feeRaw: 0n };
  }

  const feeBps = await fetchFastTransferFeeBps(
    domainFor(params.from),
    domainFor(params.to),
    params.network === "testnet",
  );

  const feeRaw = (toRawAmount(params.amount, params.from) * BigInt(feeBps)) / 10_000n;

  if (params.maxFee !== undefined && feeRaw > parseUsdcAmount(params.maxFee, decimalsForChain(params.from))) {
    return { transferMode: "standard", feeRaw: 0n };
  }

  return { transferMode: "fast", feeRaw };
}
