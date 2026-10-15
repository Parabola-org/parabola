import { describe, expect, it, vi } from "vitest";
import { pollTransactionStatus, STELLAR_MAX_CONSECUTIVE_FAILURES } from "../src/chains/stellar.js";
import { SubmissionTimeoutError } from "../src/errors.js";

describe("pollTransactionStatus transient RPC tolerance", () => {
  it("resolves with hash after N-1 transient throws then SUCCESS", async () => {
    const hash = "abc123";
    const getTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue({ status: "SUCCESS" });
    const server = { getTransaction } as never;
    await expect(pollTransactionStatus(server, hash)).resolves.toBe(hash);
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it("rejects with SubmissionTimeoutError carrying .hash when getTransaction always throws", async () => {
    const hash = "deadbeef";
    const getTransaction = vi.fn().mockRejectedValue(new Error("boom"));
    const server = { getTransaction } as never;
    const err = await pollTransactionStatus(server, hash).catch((e) => e);
    expect(err).toBeInstanceOf(SubmissionTimeoutError);
    expect((err as SubmissionTimeoutError).hash).toBe(hash);
    expect(getTransaction.mock.calls.length).toBe(STELLAR_MAX_CONSECUTIVE_FAILURES);
  });

  it("FAILED status rejects immediately without exhausting retries", async () => {
    const hash = "failed1";
    const getTransaction = vi.fn().mockResolvedValue({ status: "FAILED" });
    const server = { getTransaction } as never;
    await expect(pollTransactionStatus(server, hash)).rejects.toThrow();
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });
});
