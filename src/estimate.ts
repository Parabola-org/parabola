import type { EstimateFeeParams, FeeEstimate } from "./types.js";
import { fromRawAmount } from "./utils/amount.js";
import {
  resolveTransferMode,
  FAST_DURATION_SECONDS,
  STANDARD_DURATION_SECONDS,
} from "./fee.js";

export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  const { transferMode, feeRaw } = await resolveTransferMode({
    from: params.from,
    to: params.to,
    amount: params.amount,
    speed: params.speed,
    network: params.network ?? "mainnet",
    maxFee: params.maxFee,
    maxWait: params.maxWait,
  });

  if (transferMode === "standard") {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode,
    };
  }

  return {
    protocolFee: fromRawAmount(feeRaw, params.from),
    estimatedDurationSeconds: FAST_DURATION_SECONDS,
    transferMode,
  };
}
