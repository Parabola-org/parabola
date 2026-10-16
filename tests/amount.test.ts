import { describe, it, expect } from "vitest";
import { decimalsForChain, toRawAmount, fromRawAmount } from "../src/utils/amount.js";
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

import { convertPrecision } from "../src/utils/encoding.js";

describe("convertPrecision", () => {

  it("up-scales 6-decimal Arc amounts to 7-decimal Stellar exactly", () => {
    expect(convertPrecision(1_234_567n, 6, 7)).toBe(12_345_670n);
  });

  it("down-scales 7-decimal Stellar amounts to Arc's 6, truncating the extra digit", () => {
    // Stellar stroops 1_234_567 → Arc subunits 123_456 — the 7th digit is dropped,
    // matching the documented "truncates any excess precision" behavior.
    expect(convertPrecision(1_234_567n, 7, 6)).toBe(123_456n);
  });

  it("is the identity when the precisions match", () => {
    expect(convertPrecision(999_999n, 6, 6)).toBe(999_999n);
    expect(convertPrecision(999_999n, 7, 7)).toBe(999_999n);
  });

  it("round-trips an amount that survives the 7→6 truncation", () => {
    // 1.5 USDC on Stellar (1_500_000 stroops) → 1.5 on Arc (1_500_000→150_000),
    // and back lands exactly — the truncated digit was already zero.
    const stellar = 1_500_000n;
    const arc = convertPrecision(stellar, 7, 6);
    expect(arc).toBe(150_000n);
    expect(convertPrecision(arc, 6, 7)).toBe(stellar);
  });

  it("round-trip with nonzero truncated digits loses the precision honestly", () => {
    const stellar = 1_234_567n;
    const down = convertPrecision(stellar, 7, 6); // 123_456 — last digit gone
    const back = convertPrecision(down, 6, 7);    // 1_234_560 — not the original
    expect(back).toBe(1_234_560n);
    expect(back).not.toBe(stellar);
  });

  it("handles zero and max-precision boundaries", () => {
    expect(convertPrecision(0n, 6, 7)).toBe(0n);
    expect(convertPrecision(9_999_999n, 7, 6)).toBe(999_999n);
  });
});
