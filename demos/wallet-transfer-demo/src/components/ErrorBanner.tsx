import { useState } from "react";

interface Props {
  message: string;
  recoverable: { burnTxHash: string; from: "arc" | "stellar"; to: "arc" | "stellar" } | null;
  submissionUncertain: boolean;
  destinationWalletConnected: boolean;
  onRecover: () => void;
  recovering: boolean;
  onDismiss: () => void;
}

/**
 * transfer() throwing does not mean nothing happened: the source-chain burn step can
 * succeed and then a later step (attestation polling, the mint call) can still fail.
 * transfer() rethrows those as a TransferError carrying burnTxHash (see src/errors.ts) --
 * recoverableBurnTxHash reflects that. Separately, an approve step's own confirmation can
 * time out before the burn is ever attempted (submissionUncertain): there's no burn hash
 * to recover with, but that transaction was still genuinely broadcast, so this banner
 * never claims "nothing happened" for that case either.
 */
export function ErrorBanner({
  message,
  recoverable,
  submissionUncertain,
  destinationWalletConnected,
  onRecover,
  recovering,
  onDismiss,
}: Props) {
  const [copied, setCopied] = useState(false);
  const burnTxHash = recoverable?.burnTxHash ?? null;

  async function copyHash() {
    if (!burnTxHash) return;
    try {
      await navigator.clipboard.writeText(burnTxHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied — the hash is still on screen
    }
  }

  return (
    <div className="error-banner" role="alert">
      <p>{message}</p>
      {burnTxHash ? (
        <p>
          The {recoverable!.from}&#8594;{recoverable!.to} burn already succeeded — the funds
          left the source chain safely, they just haven't minted on the destination yet.{" "}
          {destinationWalletConnected
            ? "Finish it below rather than retrying the transfer from scratch."
            : "Connect the destination wallet, then finish it below rather than retrying the transfer from scratch."}
          <br />
          Burn tx: <code>{burnTxHash}</code>{" "}
          <button
            type="button"
            className="link-button"
            onClick={copyHash}
            aria-label={copied ? "Burn transaction hash copied" : "Copy burn transaction hash"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : submissionUncertain ? (
        <p>
          A transaction was broadcast (likely the token approval) but its confirmation timed
          out before the burn was attempted, so no funds have left the source chain. It may
          still land on its own; check your address on the source-chain explorer if you want
          to confirm before retrying, though retrying is low-risk here since approvals just
          overwrite the allowance rather than accumulate.
        </p>
      ) : (
        <p>Nothing was submitted on-chain yet, so it's safe to retry.</p>
      )}
      <div className="error-banner-actions">
        {burnTxHash && (
          <button onClick={onRecover} disabled={!destinationWalletConnected || recovering}>
            {recovering ? "Completing mint..." : "Complete transfer"}
          </button>
        )}
        <button className="link-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
