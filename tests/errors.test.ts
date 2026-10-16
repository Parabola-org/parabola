import { describe, it, expect } from "vitest";
import {
  TransferError,
  AttestationNotReadyError,
  IrisRequestError,
  SubmissionTimeoutError,
} from "../src/errors.js";

const BURN_HASH = "0x" + "ab".repeat(32);
const ATTESTATION = "0x" + "cd".repeat(32);

describe("TransferError", () => {
  it("carries message, burnTxHash, and name", () => {
    const err = new TransferError("mint reverted", BURN_HASH);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransferError);
    expect(err.message).toBe("mint reverted");
    expect(err.burnTxHash).toBe(BURN_HASH);
    expect(err.name).toBe("TransferError");
  });

  it("leaves attestationHash and code undefined when omitted", () => {
    const err = new TransferError("boom", BURN_HASH);

    expect(err.attestationHash).toBeUndefined();
    expect(err.code).toBeUndefined();
  });

  it("attaches the attestation hash and ATTESTATION_NOT_READY discriminator when given", () => {
    const err = new TransferError(
      "attestation not ready yet",
      BURN_HASH,
      ATTESTATION,
      "ATTESTATION_NOT_READY",
    );

    expect(err.attestationHash).toBe(ATTESTATION);
    expect(err.code).toBe("ATTESTATION_NOT_READY");
  });

  it("preserves a stack trace for post-burn debugging", () => {
    const err = new TransferError("mint reverted", BURN_HASH);

    expect(err.stack).toContain("TransferError");
  });
});

describe("AttestationNotReadyError", () => {
  it("carries message, burnTxHash, and name", () => {
    const err = new AttestationNotReadyError("Iris has not signed yet", BURN_HASH);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AttestationNotReadyError);
    expect(err.message).toBe("Iris has not signed yet");
    expect(err.burnTxHash).toBe(BURN_HASH);
    expect(err.name).toBe("AttestationNotReadyError");
  });
});

describe("IrisRequestError", () => {
  it("carries the HTTP status when a response arrived", () => {
    const err = new IrisRequestError("Iris returned 503", 503);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IrisRequestError);
    expect(err.message).toBe("Iris returned 503");
    expect(err.status).toBe(503);
    expect(err.name).toBe("IrisRequestError");
  });

  it("leaves status undefined when the request failed before a response", () => {
    const err = new IrisRequestError("connection reset");

    expect(err.status).toBeUndefined();
  });
});

describe("SubmissionTimeoutError", () => {
  it("carries the broadcast hash so callers can act on a possibly-landed tx", () => {
    const err = new SubmissionTimeoutError("timed out waiting for confirmation", BURN_HASH);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SubmissionTimeoutError);
    expect(err.message).toBe("timed out waiting for confirmation");
    expect(err.hash).toBe(BURN_HASH);
    expect(err.name).toBe("SubmissionTimeoutError");
  });
});

describe("error taxonomy", () => {
  it("keeps each class distinguishable by instanceof for caller-side branching", () => {
    const transfer = new TransferError("a", BURN_HASH);
    const attestation = new AttestationNotReadyError("b", BURN_HASH);
    const iris = new IrisRequestError("c", 500);
    const timeout = new SubmissionTimeoutError("d", BURN_HASH);

    // None of the four may collapse into another via the prototype chain: a
    // caller catching TransferError must never swallow an Iris outage, and a
    // caller matching SubmissionTimeoutError must not treat a bare
    // AttestationNotReadyError as "hash in flight".
    expect(attestation).not.toBeInstanceOf(TransferError);
    expect(iris).not.toBeInstanceOf(TransferError);
    expect(timeout).not.toBeInstanceOf(TransferError);
    expect(iris).not.toBeInstanceOf(AttestationNotReadyError);
    expect(timeout).not.toBeInstanceOf(AttestationNotReadyError);
    expect(timeout).not.toBeInstanceOf(IrisRequestError);
  });

  it("stays catchable as a plain Error", () => {
    const errors = [
      new TransferError("a", BURN_HASH),
      new AttestationNotReadyError("b", BURN_HASH),
      new IrisRequestError("c"),
      new SubmissionTimeoutError("d", BURN_HASH),
    ];

    for (const err of errors) {
      expect(() => {
        throw err;
      }).toThrow(Error);
    }
  });
});
