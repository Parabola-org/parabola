import { describe, it, expect } from "vitest";
import { AmountPrecisionError } from "../src/index.js";
import type {
  ArcSigner,
  CompleteMintParams,
  StellarSigner,
  TransferParams,
} from "../src/types.js";
import type { Keypair } from "@stellar/stellar-sdk";

const STELLAR_ACCOUNT = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const EVM_ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const arcSigner = {} as ArcSigner;
const keypairSigner = {
  publicKey: STELLAR_ACCOUNT,
  keypair: {} as Keypair,
} satisfies StellarSigner;
const customSigner = {
  publicKey: STELLAR_ACCOUNT,
  signTransaction: async (xdr: string) => xdr,
} satisfies StellarSigner;

/**
 * These cases assert the compiler's behavior rather than the runtime's. `pnpm typecheck`
 * compiles this file, so each @ts-expect-error below fails the build if the expression it
 * guards ever starts compiling, which is what makes a mismatched signer or an unbuildable
 * StellarSigner a build error for callers instead of a throw after a chain round trip.
 */
describe("signer shape", () => {
  it("builds a Stellar signer from either a keypair or a custom sign function", () => {
    expect([keypairSigner.publicKey, customSigner.publicKey]).toEqual([
      STELLAR_ACCOUNT,
      STELLAR_ACCOUNT,
    ]);
  });

  it("allows a signer that carries both routes, preferring the custom function", () => {
    const both = {
      publicKey: STELLAR_ACCOUNT,
      keypair: {} as Keypair,
      signTransaction: async (xdr: string) => xdr,
    } satisfies StellarSigner;

    expect(both.publicKey).toBe(STELLAR_ACCOUNT);
  });

  it("rejects a Stellar signer with no signing route", () => {
    // @ts-expect-error a StellarSigner must carry a keypair or a signTransaction function
    const noRoute: StellarSigner = { publicKey: STELLAR_ACCOUNT };

    expect(noRoute.publicKey).toBe(STELLAR_ACCOUNT);
  });
});

describe("transfer direction and signer", () => {
  it("accepts a signer native to the source chain in both directions", () => {
    const arcToStellar = {
      from: "arc",
      to: "stellar",
      amount: "10",
      recipient: STELLAR_ACCOUNT,
      speed: "standard",
      signer: arcSigner,
    } satisfies TransferParams;

    const stellarToArc = {
      from: "stellar",
      to: "arc",
      amount: "10",
      recipient: EVM_ACCOUNT,
      speed: "standard",
      signer: keypairSigner,
    } satisfies TransferParams;

    expect([arcToStellar.from, stellarToArc.from]).toEqual(["arc", "stellar"]);
  });

  it("rejects a Stellar signer on an Arc-sourced transfer", () => {
    // @ts-expect-error an Arc-sourced transfer burns on Arc, so the signer must be an ArcSigner
    const wrong: TransferParams = { from: "arc", to: "stellar", amount: "10", recipient: STELLAR_ACCOUNT, speed: "standard", signer: keypairSigner };

    expect(wrong.from).toBe("arc");
  });

  it("rejects an Arc signer on a Stellar-sourced transfer", () => {
    // @ts-expect-error a Stellar-sourced transfer burns on Stellar, so the signer must be a StellarSigner
    const wrong: TransferParams = { from: "stellar", to: "arc", amount: "10", recipient: EVM_ACCOUNT, speed: "standard", signer: arcSigner };

    expect(wrong.from).toBe("stellar");
  });
});

describe("transfer destination signer", () => {
  it("accepts a destination signer native to the destination chain in both directions", () => {
    const mintOnStellar = {
      from: "arc",
      to: "stellar",
      amount: "10",
      recipient: STELLAR_ACCOUNT,
      speed: "standard",
      signer: arcSigner,
      options: { destinationSigner: keypairSigner },
    } satisfies TransferParams;

    const mintOnArc = {
      from: "stellar",
      to: "arc",
      amount: "10",
      recipient: EVM_ACCOUNT,
      speed: "standard",
      signer: keypairSigner,
      options: { destinationSigner: arcSigner },
    } satisfies TransferParams;

    expect([mintOnStellar.to, mintOnArc.to]).toEqual(["stellar", "arc"]);
  });

  it("rejects an Arc destination signer for a Stellar mint", () => {
    // @ts-expect-error the mint runs on Stellar, so destinationSigner must be a StellarSigner
    const wrong: TransferParams = { from: "arc", to: "stellar", amount: "10", recipient: STELLAR_ACCOUNT, speed: "standard", signer: arcSigner, options: { destinationSigner: arcSigner } };

    expect(wrong.to).toBe("stellar");
  });

  it("rejects a Stellar destination signer for an Arc mint", () => {
    // @ts-expect-error the mint runs on Arc, so destinationSigner must be an ArcSigner
    const wrong: TransferParams = { from: "stellar", to: "arc", amount: "10", recipient: EVM_ACCOUNT, speed: "standard", signer: keypairSigner, options: { destinationSigner: keypairSigner } };

    expect(wrong.to).toBe("arc");
  });
});

describe("completeMint direction and signer", () => {
  it("accepts a signer native to the destination chain in both directions", () => {
    const mintOnStellar = {
      from: "arc",
      to: "stellar",
      burnTxHash: "0xburn",
      signer: keypairSigner,
    } satisfies CompleteMintParams;

    const mintOnArc = {
      from: "stellar",
      to: "arc",
      burnTxHash: "0xburn",
      signer: arcSigner,
    } satisfies CompleteMintParams;

    expect([mintOnStellar.to, mintOnArc.to]).toEqual(["stellar", "arc"]);
  });

  it("rejects an Arc signer for a Stellar mint", () => {
    // @ts-expect-error the mint runs on Stellar, so the signer must be a StellarSigner
    const wrong: CompleteMintParams = { from: "arc", to: "stellar", burnTxHash: "0xburn", signer: arcSigner };

    expect(wrong.to).toBe("stellar");
  });

  it("rejects a Stellar signer for an Arc mint", () => {
    // @ts-expect-error the mint runs on Arc, so the signer must be an ArcSigner
    const wrong: CompleteMintParams = { from: "stellar", to: "arc", burnTxHash: "0xburn", signer: keypairSigner };

    expect(wrong.to).toBe("arc");
  });
});

describe("AmountPrecisionError type and export", () => {
  it("exposes typed properties on AmountPrecisionError", () => {
    const err = new AmountPrecisionError("1.1234567", 7, 6, "arc");
    expect(err.amount).toBe("1.1234567");
    expect(err.precision).toBe(7);
    expect(err.destinationDecimals).toBe(6);
    expect(err.destinationChain).toBe("arc");
    expect(err.name).toBe("AmountPrecisionError");
    expect(err).toBeInstanceOf(Error);
  });
});
