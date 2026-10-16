import { describe, it, expect } from "vitest";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../src/index.js";

/**
 * The checked-in snapshot of the package's public surface. Regenerating it is a
 * deliberate act: when this test fails, either restore the removed export or
 * update the snapshot in the same PR that changes the surface, so the diff is
 * reviewable. Run `UPDATE_EXPORTS_SNAPSHOT=1 pnpm test exports` to regenerate.
 */
const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "exports.snapshot.json");

/**
 * Enumerates every name `src/index.ts` exports — values and types alike —
 * through the TypeScript compiler's own view of the entry point. Deriving the
 * list from the compiler rather than from a hand-maintained array is what
 * makes this a snapshot: a new `export type` that never appears at runtime
 * still shows up here, which a `Object.keys(api)` check alone would miss.
 */
function exportedNamesFromEntry(): string[] {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
  const program = ts.createProgram([entry], {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) {
    throw new Error(`could not load ${entry} for export enumeration`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    throw new Error("src/index.ts is not a module; the export snapshot needs one");
  }
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .sort();
}

/** Value (runtime) exports, straight from the live module namespace. */
const runtimeExports = Object.keys(api).sort();

describe("public export surface", () => {
  it("matches the checked-in snapshot exactly, values and types alike", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const declared = exportedNamesFromEntry();

    let snapshot: { exports: string[] } | null = null;
    try {
      snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as { exports: string[] };
    } catch {
      // First run (or deleted snapshot): fall through to the write below.
    }

    if (process.env.UPDATE_EXPORTS_SNAPSHOT || !snapshot) {
      await writeFile(SNAPSHOT_PATH, `${JSON.stringify({ exports: declared }, null, 2)}\n`);
      if (!snapshot) return; // bootstrapping the snapshot is not a failure
    }

    const expected = snapshot!.exports;
    const added = declared.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !declared.includes(name));

    expect(
      added.length === 0 && removed.length === 0,
      `public export surface changed.\n` +
        (added.length ? `  added:   ${added.join(", ")}\n` : "") +
        (removed.length ? `  removed: ${removed.join(", ")}\n` : "") +
        `If intentional, regenerate with UPDATE_EXPORTS_SNAPSHOT=1 pnpm test exports and commit the snapshot diff.`,
    ).toBe(true);
  });

  it("exposes every runtime export through the entry point", () => {
    // Every value in this list must be what a consumer actually receives from
    // `import { ... } from "@asctp/parabola"` — a typo'd or missing re-export
    // fails here instead of in a user's build.
    expect(runtimeExports).toEqual([
      "ARC_MAINNET",
      "ARC_TESTNET",
      "AttestationNotReadyError",
      "IrisRequestError",
      "Keypair",
      "STELLAR_MAINNET",
      "STELLAR_TESTNET",
      "SubmissionTimeoutError",
      "TransferError",
      "arcMainnetChain",
      "arcTestnetChain",
      "checkStellarRecipientReady",
      "completeMint",
      "decimalsForChain",
      "decodeCctpMessage",
      "decodeStellarForwardHook",
      "estimateFee",
      "getAttestation",
      "resolveBurn",
      "transfer",
    ]);
  });

  it("keeps every error class exported and distinct on the public surface", () => {
    for (const name of [
      "TransferError",
      "AttestationNotReadyError",
      "IrisRequestError",
      "SubmissionTimeoutError",
    ]) {
      expect(runtimeExports).toContain(name);
    }
  });
});
