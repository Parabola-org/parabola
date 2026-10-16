import type { ChainId } from "../types.js";
import { ARC_MAINNET, STELLAR_MAINNET } from "../constants.js";
import { parseUsdcAmount, formatUsdcAmount } from "./encoding.js";

/**
 * USDC's subunit precision is a property of the asset rather than of the deployment, so one
 * constant answers for both networks: Arc USDC has 6 decimals on testnet and mainnet alike,
 * Stellar USDC has 7 on both. Reading the mainnet constants here is deliberate and is not a
 * network selection.
 *
 * This is the ERC-20 / SEP-41 view of USDC. It is not the same scale as Arc's native
 * balance, which reports the same asset at 18 decimals; see README's "Amounts and decimals".
 */
export function decimalsForChain(chain: ChainId): number {
  return chain === "arc" ? ARC_MAINNET.usdcDecimals : STELLAR_MAINNET.usdcDecimals;
}

/** Parses a human-readable USDC amount into raw subunits native to the given chain. */
export function toRawAmount(amount: string, chain: ChainId): bigint {
  return parseUsdcAmount(amount, decimalsForChain(chain));
}

/** Formats raw subunits native to the given chain back into a human-readable USDC amount. */
export function fromRawAmount(raw: bigint, chain: ChainId): string {
  return formatUsdcAmount(raw, decimalsForChain(chain));
}

/**
 * Significant decimal places in a human-readable amount — the fraction digits
 * that remain after trailing zeros are stripped. "1.1230000" carries 3
 * significant decimals (not 7), so it is representable wherever "1.123" is.
 */
export function significantDecimals(amount: string): number {
  const fraction = amount.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}
