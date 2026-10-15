import { describe, expect, it } from "vitest";
import {
  AttestationNotReadyError,
  IrisRequestError,
  SubmissionTimeoutError,
  TransferError,
} from "../src/errors.js";

describe("error taxonomy", () => {
  it("preserves TransferError recovery fields and discriminator", () => {
    const error = new TransferError(
      "mint failed",
      "0xburn",
      "0xattestation",
      "ATTESTATION_NOT_READY",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TransferError);
    expect(error.name).toBe("TransferError");
    expect(error.message).toBe("mint failed");
    expect(error.burnTxHash).toBe("0xburn");
    expect(error.attestationHash).toBe("0xattestation");
    expect(error.code).toBe("ATTESTATION_NOT_READY");
  });

  it("supports optional TransferError fields", () => {
    const error = new TransferError("mint failed", "0xburn");

    expect(error).toBeInstanceOf(TransferError);
    expect(error.attestationHash).toBeUndefined();
    expect(error.code).toBeUndefined();
  });

  it("preserves AttestationNotReadyError recovery fields", () => {
    const error = new AttestationNotReadyError("retry later", "0xburn");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AttestationNotReadyError);
    expect(error.name).toBe("AttestationNotReadyError");
    expect(error.message).toBe("retry later");
    expect(error.burnTxHash).toBe("0xburn");
  });

  it("preserves the optional Iris HTTP status", () => {
    const withStatus = new IrisRequestError("Iris unavailable", 503);
    const withoutStatus = new IrisRequestError("Iris unavailable");

    expect(withStatus).toBeInstanceOf(Error);
    expect(withStatus).toBeInstanceOf(IrisRequestError);
    expect(withStatus.name).toBe("IrisRequestError");
    expect(withStatus.message).toBe("Iris unavailable");
    expect(withStatus.status).toBe(503);
    expect(withoutStatus.status).toBeUndefined();
  });

  it("preserves the uncertain submission hash", () => {
    const error = new SubmissionTimeoutError("confirmation timed out", "0xsubmitted");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SubmissionTimeoutError);
    expect(error.name).toBe("SubmissionTimeoutError");
    expect(error.message).toBe("confirmation timed out");
    expect(error.hash).toBe("0xsubmitted");
  });
});
