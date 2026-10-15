import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function sourceExportNames(): string[] {
  const configPath = resolve(fileURLToPath(new URL("../tsconfig.json", import.meta.url)));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    { noEmit: true },
    configPath,
  );
  const entryPath = resolve(dirname(configPath), "src/index.ts");
  const program = ts.createProgram([entryPath], parsed.options);
  const entry = program.getSourceFile(entryPath);
  if (!entry) throw new Error(`Could not load ${entryPath}`);

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) throw new Error(`Could not inspect exports from ${entryPath}`);

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .sort();
}

describe("public entry point", () => {
  it("keeps the runtime export surface explicit", () => {
    expect(Object.keys(sdk).sort()).toMatchInlineSnapshot(`
      [
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
      ]
    `);
  });

  it("snapshots value and type exports from the real TypeScript entry point", () => {
    expect(sourceExportNames()).toMatchInlineSnapshot(`
      [
        "ARC_MAINNET",
        "ARC_TESTNET",
        "ArcDestinationOptions",
        "ArcSigner",
        "AttestationNotReadyError",
        "CctpBurnMessage",
        "ChainId",
        "CompleteMintOptions",
        "CompleteMintParams",
        "CompleteMintResult",
        "EstimateFeeParams",
        "FeeEstimate",
        "IrisRequestError",
        "Keypair",
        "Network",
        "ResolveBurnParams",
        "ResolvedBurn",
        "STELLAR_MAINNET",
        "STELLAR_TESTNET",
        "Signer",
        "StellarDestinationOptions",
        "StellarRecipientStatus",
        "StellarSignFunction",
        "StellarSigner",
        "SubmissionTimeoutError",
        "TransferError",
        "TransferErrorCode",
        "TransferMode",
        "TransferOptions",
        "TransferOptionsBase",
        "TransferParams",
        "TransferResult",
        "TransferSpeed",
        "TransferStatus",
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
      ]
    `);
  });
});

