// Updated estimateFee to handle maxWait and use checkMaxFee
import { checkMaxFee } from "./utils/fee.js";

export async function estimateFee(params: EstimateFeeParams): Promise<FeeEstimate> {
  if (params.speed === "standard") {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
    };
  }

  // Check maxWait before fetching fee
  if (params.maxWait !== undefined && FAST_DURATION_SECONDS > params.maxWait) {
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
    network === "testnet"
  );

  const { transferMode, feeRaw } = checkMaxFee({
    feeBps,
    amount: params.amount,
    fromChain: params.from,
    maxFee: params.maxFee,
  });

  if (transferMode === "standard") {
    return {
      protocolFee: "0",
      estimatedDurationSeconds: STANDARD_DURATION_SECONDS,
      transferMode: "standard",
    };
  } else {
    return {
      protocolFee: fromRawAmount(feeRaw, params.from),
      estimatedDurationSeconds: FAST_DURATION_SECONDS,
      transferMode: "fast",
    };
  }
}
