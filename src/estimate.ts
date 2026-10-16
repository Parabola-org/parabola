import type { EstimateFeeParams, FeeEstimate, ChainId } from "./types.js";
import { ARC_DOMAIN, STELLAR_DOMAIN } from "./constants.js";
import { fetchFastTransferFeeBps } from "./iris/poll.js";
import { toRawAmount, fromRawAmount } from "./utils/amount.js";
import { parseUsdcAmount } from "./utils/encoding.js";
import { decimalsForChain } from "./utils/amount.js";
import type { TransferMode } from "./types.js";

function domainFor(chain: ChainId): number {
  return chain === "arc" ? ARC_DOMAIN : STELLAR_DOMAIN;
}

// Arc's chain finality is sub-second, but Stellar's ~5s ledger close time and
// Iris attestation overhead dominate standard-transfer duration.
const STANDARD_DURATION_SECONDS = 20;
const FAST_DURATION_SECONDS = 15;

/**
 * The single fast-vs-standard decision shared by estimateFee() and transfer().
 * The fee fetch is injected so the two call sites share the *decision* without
 * sharing the network call, and so maxWait short-circuits before Iris is hit.
 */
export async function resolveTransferMode(args: {
  speed: TransferMode;
  amountRaw: bigint;
  chain: ChainId;
  maxFee?: string;
  maxWait?: number;
  fetchFeeBps: () => Promise<number>;
}): Promise<{ mode: TransferMode; feeRaw: bigint }> {
  if (args.speed !== "fast") {
    return { mode: "standard", feeRaw: 0n };
  }
  if (args.maxWait !== undefined && FAST_DURATION_SECONDS > args.maxWait) {
    return { mode: "standard", feeRaw: 0n };
  }
  const feeBps = await args.fetchFeeBps();
  const feeRaw = (args.amountRaw * BigInt(feeBps)) / 10_000n;
  if (args.maxFee !== undefined) {
    const maxFeeRaw = parseUsdcAmount(args.maxFee, decimalsForChain(args.chain));
    if (feeRaw > maxFeeRaw) {
      return { mode: "standard", feeRaw: 0n };
    }
  }
  return { mode: "fast", feeRaw };
}

export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  const network = params.network ?? "mainnet";
  const { mode, feeRaw } = await resolveTransferMode({
    speed: params.speed,
    amountRaw: toRawAmount(params.amount, params.from),
    chain: params.from,
    maxFee: params.maxFee,
    maxWait: params.maxWait,
    fetchFeeBps: () =>
      fetchFastTransferFeeBps(domainFor(params.from), domainFor(params.to), network === "testnet"),
  });

  return {
    protocolFee: fromRawAmount(feeRaw, params.from),
    estimatedDurationSeconds: mode === "fast" ? FAST_DURATION_SECONDS : STANDARD_DURATION_SECONDS,
    transferMode: mode,
  };
}
