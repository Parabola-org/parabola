/**
 * AbortSignal plumbing shared by every polling loop in the SDK. The contract is
 * deliberate: an abort before a transaction is submitted surfaces as a plain
 * AbortError with nothing on the wire, while an abort during post-submission
 * confirmation is converted by the caller into a hash-carrying error — the burn
 * may still land, so the hash must not be discarded with the signal.
 */

/** The DOMException-shaped abort DOM/Node code contract callers match on. */
export function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Throws AbortError if the signal has already fired. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

/** A setTimeout that rejects promptly on abort instead of sleeping to deadline. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
