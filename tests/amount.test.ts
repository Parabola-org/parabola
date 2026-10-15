import { describe, it, expect } from "vitest";
import { decimalsForChain, toRawAmount, fromRawAmount } from "../src/utils/amount.js";
import { convertPrecision } from "../src/index.js";
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

describe("convertPrecision (6 <-> 7 decimal round-trips)", () => {
  const arcDecimals = decimalsForChain("arc"); // 6
  const stellarDecimals = decimalsForChain("stellar"); // 7

  it("upscales 6-decimal Arc subunits to 7-decimal Stellar subunits and round-trips exactly", () => {
    const arcRaw = toRawAmount("1234.567891", "arc"); // 1_234_567_891n
    expect(arcRaw).toBe(1_234_567_891n);

    const stellarRaw = convertPrecision(arcRaw, arcDecimals, stellarDecimals);
    expect(stellarRaw).toBe(12_345_678_910n);
    expect(fromRawAmount(stellarRaw, "stellar")).toBe("1234.567891");

    const roundTripped = convertPrecision(stellarRaw, stellarDecimals, arcDecimals);
    expect(roundTripped).toBe(1_234_567_891n);
    expect(fromRawAmount(roundTripped, "arc")).toBe("1234.567891");
  });

  it("downscales 7-decimal Stellar subunits to 6-decimal Arc subunits, truncating excess precision on round-trip", () => {
    const stellarRaw = toRawAmount("999999.9999999", "stellar"); // 9_999_999_999_999n
    expect(stellarRaw).toBe(9_999_999_999_999n);

    const arcRaw = convertPrecision(stellarRaw, stellarDecimals, arcDecimals);
    expect(arcRaw).toBe(999_999_999_999n);
    expect(fromRawAmount(arcRaw, "arc")).toBe("999999.999999");

    const upscaledBack = convertPrecision(arcRaw, arcDecimals, stellarDecimals);
    expect(upscaledBack).toBe(9_999_999_999_990n);
    expect(fromRawAmount(upscaledBack, "stellar")).toBe("999999.999999");
  });

  it("preserves zero and identity conversions across matching decimals", () => {
    expect(convertPrecision(0n, arcDecimals, stellarDecimals)).toBe(0n);
    expect(convertPrecision(0n, stellarDecimals, arcDecimals)).toBe(0n);
    expect(convertPrecision(42_000_000n, arcDecimals, arcDecimals)).toBe(42_000_000n);
    expect(convertPrecision(420_000_000n, stellarDecimals, stellarDecimals)).toBe(420_000_000n);
  });
});
