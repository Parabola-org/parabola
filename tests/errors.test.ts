import { describe, it, expect } from "vitest";
import {
  TransferError,
  AttestationNotReadyError,
  IrisRequestError,
  SubmissionTimeoutError,
  type TransferErrorCode,
} from "../src/errors.js";

describe("TransferError", () => {
  it("initializes with required fields and defaults name correctly", () => {
    const error = new TransferError("burn failed downstream", "0xabc123");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TransferError);
    expect(error.name).toBe("TransferError");
    expect(error.message).toBe("burn failed downstream");
    expect(error.burnTxHash).toBe("0xabc123");
    expect(error.attestationHash).toBeUndefined();
    expect(error.code).toBeUndefined();
  });

  it("attaches attestationHash and optional error code when provided", () => {
    const code: TransferErrorCode = "ATTESTATION_NOT_READY";
    const error = new TransferError(
      "attestation still pending",
      "0xburnhash",
      "0xattesthash",
      code,
    );
    expect(error.burnTxHash).toBe("0xburnhash");
    expect(error.attestationHash).toBe("0xattesthash");
    expect(error.code).toBe("ATTESTATION_NOT_READY");
  });

  it("maintains prototype chain across instanceof checks", () => {
    const error = new TransferError("test error", "0x123");
    expect(error instanceof TransferError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(Object.prototype.toString.call(error)).toBe("[object Error]");
  });
});

describe("AttestationNotReadyError", () => {
  it("constructs with message and burnTxHash", () => {
    const error = new AttestationNotReadyError("attestation waiting", "0xburn999");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AttestationNotReadyError);
    expect(error.name).toBe("AttestationNotReadyError");
    expect(error.message).toBe("attestation waiting");
    expect(error.burnTxHash).toBe("0xburn999");
  });

  it("can be discriminated from other errors via instanceof", () => {
    const error: unknown = new AttestationNotReadyError("waiting", "0x123");
    if (error instanceof AttestationNotReadyError) {
      expect(error.burnTxHash).toBe("0x123");
    } else {
      throw new Error("Expected AttestationNotReadyError");
    }
  });
});

describe("IrisRequestError", () => {
  it("constructs without optional status code", () => {
    const error = new IrisRequestError("network timeout");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IrisRequestError);
    expect(error.name).toBe("IrisRequestError");
    expect(error.message).toBe("network timeout");
    expect(error.status).toBeUndefined();
  });

  it("attaches HTTP status code when provided", () => {
    const error = new IrisRequestError("Iris 503 Service Unavailable", 503);
    expect(error.status).toBe(503);
    expect(error.message).toBe("Iris 503 Service Unavailable");
    expect(error.name).toBe("IrisRequestError");
  });
});

describe("SubmissionTimeoutError", () => {
  it("constructs with message and transaction hash", () => {
    const error = new SubmissionTimeoutError(
      "transaction confirmation timed out",
      "0xtxhash789",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SubmissionTimeoutError);
    expect(error.name).toBe("SubmissionTimeoutError");
    expect(error.message).toBe("transaction confirmation timed out");
    expect(error.hash).toBe("0xtxhash789");
  });

  it("allows inspecting hash property for unconfirmed transaction tracking", () => {
    const error = new SubmissionTimeoutError("pending tx", "0xunconfirmed");
    expect(error.hash).toBe("0xunconfirmed");
  });
});
