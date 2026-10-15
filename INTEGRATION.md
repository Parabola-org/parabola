# Integrating Parabola

## Who this guide is for

The [README](README.md) covers installation and one-off scripts: import `transfer()`, build a
signer, call it, done. This guide is different: it's for wiring Parabola into a persistent
application, backend service or browser app, where the concerns are different: where do keys
live, what happens when a call fails partway through, and how do you resume a transfer that
didn't finish. If you haven't read the README yet, start there; this guide assumes you have.

## Two integration patterns

### Pattern A: backend-held keys

**When to use:** your service already custodies a hot wallet key server-side for one or both
chains, e.g. an operational treasury wallet, a relayer, anything where the key already lives in
your infrastructure rather than a user's wallet.

**Shape:** build a signer once from an env-stored private key, call `transfer()` from an API
route or background job. This is exactly what [`examples/arc-to-stellar.ts`](examples/arc-to-stellar.ts)
and [`examples/stellar-to-arc.ts`](examples/stellar-to-arc.ts) already show; read those as the
base pattern for this approach.

### Pattern B: non-custodial browser wallet (recommended for user-facing apps)

**When to use:** end users connect their own wallets and your app never touches a private key.

**Shape:**

- `ArcSigner` just wraps a viem `WalletClient`. Build one from an injected wallet with
  `createWalletClient({ account, chain: arcMainnetChain, transport: custom(window.ethereum) })`
  and you have a valid `ArcSigner` (use `arcTestnetChain` for testnet). Nothing Parabola-specific about it.
- `StellarSigner` accepts a `signTransaction` callback instead of a raw `Keypair` for exactly
  this case. Freighter's own `signTransaction(xdr, opts)` resolves to
  `{ signedTxXdr: string; signerAddress: string; error?: FreighterApiError }` (note it's an
  **object**, not a plain string, and it never throws; check `.error` on every call). Your
  callback just needs to unwrap `.signedTxXdr`.

**Reference:** [`demos/wallet-transfer-demo/`](demos/wallet-transfer-demo) is the full working
example of this pattern, specifically
[`src/lib/arcWallet.ts`](demos/wallet-transfer-demo/src/lib/arcWallet.ts) and
[`src/lib/stellarWallet.ts`](demos/wallet-transfer-demo/src/lib/stellarWallet.ts).

## Failure modes and recovery

`transfer()` moves through three stages, and where a failure lands decides what to do next:

1. **Burn** — USDC is burned on the source chain. Failures here leave nothing to recover: the caller has no `burnTxHash` yet.
2. **Attestation** — Circle's Iris signs the burn. The burn already exists, so the `burnTxHash` is now the recovery handle and must survive every failure.
3. **Mint** — the attested message is submitted on the destination chain.

Every error class exported from the SDK maps to one of those stages:

| Error | Stage | What it means | What to do |
| --- | --- | --- | --- |
| `AttestationNotReadyError` | attestation | The burn is real; Circle has not signed it yet. Funds are safe. | Retry later — typically answer `409` and poll again |
| `TransferError` with `code === "ATTESTATION_NOT_READY"` | attestation | Same condition wrapped by `transfer()`; `burnTxHash` is attached. | Retry later — `completeMint` recovers it |
| `TransferError` with `code === "ABORTED"` | attestation/mint | Your `options.signal` fired after the burn submitted. | Same as a timeout — `completeMint` on the carried hash |
| `TransferError` (no `code`) | post-burn | A real failure — e.g. the mint was rejected. | Record `burnTxHash`, answer `502`, recover via `completeMint` |
| `IrisRequestError` | attestation | Iris is unreachable or unhealthy (5 consecutive failures, or a persistent 5xx). `status` holds the HTTP status when there was a response. | Treat as an upstream outage; retry when Circle recovers |
| `StellarRpcError` | pre-burn / pre-mint | The Stellar RPC answered a transport/5xx failure while checking the recipient — NOT a missing account. `status` carries the HTTP status when there was one. | Retry; the recipient may be funded and fine |
| `SubmissionTimeoutError` | submission | A transaction was broadcast but not confirmed in time. `hash` names it — outcome genuinely unknown. | Check the chain before retrying; do not assume it failed |
| `AbortError` | pre-burn | Your `signal` fired before anything was submitted. | Nothing to recover — start over cleanly |

The one distinction that decides your response: **"funds are safe, retry"** (`AttestationNotReadyError`, `TransferError` with a `code`, `IrisRequestError`, `StellarRpcError`) versus **"outcome unknown, inspect first"** (`SubmissionTimeoutError`). For the first class, waiting and calling again is correct. For the second, a blind retry could double-submit a transaction that is already landing — read the chain state for `hash` before deciding.

Branch on the class and the `code`, never on the message text. Message wording is not part of the API and can change in a patch release:

```typescript
import { transfer, TransferError, SubmissionTimeoutError } from "@asctp/parabola";

try {
  const result = await transfer(params);
  if (result.status === "pending") {
    await ledger.record({ from, to, burnTxHash: result.burnTxHash, network });
  }
} catch (err) {
  if (err instanceof TransferError) {
    await ledger.record({ from, to, burnTxHash: err.burnTxHash, network });
    if (err.code === "ATTESTATION_NOT_READY") {
      return respond(409, { retryable: true, burnTxHash: err.burnTxHash });
    }
  }
  if (err instanceof SubmissionTimeoutError && err.hash) {
    await ledger.record({ from, to, burnTxHash: err.hash, network, uncertain: true });
  }
  return respond(502, { retryable: false });
}
```

A timeout is not the same as a failed attestation. A `404` from Iris means the burn is not indexed yet, which is ordinary during the first seconds after a burn, and polling continues through it. A persistent `5xx` is different again: after five consecutive failures, polling stops with an `IrisRequestError` rather than running out the clock, so an Iris outage does not look identical to a slow attestation. `IrisRequestError.status` holds the HTTP status when there was a response.

### Recovering with `completeMint`

A `TransferError` after the burn always keeps `burnTxHash`. The recovery is the same for both directions — wait for the transient condition to pass, then call `completeMint` with a signer for the **destination** chain (a `StellarSigner` when minting to Stellar, an `ArcSigner` when minting to Arc):

```typescript
import { transfer, completeMint, TransferError } from "@asctp/parabola";

let burnTxHash: string;
try {
  await transfer({
    from: "arc",
    to: "stellar",
    amount: "10",
    recipient,
    speed: "standard",
    signer: arcSigner,
  });
} catch (err) {
  if (!(err instanceof TransferError)) throw err;
  burnTxHash = err.burnTxHash; // survives the rejection — this is the recovery handle
}

// Later — same call shape works whether the burn was arc->stellar or stellar->arc;
// only the signer changes to match the destination chain.
const { mintTxHash } = await completeMint({
  from: "arc",
  to: "stellar",
  burnTxHash,
  signer: stellarSigner, // StellarSigner for a Stellar destination; ArcSigner for Arc
});
```

### Choosing `pollTimeout`

The default is 300000 ms — five minutes. Attestations normally land within a minute or two, but a slow Circle interval or a congested source chain can stretch that. Guidance:

- **Interactive callers** (a user waiting on a UI): shorter — 60–120 seconds, surface `AttestationNotReadyError` as "still processing" rather than holding the request open.
- **Backend jobs** that own their own loop: the default is fine; pair it with `pollInterval` only when your RPC budget needs it.
- **Never set it so low that a normal attestation can't land.** A `TransferError`/`AttestationNotReadyError` out of an expired window is retryable, but an over-tight budget turns a healthy transfer into noise on your error path.

### Aborting a transfer

Every long-running entry point accepts `options.signal` (an `AbortSignal`):

- Abort **before** the burn is submitted: a plain `AbortError` rejects, nothing was broadcast, nothing needs recovery.
- Abort **after** the burn is on the wire: a `TransferError` whose `code` is `"ABORTED"` rejects, still carrying `burnTxHash` — the burn may complete on-chain even though your call returned, so the recovery path is identical to any other post-burn failure.

The signal is also threaded through Iris attestation polling (each `fetch` receives it), the Stellar recipient check, and the internal transaction-polling loops, so an abort resolves promptly instead of waiting out a deadline.

## Completing a burn your service did not create

`completeMint()` does not require the burn to have come from this process, or from Parabola at all. It takes `from`, `to`, `burnTxHash`, `network` and a signer for the destination chain, and it keeps no record of burns, so it neither requires nor checks that your service produced the original `transfer()` call. This is the shape a relayer needs.

Read the burn before you spend anything on it. `resolveBurn` returns what the burn already committed to:

```typescript
import { resolveBurn } from "@asctp/parabola";

const burn = await resolveBurn({ from, burnTxHash, network });
// burn.forwardRecipient is the Stellar account the mint will pay, on an arc -> stellar burn
// burn.amountRaw is in the source chain's USDC subunits, 10^6 on Arc
// burn.attestation is null while Circle is still signing
```

`resolveBurn` returns as soon as Iris has indexed the burn, which is before Circle signs, so a populated `forwardRecipient` alongside a null `attestation` is the normal state for the first seconds after a burn. It throws `AttestationNotReadyError` if Iris has not indexed the burn at all yet.

For a service that must answer its own caller immediately rather than holding the request open, `getAttestation` is a single non-blocking read instead of a poll to a deadline:

```typescript
import { getAttestation, AttestationNotReadyError } from "@asctp/parabola";

try {
  const message = await getAttestation({ sourceDomain: 26, transactionHash: burnTxHash, useSandbox: false });
  if (message.status !== "complete" || !message.attestation) {
    return respond(409, { retryable: true });
  }
  // message.message and message.attestation are ready to submit
} catch (err) {
  if (err instanceof AttestationNotReadyError) return respond(409, { retryable: true });
  throw err;
}
```

The Stellar recipient check `transfer()` performs is built into `completeMint()` as well, and it reads the account out of the burn message's forward hook rather than accepting a recipient argument. A relayer therefore cannot accidentally preflight a different account than the one that gets paid.

### Idempotency is yours to enforce

Nothing in Parabola dedupes, and `completeMint()` will submit again for a burn that was already minted. The chain rejects the re-used CCTP message, so no funds move, but you pay gas to learn that.

Keep a ledger keyed on `(burn hash, network)` and return the recorded mint transaction hash for a repeated request instead of resubmitting. A relayer is precisely the caller that retries, so this is a required component rather than a nicety.

## Network selection in a service

`network` is optional everywhere and defaults to `"mainnet"`. That is convenient for a script and is the wrong failure mode for a long-running process holding a funded key, because an omitted field silently spends real USDC.

Default your own configuration to testnet, make mainnet explicit, and reject any request whose `network` disagrees with the operator's choice. That way a caller cannot push the service onto a network the operator did not select.

## Recovering from a "pending" result: destinationSigner and completeMint

This is a different, sanctioned recovery path from the one above: use it when you deliberately
didn't attach `options.destinationSigner` (for example, your backend only holds the source
chain's key at call time). `transfer()` performs the burn and attestation polling, then returns
`status: "pending"` with a populated `burnTxHash` and an empty `mintTxHash`. `completeMint()`
finishes it later, given that `burnTxHash`.

**Persistence requirement this guide adds:** if your backend could restart between the initial
`transfer()` call and calling `completeMint()`, persist `{ from, to, burnTxHash, network }` to
durable storage before you return from the first call. `CompleteMintParams` requires those as
input, and unlike a failure thrown mid-flight, this is a hash Parabola *does* hand back to you,
so don't let it evaporate in memory. Store `network` alongside it: it decides which Iris
environment and which contract addresses the later call uses, and guessing it wrong on recovery
is silent.

**Reference:**
[`src/components/TransferStatus.tsx`](demos/wallet-transfer-demo/src/components/TransferStatus.tsx)'s
"Complete mint" button is the interactive version of this recovery path.

## Running the demo app locally

```bash
pnpm install
pnpm build      # builds @asctp/parabola: required first, see demos/wallet-transfer-demo/README.md
pnpm dev:wallet-transfer-demo
```

Prerequisites: MetaMask and Freighter browser extensions, and funded Arc + Stellar accounts. On
testnet, fund both via [faucet.circle.com](https://faucet.circle.com). Both integration patterns
above are reachable in the same UI: check or uncheck "Complete the mint automatically" to switch
between them.

## Choosing a pattern for your app

No user-key custody at all, ever -> Pattern B. Already have an operational wallet funded and
ready to sign -> Pattern A is simpler, one fewer moving part. Nothing stops a single application
from using both for different flows (e.g. Pattern A for automated payouts, Pattern B for
user-initiated transfers).
