// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // dist/ is build output; demos/ and website/ are separate Vite apps with their own setup.
    ignores: ["dist/**", "coverage/**", "node_modules/**", "demos/**", "website/**"],
  },
  {
    linterOptions: {
      // Makes the rule-is-active fixture meaningful: if a rule it disables stops firing,
      // the now-unused disable directive fails lint.
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root config files and examples/ sit outside tsconfig.json include.
          allowDefaultProject: ["*.config.ts", "examples/*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Test doubles stub partial SDK responses (`as any` on mocked RPC results); typing each
    // one fully would add noise without catching real bugs. Baselined here, not in src/.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
