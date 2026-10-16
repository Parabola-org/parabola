import { describe, it, expect, vi } from "vitest";
import { AttestationNotReadyError, IrisRequestError, AmountPrecisionError } from "../src/index.js";
import { ARC_DOMAIN, STELLAR_DOMAIN } from "../src/constants.js";
// @ts-expect-error testnet-smoke is a plain .mjs script without declaration file
import * as smoke from "../scripts/testnet-smoke.mjs";

const {
  isTransientError,
  isDeterministicError,
  runSmokeStep,
  formatStepSummary,
  formatRecoveryCommand,
  domainFor,
} = smoke;

describe("scripts/testnet-smoke.mjs hardening", () => {
  describe("domainFor", () => {
    it("returns correct domain IDs for chains", () => {
      expect(domainFor("arc")).toBe(ARC_DOMAIN);
      expect(domainFor("stellar")).toBe(STELLAR_DOMAIN);
    });
  });

  describe("isDeterministicError", () => {
    it("identifies AmountPrecisionError as deterministic", () => {
      const err = new AmountPrecisionError("1.0000001", 7, 6, "stellar");
      expect(isDeterministicError(err)).toBe(true);
      expect(isTransientError(err)).toBe(false);
    });

    it("identifies bad/invalid addresses as deterministic", () => {
      expect(isDeterministicError(new Error("invalid address format"))).toBe(true);
      expect(isDeterministicError(new Error("bad address provided"))).toBe(true);
      expect(isTransientError(new Error("invalid address format"))).toBe(false);
    });

    it("identifies insufficient balance/funds as deterministic", () => {
      expect(isDeterministicError(new Error("insufficient balance on source chain"))).toBe(true);
      expect(isDeterministicError(new Error("insufficient funds for gas"))).toBe(true);
      expect(isTransientError(new Error("insufficient balance on source chain"))).toBe(false);
    });

    it("identifies unready recipient / trustline errors as deterministic", () => {
      expect(
        isDeterministicError(new Error("Stellar recipient needs activation and trustline")),
      ).toBe(true);
      expect(
        isTransientError(new Error("Stellar recipient needs activation and trustline")),
      ).toBe(false);
    });

    it("returns false for non-deterministic errors", () => {
      expect(isDeterministicError(new Error("connection reset"))).toBe(false);
      expect(isDeterministicError(new Error("gateway timeout"))).toBe(false);
    });
  });

  describe("isTransientError", () => {
    it("identifies HTTP 5xx and 429 as transient", () => {
      expect(isTransientError({ status: 429 })).toBe(true);
      expect(isTransientError({ status: 500 })).toBe(true);
      expect(isTransientError({ status: 502 })).toBe(true);
      expect(isTransientError({ status: 503 })).toBe(true);
      expect(isTransientError({ status: 504 })).toBe(true);
    });

    it("identifies network error codes as transient", () => {
      expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
      expect(isTransientError({ code: "EAI_AGAIN" })).toBe(true);
      expect(isTransientError({ code: "ENETUNREACH" })).toBe(true);
    });

    it("identifies AttestationNotReadyError and IrisRequestError as transient", () => {
      const notReady = new AttestationNotReadyError("attestation pending", "0xhash");
      expect(isTransientError(notReady)).toBe(true);

      const iris503 = new IrisRequestError("Iris unavailable", 503);
      expect(isTransientError(iris503)).toBe(true);
    });

    it("identifies common transient messages", () => {
      expect(isTransientError(new Error("fetch failed"))).toBe(true);
      expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
      expect(isTransientError(new Error("server error occurred"))).toBe(true);
      expect(isTransientError(new Error("RPC node error: timeout"))).toBe(true);
    });
  });

  describe("runSmokeStep", () => {
    it("passes immediately on successful operation", async () => {
      const op = vi.fn().mockResolvedValue("success-value");
      const result = await runSmokeStep("test:step", op);

      expect(result.status).toBe("PASS");
      expect(result.attempts).toBe(1);
      expect(result.value).toBe("success-value");
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("retries on transient error and succeeds", async () => {
      let count = 0;
      const op = vi.fn().mockImplementation(async () => {
        count++;
        if (count < 3) {
          throw Object.assign(new Error("transient timeout"), { status: 503 });
        }
        return "recovered";
      });

      const sleep = vi.fn().mockResolvedValue(undefined);
      const log = { warn: vi.fn() };

      const result = await runSmokeStep("test:step", op, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 2,
        sleep,
        log,
      });

      expect(result.status).toBe("PASS");
      expect(result.attempts).toBe(3);
      expect(result.value).toBe("recovered");
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenNthCalledWith(1, 10);
      expect(sleep).toHaveBeenNthCalledWith(2, 20);
    });

    it("fails immediately without retry on deterministic error", async () => {
      const op = vi.fn().mockRejectedValue(new Error("bad address format"));
      const sleep = vi.fn();

      const result = await runSmokeStep("test:step", op, {
        maxRetries: 3,
        safeToRetry: true,
        sleep,
      });

      expect(result.status).toBe("FAIL");
      expect(result.attempts).toBe(1);
      expect(result.error?.message).toContain("bad address format");
      expect(sleep).not.toHaveBeenCalled();
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("fails immediately when safeToRetry is false", async () => {
      const op = vi.fn().mockRejectedValue(Object.assign(new Error("503 timeout"), { status: 503 }));
      const sleep = vi.fn();

      const result = await runSmokeStep("burn", op, {
        maxRetries: 3,
        safeToRetry: false,
        sleep,
      });

      expect(result.status).toBe("FAIL");
      expect(result.attempts).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("stops after exceeding maxRetries on persistent transient error", async () => {
      const op = vi.fn().mockRejectedValue(Object.assign(new Error("502 error"), { status: 502 }));
      const sleep = vi.fn().mockResolvedValue(undefined);
      const log = { warn: vi.fn() };

      const result = await runSmokeStep("poll", op, {
        maxRetries: 2,
        initialDelayMs: 10,
        sleep,
        log,
      });

      expect(result.status).toBe("FAIL");
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
      expect(sleep).toHaveBeenCalledTimes(2);
    });
  });

  describe("formatStepSummary", () => {
    it("formats summary with all steps, attempts, duration and totals", () => {
      const steps = [
        { name: "arc -> stellar: fund/check", status: "PASS", durationMs: 45, attempts: 1 },
        { name: "arc -> stellar: approve+burn", status: "PASS", durationMs: 2500, attempts: 1 },
        { name: "arc -> stellar: attestation wait", status: "PASS", durationMs: 15200, attempts: 3 },
        { name: "arc -> stellar: mint", status: "FAIL", durationMs: 3100, attempts: 2 },
      ];

      const output = formatStepSummary(steps);
      expect(output).toContain("Smoke Test Step Summary");
      expect(output).toContain("PASS  arc -> stellar: fund/check (45ms, 1 attempt)");
      expect(output).toContain("PASS  arc -> stellar: attestation wait (15200ms, 3 attempts)");
      expect(output).toContain("FAIL  arc -> stellar: mint (3100ms, 2 attempts)");
      expect(output).toContain("Total: 3 passed, 1 failed (4 total)");
    });
  });

  describe("formatRecoveryCommand", () => {
    it("generates completeMint command with burnTxHash and chain info", () => {
      const cmd = formatRecoveryCommand(
        { from: "arc", to: "stellar", network: "testnet" },
        "0x1234567890abcdef",
      );

      expect(cmd).toContain("Recover with completeMint(");
      expect(cmd).toContain('"burnTxHash": "0x1234567890abcdef"');
      expect(cmd).toContain('"from": "arc"');
      expect(cmd).toContain('"to": "stellar"');
      expect(cmd).toContain('"network": "testnet"');
      expect(cmd).toContain('"signer": "<destination-chain signer>"');
    });
  });
});
