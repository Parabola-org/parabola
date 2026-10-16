import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config for the SDK. Recommended sets for JS + TS, plus the two
// promise rules that catch the real classes of issue this async-heavy code
// carries: floating promises in the poll loops and misused promises around
// signer callbacks. Those rules need type information, so they run as a
// type-aware pass scoped to src/ only — tests and scripts legitimately
// fire-and-forget and shape mocks with `any`. Formatting stays out of
// ESLint's remit (.editorconfig owns that); demos and website carry their
// own toolchains.
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "website/",
      "demos/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Mock shaping legitimately uses `any` for structural stubs.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
