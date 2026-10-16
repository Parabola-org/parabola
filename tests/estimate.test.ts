import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchFastTransferFeeBps = vi.fn();

vi.mock("../src/iris/poll.js", () => ({
  fetchFastTransferFeeBps: (...args: unknown[]) => fetchFastTransferFeeBps(...args),
}));

const { estimateFee } = await import("../src/estimate.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("estimateFee", () => {
  it("returns a zero protocol fee for standard transfers without calling Iris", async () => {
    const estimate = await estimateFee({
      from: "arc",
      to: "stellar",
      amount: "100",
      speed: "standard",
    });

    expect(estimate).toMatchObject({ protocolFee: "0", transferMode: "standard" });
    expect(fetchFastTransferFeeBps).not.toHaveBeenCalled();
  });

  it("computes the protocol fee for fast transfers from the quoted basis points", async () => {
    fetchFastTransferFeeBps.mockResolvedValue(10); // 0.1%

    const estimate = await estimateFee({
      from: "arc",
      to: "stellar",
      amount: "100",
      speed: "fast",
    });

    expect(estimate.transferMode).toBe("fast");
    expect(estimate.protocolFee).toBe("0.1");
  });

  it("defaults to mainnet, quoting fees against the production Iris API", async () => {
    fetchFastTransferFeeBps.mockResolvedValue(10);

    await estimateFee({ from: "arc", to: "stellar", amount: "100", speed: "fast" });

    expect(fetchFastTransferFeeBps).toHaveBeenCalledWith(26, 27, false);
  });

  it("quotes against the sandbox Iris API when network is testnet", async () => {
    fetchFastTransferFeeBps.mockResolvedValue(10);

    await estimateFee({ from: "arc", to: "stellar", amount: "100", speed: "fast", network: "testnet" });

    expect(fetchFastTransferFeeBps).toHaveBeenCalledWith(26, 27, true);
  });
});

describe("estimateFee maxFee / maxWait parity with transfer()", () => {
  it("returns standard when the quoted fast fee exceeds maxFee", async () => {
    fetchFastTransferFeeBps.mockResolvedValue(10); // 0.1% → 0.1 on a 100 transfer

    const estimate = await estimateFee({
      from: "arc",
      to: "stellar",
      amount: "100",
      speed: "fast",
      maxFee: "0.05",
    });

    expect(estimate).toMatchObject({ transferMode: "standard", protocolFee: "0" });
  });

  it("stays fast when the quoted fee is within maxFee", async () => {
    fetchFastTransferFeeBps.mockResolvedValue(10);

    const estimate = await estimateFee({
      from: "arc",
      to: "stellar",
      amount: "100",
      speed: "fast",
      maxFee: "0.5",
    });

    expect(estimate).toMatchObject({ transferMode: "fast", protocolFee: "0.1" });
  });

  it("returns standard when the fast duration exceeds maxWait — without touching Iris", async () => {
    const estimate = await estimateFee({
      from: "arc",
      to: "stellar",
      amount: "100",
      speed: "fast",
      maxWait: 5, // FAST_DURATION_SECONDS is 15
    });

    expect(estimate).toMatchObject({ transferMode: "standard", protocolFee: "0" });
    expect(fetchFastTransferFeeBps).not.toHaveBeenCalled();
  });
});
