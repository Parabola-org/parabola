import { describe, it, expect } from "vitest";
import * as entry from "../src/index.js";

describe("public export surface snapshot", () => {
  it("exports the exact expected set of runtime symbols", () => {
    const exportedSymbols = Object.keys(entry).sort();
    
    // Explicit list of public runtime symbols guaranteed to be exported from src/index.ts
    const expectedSymbols = [
      "ARC_MAINNET",
      "ARC_TESTNET",
      "AttestationNotReadyError",
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
      "decimalsForChain",
      "decodeCctpMessage",
      "decodeStellarForwardHook",
      "estimateFee",
      "getAttestation",
      "resolveBurn",
      "transfer",
    ].sort();

    expect(exportedSymbols).toEqual(expectedSymbols);
  });

  it("exports all error taxonomy classes with valid constructors", () => {
    expect(typeof entry.TransferError).toBe("function");
    expect(typeof entry.AttestationNotReadyError).toBe("function");
    expect(typeof entry.IrisRequestError).toBe("function");
    expect(typeof entry.SubmissionTimeoutError).toBe("function");
  });

  it("exports core transfer and calculation workflows", () => {
    expect(typeof entry.transfer).toBe("function");
    expect(typeof entry.completeMint).toBe("function");
    expect(typeof entry.resolveBurn).toBe("function");
    expect(typeof entry.estimateFee).toBe("function");
    expect(typeof entry.getAttestation).toBe("function");
  });
});
