import { describe, it, expect, vi, afterEach } from "vitest";
import { pollForAttestation, getAttestation } from "../src/iris/poll.js";
import { completeMint, transfer } from "../src/transfer.js";

const PENDING_BODY = {
  messages: [{ status: "pending_confirmations", attestation: null, message: null }],
};

const COMPLETE_BODY = {
  messages: [{ status: "complete", attestation: "0xabc", message: "0xdef" }],
};

describe("AbortSignal Support", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("pollForAttestation with AbortSignal", () => {
    it("immediately throws AbortError if signal is already aborted before polling starts", async () => {
      const controller = new AbortController();
      controller.abort();

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await expect(
        pollForAttestation({
          sourceDomain: 26,
          transactionHash: "0xburn",
          useSandbox: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow();

      // Ensure fetch was never called
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("aborts in-flight polling when signal is aborted mid-sleep", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => PENDING_BODY,
      });

      const controller = new AbortController();
      const start = Date.now();

      // Trigger abort after 50ms, while pollTimeout is set to 10 seconds
      setTimeout(() => controller.abort(), 50);

      const promise = pollForAttestation({
        sourceDomain: 26,
        transactionHash: "0xburn",
        useSandbox: true,
        pollInterval: 1000,
        pollTimeout: 10000,
        signal: controller.signal,
      });

      await expect(promise).rejects.toThrow();
      const elapsed = Date.now() - start;
      // Should have exited in ~50-150ms, way before the 10000ms timeout
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("getAttestation with AbortSignal", () => {
    it("immediately throws AbortError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        getAttestation({
          sourceDomain: 26,
          transactionHash: "0xburn",
          useSandbox: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });
  });

  describe("completeMint with AbortSignal", () => {
    it("aborts immediately when options.signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        completeMint({
          from: "arc",
          to: "stellar",
          burnTxHash: "0xburn",
          signer: { publicKey: "GBTEST" } as any,
          options: {
            signal: controller.signal,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("transfer with AbortSignal", () => {
    it("aborts immediately when options.signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        transfer({
          from: "arc",
          to: "stellar",
          amount: "10",
          recipient: "GBTEST",
          speed: "standard",
          signer: { walletClient: {} } as any,
          options: {
            signal: controller.signal,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
