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

  describe("maxFee and maxWait fallback handling", () => {
    it("falls back to standard when quoted fee exceeds maxFee", async () => {
      fetchFastTransferFeeBps.mockResolvedValue(100); // 1% -> $1.00 fee

      const estimate = await estimateFee({
        from: "arc",
        to: "stellar",
        amount: "100",
        speed: "fast",
        maxFee: "0.01",
      });

      expect(estimate).toEqual({
        protocolFee: "0",
        estimatedDurationSeconds: 20,
        transferMode: "standard",
      });
    });

    it("stays in fast mode when quoted fee equals maxFee exactly", async () => {
      fetchFastTransferFeeBps.mockResolvedValue(10); // 0.1% -> $0.10 fee

      const estimate = await estimateFee({
        from: "arc",
        to: "stellar",
        amount: "100",
        speed: "fast",
        maxFee: "0.1",
      });

      expect(estimate).toEqual({
        protocolFee: "0.1",
        estimatedDurationSeconds: 15,
        transferMode: "fast",
      });
    });

    it("falls back to standard when fast duration exceeds maxWait without querying Iris", async () => {
      const estimate = await estimateFee({
        from: "arc",
        to: "stellar",
        amount: "100",
        speed: "fast",
        maxWait: 10,
      });

      expect(estimate).toEqual({
        protocolFee: "0",
        estimatedDurationSeconds: 20,
        transferMode: "standard",
      });
      expect(fetchFastTransferFeeBps).not.toHaveBeenCalled();
    });

    it("stays in fast mode when maxWait equals fast duration estimate", async () => {
      fetchFastTransferFeeBps.mockResolvedValue(10);

      const estimate = await estimateFee({
        from: "arc",
        to: "stellar",
        amount: "100",
        speed: "fast",
        maxWait: 15,
      });

      expect(estimate).toEqual({
        protocolFee: "0.1",
        estimatedDurationSeconds: 15,
        transferMode: "fast",
      });
    });

    it("returns standard without calling Iris when speed is standard even if maxFee/maxWait are set", async () => {
      const estimate = await estimateFee({
        from: "arc",
        to: "stellar",
        amount: "100",
        speed: "standard",
        maxFee: "0.01",
        maxWait: 10,
      });

      expect(estimate).toEqual({
        protocolFee: "0",
        estimatedDurationSeconds: 20,
        transferMode: "standard",
      });
      expect(fetchFastTransferFeeBps).not.toHaveBeenCalled();
    });

    it("properly scales maxFee for 7-decimal Stellar source chain", async () => {
      fetchFastTransferFeeBps.mockResolvedValue(100); // 1% -> $1.00 fee

      const estimate = await estimateFee({
        from: "stellar",
        to: "arc",
        amount: "100",
        speed: "fast",
        maxFee: "0.5",
      });

      expect(estimate).toEqual({
        protocolFee: "0",
        estimatedDurationSeconds: 20,
        transferMode: "standard",
      });
    });
  });
});
