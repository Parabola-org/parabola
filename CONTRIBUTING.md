# Contributing to Parabola

Thank you for considering a contribution to Parabola. Parabola is a TypeScript SDK for moving native USDC between Circle's Arc network and Stellar via CCTP V2, and contributions to the SDK, its tests, examples, and docs are welcome.

This document is the single source of truth for contributing. Please read it in full before opening an issue or pull request.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [First-Time Contributors](#first-time-contributors)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Testing Strategy](#testing-strategy)
- [Opening Issues](#opening-issues)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Branch Naming](#branch-naming)
- [Commit Convention](#commit-convention)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Running Checks Locally](#running-checks-locally)
- [Releasing](#releasing)
- [Getting Help](#getting-help)

---

## Code of Conduct

Participation in this project is governed by the [Parabola Code of Conduct](CODE_OF_CONDUCT.md). By contributing, you agree to uphold it.

---

## Ways to Contribute

**In scope:**

- Bug reports and bug fixes
- Features that have been discussed and approved in a GitHub Discussion
- Documentation: README, JSDoc, guides, inline comments
- Demo app improvements (`demos/`) and the integration guide (`INTEGRATION.md`)
- Additional test coverage for any module
- Performance improvements with benchmarks
- Dependency updates and CI improvements

**Not accepted:**

- Unsolicited refactors of code you did not introduce (if cleanup is needed, open a `[Chore]` issue first)
- Features that have not been approved in a GitHub Discussion: PRs for unapproved features will be closed without review
- PRs that bundle multiple unrelated changes: one PR per issue, always
- New runtime dependencies beyond `viem` and `@stellar/stellar-sdk` without prior discussion, since Parabola is deliberately dependency-light
- Support for chains other than Arc and Stellar, or CCTP V1: out of scope for this SDK

If you are unsure whether a contribution fits, open a GitHub Discussion before writing any code.

---

## First-Time Contributors

If this is your first open-source contribution, start here:

1. Filter issues by [`good first issue`](https://github.com/ASCTP/parabola/issues?q=is%3Aopen+label%3A%22good+first+issue%22): these are fully isolated tasks that don't require deep knowledge of CCTP, Arc, or Soroban.
2. Comment on the issue to signal you are picking it up before starting.
3. Follow the [Getting Started](#getting-started) guide below to set up the project.
4. When your PR is ready, follow the [Pull Request Process](#pull-request-process) section exactly.

---

## Prerequisites

| Tool    | Required version                              | Check             |
| ------- | --------------------------------------------- | ----------------- |
| Node.js | `>=20`                                        | `node --version`  |
| pnpm    | pinned via `packageManager` in `package.json` | `pnpm --version`  |

If you have [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`), the correct pnpm version is picked up automatically from `package.json`.

You do not need funded Arc or Stellar accounts to work on the SDK itself, since unit tests mock all network and RPC calls. You only need them if you're running the files in `examples/` or `pnpm smoke` against a live network. On testnet you can fund via [faucet.circle.com](https://faucet.circle.com); mainnet moves real funds.

---

## Getting Started

1. Fork the repo on GitHub, then clone your fork:

   ```bash
   git clone https://github.com/<your-username>/parabola.git
   cd parabola
   ```

2. Add the upstream remote so you can keep your fork in sync:

   ```bash
   git remote add upstream https://github.com/ASCTP/parabola.git
   ```

3. Before starting any work, sync your fork with upstream:

   ```bash
   git fetch upstream
   git checkout main
   git rebase upstream/main
   ```

4. Install dependencies:

   ```bash
   pnpm install
   ```

5. Confirm the full check suite passes before making any changes:

   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```

---

## Project Structure

```text
parabola/
  src/
    index.ts          # primary exports
    transfer.ts        # core transfer orchestration (transfer, completeMint, resolveBurn)
    estimate.ts         # fee estimation
    constants.ts        # contract addresses, domain IDs, RPC/Iris URLs
    chains/
      arc.ts            # Arc-specific CCTP logic (viem)
      stellar.ts         # Stellar-specific CCTP logic, CctpForwarder routing (Soroban)
    iris/
      poll.ts            # Iris attestation polling, single reads, and fee lookups
      types.ts            # Iris API response types
    utils/
      encoding.ts         # Stellar address translation, precision conversion, hook encode/decode
      amount.ts            # USDC amount parsing and formatting
      message.ts           # CCTP V2 message decoding (header, burn body, forward hook)
    types.ts              # all exported TypeScript types
  tests/                 # vitest, one file per module above
  examples/              # runnable examples (mainnet default, NETWORK=testnet override)
  demos/                 # demo apps: see demos/README.md; wallet-transfer-demo/ is the first
  scripts/               # address verification and smoke test
```

Changes to `src/constants.ts` affect every transfer path; see [Code Standards](#code-standards) below before touching contract addresses or domain IDs.

---

## Testing Strategy

Parabola uses three layers of testing, each catching a different class of bug:

1. **Unit tests (`tests/`, run via `pnpm test`).** Every network and RPC call is mocked with `vi.mock`. These are fast, run in CI on every push, and are the right place to cover argument-encoding bugs and every error branch; see the existing `vi.mock` patterns in `tests/arc.test.ts` and `tests/stellar.test.ts` for the convention. They cannot catch a wrong contract address, a wrong ABI, or a real-world RPC quirk, because nothing here talks to a real network.

2. **Live address verification (`pnpm verify:addresses`, `scripts/verify-contract-addresses.mjs`).** Confirms every address in `src/constants.ts` has real, deployed code at that address on its claimed network, both mainnet and testnet: Arc via `eth_getCode`, Stellar via `getContractData`. No funded account needed, since these are public reads. Runs in CI automatically on any PR that touches `src/constants.ts` (`.github/workflows/verify-contract-addresses.yml`). This catches typos and stale addresses; it cannot catch "right shape of address, wrong contract."

3. **Smoke test (`pnpm smoke`, `scripts/testnet-smoke.mjs`).** Runs a real `transfer()` end-to-end in both directions against a live network: real `depositForBurn`, real Iris attestation polling, real `receiveMessage` / `mint_and_forward`. It defaults to testnet; set `NETWORK=mainnet` to run against mainnet, which moves real USDC and spends real Arc gas. This is the only layer that would catch a bug in the actual burn-attest-mint flow, bundling regressions in `dist/` (it imports the built package, not `src/`), or a live API contract change from Circle. It needs funded keys (on testnet, see `.env.example` and fund via [faucet.circle.com](https://faucet.circle.com)) and takes anywhere from 20 seconds to several minutes per case, so it is **not** run automatically in CI; run it manually before a release, or after changing anything in `src/transfer.ts`, `src/chains/`, or `src/iris/`.

You do not need funded Arc or Stellar accounts to work on the SDK day-to-day; layers 1 and 2 cover most contributions. Layer 3 matters most for changes to the transfer/mint/burn flow itself.

---

## Opening Issues

Use one of the two GitHub issue templates. Blank issues are disabled.

### Title format

Every issue title must use the bracket prefix format:

```text
[Type] Short imperative description
```

| Prefix             | When to use                                 |
| ------------------ | ------------------------------------------- |
| `[Bug]` or `[Fix]` | Something is broken or behaving incorrectly |
| `[Feature]`        | New capability or significant enhancement   |
| `[Test]`           | Adds or improves test coverage              |
| `[Docs]`           | Documentation, README, JSDoc, guides        |
| `[Chore]`          | Refactor, cleanup, dependency update, CI    |

### Which template to use

- **Bug Report**: for anything broken, incorrect, or behaving unexpectedly
- **Feature Request**: for features, tests, docs, and chores

### Labels

Apply labels from all three categories before submitting. PRs linked to unlabelled issues will be asked to add labels before review begins.

| Category   | Pick           | Options                                                      |
| ---------- | -------------- | ------------------------------------------------------------ |
| Purpose    | one            | `bug`, `enhancement`, `docs`, `testing`, `chore`, `security` |
| Area       | all that apply | `arc`, `stellar`, `iris`, `encoding`, `ci`, `examples`       |
| Complexity | one            | `trivial`, `medium`, `hard`                                  |

Use `good first issue` in place of a complexity label for tasks that are fully isolated and require no CCTP, Arc, or Soroban knowledge.

---

## Security Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for scope and reporting instructions.

---

## Branch Naming

All branches must follow this pattern:

```text
<type>/<short-description>
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`

**Examples:**

```text
feat/fast-transfer-allowance-check
fix/stellar-precision-truncation
docs/completeMint-usage-example
test/arc-depositforburn-argument-encoding
```

---

## Commit Convention

Parabola uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit must follow this format:

```text
<type>[(<scope>)]: <subject>
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `chore`, `ci`

**Scopes (optional):** `arc`, `stellar`, `iris`, `encoding`, `transfer`, `estimate`, `examples`, `ci`, `docs`

**Rules:**

- Subject line under 72 characters
- Use imperative mood: "add" not "added" or "adds"
- No period at the end of the subject

**Examples:**

```text
feat(stellar): add mint_and_forward retry on transient RPC errors
fix(encoding): truncate rather than round when converting Stellar to Arc precision
test(arc): cover depositForBurnWithHook argument encoding
docs: document completeMint in the README
```

> Issue references (`Closes #N`) go in the **PR body**, not in commit messages. Squash merge is enforced, and the PR title becomes the squash commit, so issue refs in individual commits are discarded.

---

## Code Standards

- **Formatting and linting:** must pass `pnpm typecheck` and `pnpm lint` with zero errors. `pnpm lint:fix` applies the auto-fixable ones.
- **Types:** no `any`. Use precise types from `src/types.ts`; narrow `unknown` explicitly.
- **Naming:**
  - `PascalCase` for types and interfaces
  - `camelCase` for variables and functions
  - `UPPER_SNAKE_CASE` for module-level constants (see `src/constants.ts`)
  - `kebab-case` for filenames
- **No side effects at module load time.** RPC clients (`createPublicClient`, `rpc.Server`) must be instantiated inside functions, not at the top level of a module.
- **Comments:** only comment on WHY, not what the code does. If the code needs a what-comment, rewrite the code instead.
- **Contract addresses and domain IDs:** never add or change a value in `src/constants.ts` from memory or inference. Pull it from Circle's or Arc's published docs (linked in the README) and cite the source page in the PR description. A wrong address here sends real funds to the wrong place. Any PR touching `src/constants.ts` runs `pnpm verify:addresses` in CI, which checks every address against live RPC (Arc `eth_getCode`, Stellar `getContractData`) to confirm something is actually deployed there. This catches typos and stale addresses, but it's not a substitute for citing the source doc, since a live contract at the wrong address still passes.
- **Stellar contract call argument order and hook-data encoding:** don't guess these from vague doc summaries. [circlefin/stellar-cctp](https://github.com/circlefin/stellar-cctp) is Circle's official Stellar CCTP contract source and reference TypeScript client. `examples/stellar.ts` and `examples/stellar-utils.ts` there are the canonical answer for `deposit_for_burn`'s argument order and `buildCctpForwarderHookData`'s byte layout. Early versions of `src/chains/stellar.ts` and `src/utils/encoding.ts` got both wrong from inference before this repo was found; a live testnet smoke test caught it, but checking here first would have caught it before any code was written.
- **Tests:** any change to `src/utils/encoding.ts`, `src/chains/*.ts`, or `src/transfer.ts` needs a corresponding test. Network and RPC calls are mocked in unit tests; see the existing `vi.mock` patterns in `tests/` for the convention. `pnpm verify:addresses` (`scripts/verify-contract-addresses.mjs`) is the one check that hits live RPC directly (mainnet and testnet); it needs no funded account since it's read-only.

---

## Pull Request Process

### PR body format

Every PR must use this structure (the GitHub PR template pre-fills it):

```markdown
## Summary

- What changed and why (bullet points, not a list of files touched)

## Test plan

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass locally
- [ ] What you manually verified

Closes #N
```

`Closes #N` must reference the issue this PR resolves. PRs with no linked issue will not be reviewed.

### Rules

1. **One PR per issue.** Do not bundle multiple issues into a single PR.
2. **Keep PRs small.** A PR that changes more than 400 lines of non-test code will be asked to split.
3. **Fill out the PR template fully.** Incomplete templates will be closed without review.
4. **All CI checks must pass** before a review will begin.
5. **Resolve all review comments** before requesting a re-review.
6. **Do not force-push** after a review has started. Add new commits to address feedback so the reviewer can see what changed.
7. **Squash on merge** is enforced. Your PR title must follow the commit convention, since it becomes the squash commit message.

### What to expect

Pull requests are reviewed within 72 hours of submission. You will receive one of:

- **Approved**: the PR will be merged promptly
- **Changes requested**: address the comments and request a re-review
- **Closed**: the PR is out of scope, a duplicate, or does not meet the standards in this guide; the closing comment will explain why

---

## Running Checks Locally

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint (typescript-eslint, incl. no-floating-promises)
pnpm test             # vitest
pnpm build            # tsup, emits ESM + CJS + type declarations to dist/
pnpm verify:addresses # confirms src/constants.ts addresses are live on-chain (no funded account needed)
pnpm smoke            # real end-to-end transfer against a live network (needs funded keys, see Testing Strategy)

# Run a single test file
pnpm vitest run tests/encoding.test.ts
```

---

## Releasing

Releases are maintainer-only and tag-triggered; contributors don't need to do anything here.

1. On `main`, bump `version` in `package.json` (semver) and move the relevant `[Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
2. Commit that as `chore(release): vX.Y.Z`, push, and confirm CI is green.
3. Tag it and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `.github/workflows/publish.yml` picks up the tag, re-runs typecheck/test/build, confirms the tag version matches `package.json`, and publishes `@asctp/parabola` to npm. Provenance attestations are generated automatically as part of this.

Publishing authenticates via npm's Trusted Publishing (OIDC): npm trusts this exact repository and workflow file directly, so there's no long-lived token to provision, leak, or rotate. That trust relationship is configured once on npm's side (`@asctp/parabola` package settings > Trusted Publisher), by whoever holds the npm org access, not something CI or a contributor can provision. If the workflow file is ever renamed, publishing breaks until the Trusted Publisher config is updated to match.

---

## Getting Help

- **Questions about an issue?** Comment on the issue directly.
- **Dev setup broken?** Open a [GitHub Discussion](https://github.com/ASCTP/parabola/discussions).
- **Found a bug not covered by an existing issue?** Open a new issue using the Bug Report template before starting any work.
- **Have a feature idea?** Open a Discussion first. Do not open a PR for a feature that has not been discussed and approved.
- **Security issue?** See [SECURITY.md](SECURITY.md); do not open a public issue.

---

By contributing to Parabola, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
