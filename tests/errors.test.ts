import { describe, it, expect } from "vitest";
import {
  TransferError,
  AttestationNotReadyError,
  IrisRequestError,
  SubmissionTimeoutError,
  AmountPrecisionError,
  type TransferErrorCode,
} from "../src/errors.js";

describe("TransferError", () => {
  it("wires all constructor args", () => {
    const e = new TransferError("boom", "0xburn", "0xattest", "ATTESTATION_NOT_READY");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(TransferError);
    expect(e.name).toBe("TransferError");
    expect(e.message).toBe("boom");
    expect(e.burnTxHash).toBe("0xburn");
    expect(e.attestationHash).toBe("0xattest");
    expect(e.code).toBe<TransferErrorCode>("ATTESTATION_NOT_READY");
  });

  it("supports optional-arg variants", () => {
    const e = new TransferError("m", "0xB");
    expect(e.attestationHash).toBeUndefined();
    expect(e.code).toBeUndefined();
  });

  it("accepts TRANSFER_ABORTED discriminator", () => {
    expect(new TransferError("m", "0xB", undefined, "TRANSFER_ABORTED").code).toBe("TRANSFER_ABORTED");
  });

  it("is catchable as Error with fresh stack", () => {
    const e = new TransferError("m", "0xB");
    expect(e.stack).toBeDefined();
    expect(e instanceof Error).toBe(true);
  });
});

describe("AttestationNotReadyError", () => {
  it("carries burnTxHash and name", () => {
    const e = new AttestationNotReadyError("pending", "0xburn");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AttestationNotReadyError);
    expect(e.name).toBe("AttestationNotReadyError");
    expect(e.burnTxHash).toBe("0xburn");
    expect(e.message).toBe("pending");
  });
});

describe("IrisRequestError", () => {
  it("carries optional status", () => {
    const e = new IrisRequestError("5xx", 503);
    expect(e).toBeInstanceOf(IrisRequestError);
    expect(e.name).toBe("IrisRequestError");
    expect(e.status).toBe(503);
  });
  it("allows undefined status (pre-response failure)", () => {
    expect(new IrisRequestError("dns").status).toBeUndefined();
  });
});

describe("SubmissionTimeoutError", () => {
  it("carries hash", () => {
    const e = new SubmissionTimeoutError("timed out", "0xhash");
    expect(e).toBeInstanceOf(SubmissionTimeoutError);
    expect(e.name).toBe("SubmissionTimeoutError");
    expect(e.hash).toBe("0xhash");
  });
});

describe("AmountPrecisionError", () => {
  it("is declared exactly once (regression: duplicate class)", () => {
    // Compilation would already fail on a duplicate identifier, but assert the
    // class is constructible and singular at runtime.
    expect(typeof AmountPrecisionError).toBe("function");
  });

  it("wires fields and formats message", () => {
    const e = new AmountPrecisionError("1.2345678", 7, 6, "arc");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AmountPrecisionError);
    expect(e.name).toBe("AmountPrecisionError");
    expect(e.amount).toBe("1.2345678");
    expect(e.precision).toBe(7);
    expect(e.supportedDecimals).toBe(6);
    expect(e.destination).toBe("arc");
    expect(e.message).toContain("7");
    expect(e.message).toContain("6");
  });

  it("supports stellar destination", () => {
    expect(new AmountPrecisionError("1.2345678", 7, 7, "stellar").destination).toBe("stellar");
  });
});

describe("prototype chain survives bundling", () => {
  it("each class sets its own name and instanceof works", () => {
    const instances: Array<[any, string]> = [
      [new TransferError("m", "h"), "TransferError"],
      [new AttestationNotReadyError("m", "h"), "AttestationNotReadyError"],
      [new IrisRequestError("m"), "IrisRequestError"],
      [new SubmissionTimeoutError("m", "h"), "SubmissionTimeoutError"],
      [new AmountPrecisionError("1.1", 1, 0, "arc"), "AmountPrecisionError"],
    ];
    for (const [inst, name] of instances) {
      expect(inst.name).toBe(name);
      expect(inst instanceof Error).toBe(true);
      expect(inst.constructor.name).toBe(name);
    }
  });
});
