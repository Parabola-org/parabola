/**
 * Proves the promise-safety lint rules are active. Each line below violates a rule and is
 * silenced with a targeted disable directive. eslint.config.mjs sets
 * reportUnusedDisableDirectives to "error", so if either rule is ever turned off or stops
 * firing, its directive becomes unused and `pnpm lint` fails. Not a test; never executed.
 */

async function poll(): Promise<void> {}

export function floatingPromise(): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  poll();
}

export function misusedPromise(items: number[]): void {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  items.forEach(async () => {
    await poll();
  });
}
