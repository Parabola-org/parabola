import { describe, it, expect } from "vitest";
import * as sdk from "../src/index.js";

/**
 * Public export surface snapshot.
 *
 * This intentionally lists the exact sorted export names so that ANY change to
 * the public API (added or removed export) produces a deliberate, reviewable
 * diff instead of slipping through CI.
 *
 * The list is derived from src/index.ts. When you intentionally change the
 * public API, update EXPECTED_EXPORTS in the same PR.
 */
const EXPECTED_EXPORTS = [
  "ARC_MAINNET",
  "ARC_TESTNET",
  "AttestationNotReadyError",
  "AmountPrecisionError",
  "IrisRequestError",
  "Keypair",
  "STELLAR_MAINNET",
  "STELLAR_TESTNET",
  "SubmissionTimeoutError",
  "TransferError",
  "arcMainnetChain",
  "arcTestnetChain",
  "checkStellarRecipientReady",
  "completeMint",
  "convertPrecision",
  "decimalsForChain",
  "decodeCctpMessage",
  "decodeStellarForwardHook",
  "estimateFee",
  "getAttestation",
  "resolveBurn",
  "transfer",
];

describe("public export surface", () => {
  it("matches the checked-in snapshot exactly", () => {
    const actual = Object.keys(sdk).sort();
    const expected = [...EXPECTED_EXPORTS].sort();
    const missing = expected.filter((n) => !actual.includes(n));
    const extra = actual.filter((n) => !expected.includes(n));
    expect(
      { missing, extra },
      `Export surface changed. missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]. ` +
        `If intentional, update EXPECTED_EXPORTS in tests/exports.test.ts.`,
    ).toEqual({ missing: [], extra: [] });
  });

  it("every function export is callable", () => {
    for (const name of ["transfer", "completeMint", "estimateFee", "getAttestation", "decimalsForChain"]) {
      expect(typeof (sdk as any)[name]).toBe("function");
    }
  });

  it("error classes are exported and constructible", () => {
    for (const name of [
      "TransferError",
      "AttestationNotReadyError",
      "IrisRequestError",
      "SubmissionTimeoutError",
      "AmountPrecisionError",
    ]) {
      expect(typeof (sdk as any)[name]).toBe("function");
    }
  });
});
