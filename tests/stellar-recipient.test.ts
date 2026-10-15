import { describe, it, expect, vi, afterEach } from "vitest";
import { Account, Keypair, rpc } from "@stellar/stellar-sdk";
import { checkStellarRecipientReady } from "../src/chains/stellar.js";
import { StellarRpcError } from "../src/errors.js";

const RECIPIENT = Keypair.random().publicKey();

afterEach(() => {
  vi.restoreAllMocks();
});

function mockGetAccountOnce(impl: () => Promise<never> | Promise<Account>) {
  vi.spyOn(rpc.Server.prototype, "getAccount").mockImplementationOnce(impl as () => Promise<Account>);
}

describe("checkStellarRecipientReady RPC error handling", () => {
  it("maps SDK account-not-found to exists:false", async () => {
    const notFound = Object.assign(new Error("Account not found"), { name: "NotFoundError" });
    mockGetAccountOnce(() => Promise.reject(notFound));
    await expect(checkStellarRecipientReady(RECIPIENT, "mainnet")).resolves.toEqual({
      exists: false,
      hasTrustline: false,
      ready: false,
    });
  });

  it("maps 404 status to exists:false", async () => {
    const notFound = Object.assign(new Error("could not find account"), { status: 404 });
    mockGetAccountOnce(() => Promise.reject(notFound));
    await expect(checkStellarRecipientReady(RECIPIENT, "mainnet")).resolves.toEqual({
      exists: false,
      hasTrustline: false,
      ready: false,
    });
  });

  it("rejects with StellarRpcError on 503 instead of reporting not-exists", async () => {
    const outage = Object.assign(new Error("Service Unavailable"), { status: 503 });
    mockGetAccountOnce(() => Promise.reject(outage));
    await expect(checkStellarRecipientReady(RECIPIENT, "mainnet")).rejects.toBeInstanceOf(StellarRpcError);
  });

  it("rejects with StellarRpcError on transport failure instead of reporting not-exists", async () => {
    mockGetAccountOnce(() => Promise.reject(new TypeError("fetch failed")));
    await expect(checkStellarRecipientReady(RECIPIENT, "mainnet")).rejects.toBeInstanceOf(StellarRpcError);
  });
});
