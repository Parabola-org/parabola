import { ChainId, TransferMode } from "../types.js";
import { decimalsForChain, toRawAmount, parseUsdcAmount } from "./amount.js";

export function checkMaxFee({
  feeBps,
  amount,
  fromChain,
  maxFee,
}: {
  feeBps: number;
  amount: string;
  fromChain: ChainId;
  maxFee?: string;
}): { transferMode: TransferMode; feeRaw: bigint } {
  const fromDecimals = decimalsForChain(fromChain);
  const amountRaw = toRawAmount(amount, fromChain);
  const feeRaw = (amountRaw * BigInt(feeBps)) / 10000n;

  let maxFeeRaw: bigint | undefined;
  if (maxFee !== undefined) {
    maxFeeRaw = parseUsdcAmount(maxFee, fromDecimals);
  }

  let transferMode: TransferMode = "fast";
  if (maxFeeRaw !== undefined && feeRaw > maxFeeRaw) {
    transferMode = "standard";
  }

  return {
    transferMode,
    feeRaw: transferMode === "fast" ? feeRaw : 0n,
  };
}
