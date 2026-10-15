// Updated transfer() to use checkMaxFee after maxWait check
import { checkMaxFee } from "./utils/fee.js";

export async function transfer(params: TransferParams): Promise<TransferResult> {
  // ... existing code

  let transferMode: TransferMode = params.speed;
  let feeRaw = 0n;

  if (transferMode === "fast") {
    const options = params.options ?? {};
    if (options.maxWait !== undefined && FAST_ESTIMATED_DURATION_SECONDS > options.maxWait) {
      transferMode = "standard";
    } else {
      const feeBps = await fetchFastTransferFeeBps(domainFor(params.from), domainFor(params.to), useSandbox);
      const { transferMode: newMode, feeRaw: newFeeRaw } = checkMaxFee({
        feeBps,
        amount: params.amount,
        fromChain: params.from,
        maxFee: options.maxFee,
      });
      transferMode = newMode;
      feeRaw = newFeeRaw;
    }
  }

  // ... rest of the code
}
