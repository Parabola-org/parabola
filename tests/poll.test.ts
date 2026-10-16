import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFastTransferFeeBps, pollForAttestation } from "../src/iris/poll.js";
import { AttestationNotReadyError, IrisRequestError } from "../src/errors.js";

const COMPLETE_BODY = {
  messages: [{ status: "complete", attestation: "0xabc", message: "0xdef" }],
};

const PENDING_BODY = {
  messages: [{ status: "pending_confirmations", attestation: null, message: null }],
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status: number) {
  return { ok: false, status, statusText: `HTTP ${status}` };
}

/** Serves a scripted sequence of responses, one per fetch call, and counts the calls. */
function scriptFetch(responses: unknown[]) {
  const calls = { count: 0 };
  global.fetch = vi.fn().mockImplementation(async () => {
    const response = responses[Math.min(calls.count, responses.length - 1)];
    calls.count += 1;
    return response;
  }) as unknown as typeof fetch;
  return calls;
}

const POLL = { sourceDomain: 26, transactionHash: "0xburn", useSandbox: true } as const;

describe("fetchFastTransferFeeBps", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses Iris's real response shape: a bare array, not { data: [...] }", async () => {
    // Verified directly against https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/27,
    // which returns [{"finalityThreshold":1000,"minimumFee":0},...] with no wrapper object.
    // The code used to assume `{ data: [...] }` and threw "body.data is undefined" on every
    // real fast-transfer fee lookup; this guards against that shape assumption regressing.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { finalityThreshold: 2000, minimumFee: 5 },
        { finalityThreshold: 1000, minimumFee: 2 },
      ],
    }) as unknown as typeof fetch;

    const feeBps = await fetchFastTransferFeeBps(26, 27, true);

    expect(feeBps).toBe(2);
  });

  it("rejects with IrisRequestError and the HTTP status when the request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }) as unknown as typeof fetch;

    const failure = fetchFastTransferFeeBps(26, 27, true);

    await expect(failure).rejects.toThrow(IrisRequestError);
    await expect(failure).rejects.toThrow("Iris fees request failed: 500");
    await expect(
      fetchFastTransferFeeBps(26, 27, true).catch((err) => (err as IrisRequestError).status),
    ).resolves.toBe(500);
  });

  it("rejects instead of pricing at zero when no entry is at or under the fast finality threshold", async () => {
    // Returning 0 here silently quoted a free fast transfer whenever Iris
    // dropped the <=1000 tier, changed shape, or answered []. An unpriced fee
    // is a failure the caller must see before anything is burned.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ finalityThreshold: 2000, minimumFee: 5 }],
    }) as unknown as typeof fetch;

    const failure = fetchFastTransferFeeBps(26, 27, true);

    await expect(failure).rejects.toThrow(IrisRequestError);
    // The error names the domain pair so the failing route is diagnosable
    // without knowing which call site quoted it.
    await expect(failure).rejects.toThrow(/26 -> 27/);
  });

  it("rejects when Iris answers with an empty fee list", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    }) as unknown as typeof fetch;

    await expect(fetchFastTransferFeeBps(27, 26, true)).rejects.toThrow(/27 -> 26/);
  });

  it("still resolves at the exact threshold boundary of 1000", async () => {
    // 1000 is the fast finality threshold itself; entry.finalityThreshold <= 1000
    // must keep including it, not push it over to the standard tier.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ finalityThreshold: 1000, minimumFee: 3 }],
    }) as unknown as typeof fetch;

    const feeBps = await fetchFastTransferFeeBps(26, 27, true);

    expect(feeBps).toBe(3);
  });
});

describe("pollForAttestation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps polling through the 404 Iris returns before it has indexed a burn", async () => {
    // A 404 here is the normal state for the first polls of any transfer. Treating it as an
    // error would fail transfers that are working exactly as intended.
    const calls = scriptFetch([
      errorResponse(404),
      errorResponse(404),
      okResponse(COMPLETE_BODY),
    ]);

    const message = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 1000 });

    expect(message.attestation).toBe("0xabc");
    expect(calls.count).toBe(3);
  });

  it("throws AttestationNotReadyError when the deadline passes without an attestation", async () => {
    scriptFetch([okResponse(PENDING_BODY)]);

    const err = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 20 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(AttestationNotReadyError);
    expect((err as AttestationNotReadyError).burnTxHash).toBe("0xburn");
  });

  it("surfaces a persistent 5xx as IrisRequestError instead of absorbing it into the timeout", async () => {
    scriptFetch([errorResponse(503)]);

    const err = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 10_000 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(IrisRequestError);
    expect((err as IrisRequestError).status).toBe(503);
  });

  it("surfaces a transport failure as IrisRequestError when it persists", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;

    const err = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 10_000 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(IrisRequestError);
    expect((err as IrisRequestError).status).toBeUndefined();
  });

  it("rides out an isolated failure and still resolves", async () => {
    scriptFetch([errorResponse(500), okResponse(COMPLETE_BODY)]);

    const message = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 1000 });

    expect(message.attestation).toBe("0xabc");
  });

  it("counts only consecutive failures, so an interspersed success resets the tally", async () => {
    // Four failures, a healthy pending poll, then four more failures, then the attestation.
    // A cumulative counter would abort on the fifth failure and never reach the result.
    scriptFetch([
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      okResponse(PENDING_BODY),
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
      okResponse(COMPLETE_BODY),
    ]);

    const message = await pollForAttestation({ ...POLL, pollInterval: 1, pollTimeout: 5000 });

    expect(message.attestation).toBe("0xabc");
  });
});
