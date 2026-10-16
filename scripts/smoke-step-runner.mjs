/** Retry only operations that are explicitly safe to repeat. Never replay a transfer or burn. */
const TRANSIENT = /\b(?:429|500|502|503|504)\b|\b(?:ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b|(?:rate limit|temporarily unavailable|gateway timeout)/i;
export function transientInfrastructureError(error) {
  const code = String(error?.code ?? error?.cause?.code ?? "");
  const status = Number(error?.status ?? error?.statusCode ?? error?.cause?.status);
  return [429,500,502,503,504].includes(status) || TRANSIENT.test(code) || TRANSIENT.test(String(error?.message ?? ""));
}
export async function runSmokeStep(name, operation, options = {}) {
  const { retries = 2, baseDelayMs = 250, safeToRetry = false,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console } = options;
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new RangeError("invalid retries");
  const started = Date.now();
  let attempts = 0;
  while (true) {
    attempts++;
    try {
      const value = await operation();
      return { name, status: "PASS", durationMs: Date.now() - started, attempts, value };
    } catch (error) {
      if (!safeToRetry || attempts > retries || !transientInfrastructureError(error))
        return { name, status: "FAIL", durationMs: Date.now() - started, attempts, error };
      const ms = baseDelayMs * 2 ** (attempts - 1);
      log.warn(`${name}: transient failure, attempt ${attempts}; retrying in ${ms}ms`);
      await sleep(ms);
    }
  }
}
export function formatStepSummary(rows) {
  return rows.map(({name,status,durationMs,attempts}) => `${status} ${name} (${durationMs}ms; attempts=${attempts})`).join("\n");
}
