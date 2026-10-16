import { useCallback, useState } from "react";
import {
  transfer,
  estimateFee,
  completeMint,
  TransferError,
  SubmissionTimeoutError,
  type ChainId,
  type Network,
  type TransferParams,
  type TransferResult,
  type EstimateFeeParams,
  type FeeEstimate,
  type CompleteMintParams,
} from "@asctp/parabola";

export type TransferUiStatus = "idle" | "submitting" | "success" | "pending" | "error";

export function useTransfer() {
  const [status, setStatus] = useState<TransferUiStatus>("idle");
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set whenever a burn succeeded and a later step threw: the hash alone is not enough
  // to recover with — completeMint also needs the direction and network the burn used.
  // Capture them at throw time so a form flip between burn and recovery can't mint the
  // wrong direction.
  const [recoverable, setRecoverable] = useState<{
    burnTxHash: string;
    from: ChainId;
    to: ChainId;
    network: Network;
  } | null>(null);
  // Set for a SubmissionTimeoutError that isn't a TransferError, i.e. an approve step's
  // confirmation timed out, not the burn itself. There's no burn hash to recover with here
  // (the burn was never reached), but it's still wrong to claim nothing was submitted: this
  // specific transaction was broadcast, its outcome is just unconfirmed.
  const [submissionUncertain, setSubmissionUncertain] = useState(false);

  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const submit = useCallback(async (params: TransferParams): Promise<TransferResult | null> => {
    setStatus("submitting");
    setError(null);
    setRecoverable(null);
    setSubmissionUncertain(false);
    try {
      const transferResult = await transfer(params);
      setResult(transferResult);
      setStatus(transferResult.status === "success" ? "success" : "pending");
      return transferResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (err instanceof TransferError) {
        setRecoverable({
          burnTxHash: err.burnTxHash,
          from: params.from,
          to: params.to,
          network: params.network ?? "mainnet",
        });
      } else if (err instanceof SubmissionTimeoutError) {
        setSubmissionUncertain(true);
      }
      setStatus("error");
      return null;
    }
  }, []);

  const finishPending = useCallback(async (params: CompleteMintParams) => {
    setStatus("submitting");
    setError(null);
    try {
      const completeResult = await completeMint(params);
      setResult((previous) =>
        previous
          ? { ...previous, status: "success", mintTxHash: completeResult.mintTxHash, attestationHash: completeResult.attestationHash }
          : { status: "success", transferMode: "standard", burnTxHash: params.burnTxHash, mintTxHash: completeResult.mintTxHash, attestationHash: completeResult.attestationHash, fee: "0", durationMs: 0 },
      );
      setRecoverable(null);
      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (err instanceof TransferError) {
        setRecoverable({
          burnTxHash: err.burnTxHash,
          from: params.from,
          to: params.to,
          network: params.network ?? "mainnet",
        });
      } else if (err instanceof SubmissionTimeoutError) {
        setSubmissionUncertain(true);
      }
      setStatus("error");
    }
  }, []);

  // Marks the pending transfer complete from a mint produced outside this hook, i.e. by the
  // Onderhaus sponsor rather than by completeMint() with a local wallet. The burn and
  // attestation already happened, so only the final hashes and status change.
  const markCompleted = useCallback((mintTxHash: string, attestationHash: string) => {
    setResult((previous) =>
      previous
        ? { ...previous, status: "success", mintTxHash, attestationHash: attestationHash || previous.attestationHash }
        : previous,
    );
    setStatus("success");
  }, []);

  const estimate = useCallback(async (params: EstimateFeeParams) => {
    setEstimating(true);
    try {
      setFeeEstimate(await estimateFee(params));
    } catch {
      setFeeEstimate(null);
    } finally {
      setEstimating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
    setRecoverable(null);
    setSubmissionUncertain(false);
  }, []);

  return {
    status,
    result,
    error,
    recoverable,
    submissionUncertain,
    submit,
    finishPending,
    markCompleted,
    feeEstimate,
    estimating,
    estimate,
    reset,
  };
}
