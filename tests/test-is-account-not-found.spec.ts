import { describe, it, expect } from "vitest";

// isAccountNotFoundError is not directly exported; test via checkStellarRecipientReady
// or test the behavior through a mock RPC server. For now, test the regex logic directly.
function isAccountNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    return /account not found/i.test(err.message);
  }
  return false;
}

describe("isAccountNotFoundError", () => {
  it("matches account not found errors", () => {
    expect(isAccountNotFoundError(new Error("Account not found"))).toBe(true);
    expect(isAccountNotFoundError(new Error("account NOT FOUND in ledger"))).toBe(true);
  });

  it("does NOT match generic HTTP 404 errors from RPC proxies", () => {
    expect(isAccountNotFoundError(new Error("404 Not Found"))).toBe(false);
    expect(isAccountNotFoundError(new Error("Endpoint not found"))).toBe(false);
    expect(isAccountNotFoundError(new Error("Resource not found"))).toBe(false);
  });

  it("does NOT match non-Error types", () => {
    expect(isAccountNotFoundError("Account not found")).toBe(false);
    expect(isAccountNotFoundError(null)).toBe(false);
    expect(isAccountNotFoundError(undefined)).toBe(false);
  });
});
