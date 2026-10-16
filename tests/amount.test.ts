import { describe, it, expect } from "vitest";
import {
  decimalsForChain,
  toRawAmount,
  fromRawAmount,
  getSignificantDecimals,
  assertSupportedPrecision,
} from "../src/utils/amount.js";
import { AmountPrecisionError } from "../src/index.js";
import { ARC_TESTNET, STELLAR_TESTNET } from "../src/constants.js";

describe("decimalsForChain", () => {
  it("returns Arc's decimals for arc", () => {
    expect(decimalsForChain("arc")).toBe(ARC_TESTNET.usdcDecimals);
    expect(decimalsForChain("arc")).toBe(6);
  });

  it("returns Stellar's decimals for stellar", () => {
    expect(decimalsForChain("stellar")).toBe(STELLAR_TESTNET.usdcDecimals);
    expect(decimalsForChain("stellar")).toBe(7);
  });
});

// The precision math itself (parseUsdcAmount/formatUsdcAmount) is covered in
// encoding.test.ts. What matters here is that toRawAmount/fromRawAmount wire the
// correct chain to the correct decimals -- a swapped mapping here would silently
// truncate or inflate every transfer by an order of magnitude, exactly the class of
// bug this SDK exists to prevent developers from hitting themselves.
describe("toRawAmount", () => {
  it("parses at Arc's 6 decimals, not Stellar's 7", () => {
    expect(toRawAmount("10.50", "arc")).toBe(10_500_000n);
  });

  it("parses at Stellar's 7 decimals, not Arc's 6", () => {
    expect(toRawAmount("10.50", "stellar")).toBe(105_000_000n);
  });

  it("rejects an amount with more precision than the target chain supports", () => {
    // 7 decimals of precision is valid on Stellar but not on Arc's 6.
    expect(() => toRawAmount("1.1234567", "arc")).toThrow();
    expect(() => toRawAmount("1.1234567", "stellar")).not.toThrow();
  });
});

describe("fromRawAmount", () => {
  it("formats Arc raw subunits at 6 decimals", () => {
    expect(fromRawAmount(10_500_000n, "arc")).toBe("10.5");
  });

  it("formats Stellar raw subunits at 7 decimals", () => {
    expect(fromRawAmount(105_000_000n, "stellar")).toBe("10.5");
  });

  it("round-trips through toRawAmount for both chains", () => {
    for (const chain of ["arc", "stellar"] as const) {
      const raw = toRawAmount("42.5", chain);
      expect(fromRawAmount(raw, chain)).toBe("42.5");
    }
  });
});

describe("getSignificantDecimals", () => {
  it("counts fractional digits ignoring trailing zeros", () => {
    expect(getSignificantDecimals("1")).toBe(0);
    expect(getSignificantDecimals("1.10")).toBe(1);
    expect(getSignificantDecimals("1.1230000")).toBe(3);
    expect(getSignificantDecimals("0.0000001")).toBe(7);
    expect(getSignificantDecimals("1.0000000")).toBe(0);
  });

  it("throws on malformed amounts rather than treating them as precision errors", () => {
    expect(() => getSignificantDecimals("abc")).toThrow(/Invalid USDC amount/);
    expect(() => getSignificantDecimals("1.")).toThrow(/Invalid USDC amount/);
    expect(() => getSignificantDecimals("-1")).toThrow(/Invalid USDC amount/);
    expect(() => getSignificantDecimals("1e-7")).toThrow(/Invalid USDC amount/);
    expect(() => getSignificantDecimals(".5")).toThrow(/Invalid USDC amount/);
  });
});

describe("assertSupportedPrecision", () => {
  it("throws AmountPrecisionError when fractional precision exceeds destination decimals", () => {
    expect(() => assertSupportedPrecision("1.1234567", "arc")).toThrow(AmountPrecisionError);

    try {
      assertSupportedPrecision("1.1234567", "arc");
      expect.unreachable("should have thrown AmountPrecisionError");
    } catch (err) {
      expect(err).toBeInstanceOf(AmountPrecisionError);
      const precisionErr = err as AmountPrecisionError;
      expect(precisionErr.amount).toBe("1.1234567");
      expect(precisionErr.precision).toBe(7);
      expect(precisionErr.destinationDecimals).toBe(6);
      expect(precisionErr.destinationChain).toBe("arc");
      expect(precisionErr.name).toBe("AmountPrecisionError");
    }
  });

  it("accepts inputs with trailing zeros whose significant precision fits the destination", () => {
    expect(() => assertSupportedPrecision("1.1230000", "arc")).not.toThrow();
    expect(() => assertSupportedPrecision("1.123456", "arc")).not.toThrow();
  });

  it("accepts up to 7 decimals for Stellar destination", () => {
    expect(() => assertSupportedPrecision("1.1234567", "stellar")).not.toThrow();
  });
});
