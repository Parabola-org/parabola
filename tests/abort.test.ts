import { describe, it, expect, vi, beforeEach } from "vitest";

const approveUsdcOnArc = vi.fn();
const burnUsdcOnArcWithStellarForward = vi.fn();
const receiveMessageOnArc = vi.fn();
const approveUsdcOnStellar = vi.fn();
const burnUsdcOnStellar = vi.fn();
const mintAndForwardOnStellar = vi.fn();
const checkStellarRecipientReady = vi.fn();
const pollForAttestation = vi.fn();
const getAttestation = vi.fn();
const fetchFastTransferFeeBps = vi.fn();

vi.mock("../src/chains/arc.js", () => ({
  approveUsdcOnArc: (...args: unknown[]) => approveUsdcOnArc(...args),
  burnUsdcOnArcWithStellarForward: (...args: unknown[]) => burnUsdcOnArcWithStellarForward(...args),
  receiveMessageOnArc: (...args: unknown[]) => receiveMessageOnArc(...args),
}));

vi.mock("../src/chains/stellar.js", () => ({
  approveUsdcOnStellar: (...args: unknown[]) => approveUsdcOnStellar(...args),
  burnUsdcOnStellar: (...args: unknown[]) => burnUsdcOnStellar(...args),
  mintAndForwardOnStellar: (...args: unknown[]) => mintAndForwardOnStellar(...args),
  checkStellarRecipientReady: (...args: unknown[]) => checkStellarRecipientReady(...args),
}));

vi.mock("../src/iris/poll.js", () => ({
  fetchFastTransferFeeBps: (...args: unknown[]) => fetchFastTransferFeeBps(...args),
  pollForAttestation: (...args: unknown[]) => pollForAttestation(...args),
  getAttestation: (...args: unknown[]) => getAttestation(...args),
}));

const { transfer, completeMint } = await import("../src/transfer.js");
const { TransferError } = await import("../src/errors.js");

const stellarSigner = { publicKey: "GABCD" } as any;

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

const STELLAR_TRANSFER = {
  from: "stellar",
  to: "arc",
  amount: "25",
  recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  speed: "standard",
  signer: stellarSigner,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  receiveMessageOnArc.mockResolvedValue("0xminthash");
  approveUsdcOnStellar.mockResolvedValue("stellarapprovehash");
  burnUsdcOnStellar.mockResolvedValue("stellarburnhash");
  pollForAttestation.mockResolvedValue({
    message: "0xmessage",
    attestation: "0xattestation",
  });
});

describe("transfer abort semantics", () => {
  it("rejects with a plain AbortError and submits nothing when aborted before the burn", async () => {
    const controller = new AbortController();
    controller.abort();

    const err = await transfer({
      ...STELLAR_TRANSFER,
      options: { signal: controller.signal },
    }).catch((e) => e);

    expect(err).toMatchObject({ name: "AbortError" });
    expect(err).not.toBeInstanceOf(TransferError);
    expect(approveUsdcOnStellar).not.toHaveBeenCalled();
    expect(burnUsdcOnStellar).not.toHaveBeenCalled();
  });

  it("rejects with a TransferError carrying the real burnTxHash when aborted after the burn", async () => {
    // Simulate a poll that hangs until cancellation, the way a real in-flight
    // pollForAttestation behaves when its signal aborts.
    pollForAttestation.mockImplementation(
      (params: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          params.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    );

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const err = await transfer({
      ...STELLAR_TRANSFER,
      options: { signal: controller.signal },
    }).catch((e) => e);

    expect(err).toBeInstanceOf(TransferError);
    expect(err.burnTxHash).toBe("stellarburnhash");
    expect(err).not.toMatchObject({ name: "AbortError" });
  });

  it("threads options.signal through to pollForAttestation", async () => {
    const controller = new AbortController();

    await transfer({
      ...STELLAR_TRANSFER,
      options: { signal: controller.signal },
    });

    expect(pollForAttestation.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });
});

describe("completeMint abort semantics", () => {
  it("threads options.signal through to pollForAttestation", async () => {
    mintAndForwardOnStellar.mockResolvedValue("stellarminthash");
    const controller = new AbortController();

    await completeMint({
      from: "stellar",
      to: "arc",
      burnTxHash: "stellarburnhash",
      signer: stellarSigner,
      options: { signal: controller.signal },
    });

    expect(pollForAttestation.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });
});
