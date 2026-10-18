import cgePlugin from "./cge-plugin.mjs";

/**
 * Globs that define the determinism scope (FR-022 / N5).
 * Test files (any path ending in .test.ts) are excluded via ignores below.
 */
// ESLint 10 flat-config `files` globs ending in `/**` alone do not match files
// under lintText + overrideConfigFile (N3). Suffix with `*.{ts,js,mjs}`.
export const determinismFiles = [
  "packages/core/**/*.{ts,js,mjs}",
  "packages/helpers/**/*.{ts,js,mjs}",
  "games/*/hooks/**/*.{ts,js,mjs}",
];

/**
 * Standalone flat-config fragment for the `cge/*` determinism rules (N3).
 * Purely syntactic — safe to use with virtual `filePath`s in guardrail tests.
 */
export const determinismConfig = [
  {
    name: "cge/determinism",
    files: [...determinismFiles],
    ignores: ["**/*.test.ts"],
    plugins: {
      cge: cgePlugin,
    },
    rules: {
      "cge/no-nondeterministic-globals": "error",
      "cge/no-nondeterministic-imports": "error",
    },
  },
];
