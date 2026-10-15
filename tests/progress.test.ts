import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TransferProgressEvent, TransferProgressStage } from "../src/index.js";

const approveUsdcOnArc = vi.fn();
const burnUsdcOnArc = vi.fn();
const burnUsdcOnArcWithStellarForward = vi.fn();
const receiveMessageOnArc = vi.fn();
const approveUsdcOnStellar = vi.fn();
const burnUsdcOnStellar = vi.fn();
const mintAndForwardOnStellar = vi.fn();
const checkStellarRecipientReady = vi.fn();
const fetchFastTransferFeeBps = vi.fn();
const pollForAttestation = vi.fn();
const getAttestation = vi.fn();

vi.mock("../src/chains/arc.js", () => ({
  approveUsdcOnArc: (...args: unknown[]) => approveUsdcOnArc(...args),
  burnUsdcOnArc: (...args: unknown[]) => burnUsdcOnArc(...args),
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

const { transfer } = await import("../src/transfer.js");
const { TransferError } = await import("../src/errors.js");
const { encodeStellarForwardHook } = await import("../src/utils/encoding.js");

const FORWARD_RECIPIENT = "GCY3PLGZQZWVKQELW7GCHQVLVZGRMGI5R4HODX6QZM7ETJSPHBFVJPY2";

function buildBurnMessage(options: { forwardRecipient?: string } = {}): `0x${string}` {
  const header = Buffer.alloc(148);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(26, 4);
  header.writeUInt32BE(27, 8);

  const body = Buffer.alloc(228);
  body.writeUInt32BE(1, 0);

  const hook =
    options.forwardRecipient === undefined
      ? Buffer.alloc(0)
      : Buffer.from(encodeStellarForwardHook(options.forwardRecipient).slice(2), "hex");

  return `0x${Buffer.concat([header, body, hook]).toString("hex")}`;
}

const arcSigner = { walletClient: {} } as any;
const stellarSigner = { publicKey: "GABCD" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  approveUsdcOnArc.mockResolvedValue("0xapprovehash");
  burnUsdcOnArc.mockResolvedValue("0xburnhash");
  burnUsdcOnArcWithStellarForward.mockResolvedValue("0xburnhookhash");
  approveUsdcOnStellar.mockResolvedValue("stellarapprovehash");
  burnUsdcOnStellar.mockResolvedValue("stellarburnhash");
  checkStellarRecipientReady.mockResolvedValue({ exists: true, hasTrustline: true, ready: true });
  pollForAttestation.mockResolvedValue({
    message: buildBurnMessage({ forwardRecipient: FORWARD_RECIPIENT }),
    attestation: "0xattestation",
  });
  getAttestation.mockResolvedValue({
    message: buildBurnMessage({ forwardRecipient: FORWARD_RECIPIENT }),
    attestation: "0xattestation",
  });
  receiveMessageOnArc.mockResolvedValue("0xminthash");
  mintAndForwardOnStellar.mockResolvedValue("stellarminthash");
});

describe("transfer progress callbacks (onProgress)", () => {
  it("emits the expected stage sequence in order with burnTxHash present from burn-submitted onward (Arc -> Stellar)", async () => {
    const events: TransferProgressEvent[] = [];

    const result = await transfer({
      from: "arc",
      to: "stellar",
      amount: "10",
      recipient: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
      speed: "standard",
      signer: arcSigner,
      options: {
        destinationSigner: stellarSigner,
        onProgress: (event) => {
          events.push(event);
        },
      },
    });

    expect(result.status).toBe("success");
    expect(result.burnTxHash).toBe("0xburnhookhash");
    expect(result.mintTxHash).toBe("stellarminthash");

    const expectedStages: TransferProgressStage[] = [
      "recipient-check",
      "approve",
      "burn-submitted",
      "burn-confirmed",
      "attestation",
      "mint-submitted",
      "mint-confirmed",
    ];

    expect(events.map((e) => e.stage)).toEqual(expectedStages);

    // Timestamps must be valid positive epoch numbers
    for (const event of events) {
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);
    }

    // burnTxHash must NOT be present before burn-submitted
    expect("burnTxHash" in (events[0] ?? {})).toBe(false);
    expect("burnTxHash" in (events[1] ?? {})).toBe(false);

    // burnTxHash MUST be present from burn-submitted onward
    for (let i = 2; i < events.length; i++) {
      const e = events[i] as any;
      expect(e.burnTxHash).toBe("0xburnhookhash");
    }

    // mint stage payloads
    const mintSubmitted = events[5] as any;
    expect(mintSubmitted?.stage).toBe("mint-submitted");
    expect(mintSubmitted?.attestationHash).toBe("0xattestation");

    const mintConfirmed = events[6] as any;
    expect(mintConfirmed?.stage).toBe("mint-confirmed");
    expect(mintConfirmed?.attestationHash).toBe("0xattestation");
    expect(mintConfirmed?.mintTxHash).toBe("stellarminthash");
  });

  it("emits expected stages for Stellar -> Arc transfers", async () => {
    const events: TransferProgressEvent[] = [];

    const result = await transfer({
      from: "stellar",
      to: "arc",
      amount: "25",
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      speed: "standard",
      signer: stellarSigner,
      options: {
        destinationSigner: arcSigner,
        onProgress: (e) => events.push(e),
      },
    });

    expect(result.status).toBe("success");
    expect(result.burnTxHash).toBe("stellarburnhash");
    expect(result.mintTxHash).toBe("0xminthash");

    const stages = events.map((e) => e.stage);
    expect(stages).toEqual([
      "approve",
      "burn-submitted",
      "burn-confirmed",
      "attestation",
      "mint-submitted",
      "mint-confirmed",
    ]);

    for (const e of events) {
      expect((e as any).burnTxHash === undefined || (e as any).burnTxHash === "stellarburnhash").toBe(true);
    }
    expect((events[0] as any)?.burnTxHash).toBeUndefined();
    expect((events[1] as any)?.burnTxHash).toBe("stellarburnhash");
  });

  it("emits stages up to attestation when destinationSigner is omitted (pending transfer)", async () => {
    const events: TransferProgressEvent[] = [];

    const result = await transfer({
      from: "arc",
      to: "stellar",
      amount: "10",
      recipient: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
      speed: "standard",
      signer: arcSigner,
      options: {
        onProgress: (e) => events.push(e),
      },
    });

    expect(result.status).toBe("pending");
    expect(result.burnTxHash).toBe("0xburnhookhash");
    expect(result.mintTxHash).toBe("");

    expect(events.map((e) => e.stage)).toEqual([
      "recipient-check",
      "approve",
      "burn-submitted",
      "burn-confirmed",
      "attestation",
    ]);
  });

  it("swallows exceptions thrown from onProgress without altering the transfer result", async () => {
    let callCount = 0;

    const result = await transfer({
      from: "arc",
      to: "stellar",
      amount: "10",
      recipient: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
      speed: "standard",
      signer: arcSigner,
      options: {
        destinationSigner: stellarSigner,
        onProgress: () => {
          callCount++;
          throw new Error("Observer threw unexpected error!");
        },
      },
    });

    // Transfer succeeds completely despite observer erroring on every callback
    expect(callCount).toBe(7);
    expect(result.status).toBe("success");
    expect(result.burnTxHash).toBe("0xburnhookhash");
    expect(result.mintTxHash).toBe("stellarminthash");
  });

  it("swallows exceptions thrown from onProgress during transfer failures without hiding original error", async () => {
    checkStellarRecipientReady.mockResolvedValue({ exists: false, hasTrustline: false, ready: false });

    let callCount = 0;
    await expect(
      transfer({
        from: "arc",
        to: "stellar",
        amount: "10",
        recipient: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
        speed: "standard",
        signer: arcSigner,
        options: {
          onProgress: () => {
            callCount++;
            throw new Error("Observer throw should not mask underlying recipient error");
          },
        },
      }),
    ).rejects.toThrow("Stellar recipient GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI does not exist yet");

    expect(callCount).toBe(1);
  });
});
