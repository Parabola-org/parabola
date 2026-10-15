import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("public entry point", () => {
  it("keeps the runtime export surface explicit", () => {
    expect(Object.keys(sdk).sort()).toMatchInlineSnapshot(`
      [
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
      ]
    `);
  });
});
