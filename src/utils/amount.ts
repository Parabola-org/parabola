import type { ChainId } from "../types.js";
import { ARC_MAINNET, STELLAR_MAINNET } from "../constants.js";
import { parseUsdcAmount, formatUsdcAmount } from "./encoding.js";
import { AmountPrecisionError } from "../errors.js";

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
 * Returns the number of significant fractional decimal places in a human-readable
 * USDC amount string, ignoring trailing zeroes (e.g. "1.1230000" has 3 significant
 * decimal places).
 * Throws an Error if amount syntax is invalid.
 */
export function getSignificantDecimals(amount: string): number {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid USDC amount: ${amount}`);
  }
  const [, fraction = ""] = amount.split(".");
  return fraction.replace(/0+$/, "").length;
}

/**
 * Validates that an amount string does not specify more significant fractional decimal
 * places than the destination chain supports. Throws AmountPrecisionError if exceeded.
 */
export function assertSupportedPrecision(amount: string, to: ChainId): void {
  const precision = getSignificantDecimals(amount);
  const destinationDecimals = decimalsForChain(to);
  if (precision > destinationDecimals) {
    throw new AmountPrecisionError(amount, precision, destinationDecimals, to);
  }
}
