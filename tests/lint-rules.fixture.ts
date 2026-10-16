/**
 * Verifies that @typescript-eslint/no-floating-promises and
 * @typescript-eslint/no-misused-promises are active in eslint.config.mjs.
 * Because reportUnusedDisableDirectives is set to "error", pnpm lint fails
 * if either rule is disabled or stops firing on these constructs.
 */

async function step(): Promise<void> {}

export function checkFloatingPromiseRule(): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  step();
}

export function checkMisusedPromiseRule(values: number[]): void {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  values.forEach(async () => {
    await step();
  });
}
