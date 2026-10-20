import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { determinismConfig } from "./eslint/determinism.mjs";

export default tseslint.config(
  {
    name: "cge/ignores",
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "tools/guardrails/fixtures/**",
      "packages/config/fixtures/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    name: "cge/type-aware",
    languageOptions: {
      parserOptions: {
        // Source tsconfigs exclude *.test.ts (FR-004); point type-aware lint at
        // each package's test project (includes sources + tests) plus root configs.
        project: [
          "packages/*/tsconfig.test.json",
          "packages/adapters/*/tsconfig.test.json",
          "tools/guardrails/tsconfig.test.json",
          "tsconfig.eslint.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Local plugin and flat config are plain ESM; lint without type info (N3).
    name: "cge/untyped-js",
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  ...determinismConfig,
);
