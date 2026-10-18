/**
 * Data-driven lint fixtures for FR-040 / VC-022–VC-026.
 * Codes are strings only — this file is safe to typecheck; banned forms never execute.
 */

export type ExpectedViolation = {
  ruleId: "cge/no-nondeterministic-globals" | "cge/no-nondeterministic-imports";
  /** Substring that must appear in the message (global or import name). */
  name: string;
};

export type LintCase = {
  id: string;
  /** Virtual path passed to ESLint lintText (drives determinism scope). */
  filePath: string;
  code: string;
  /** null → expect zero cge/* errors. */
  expect: ExpectedViolation | null;
};

const IN_SCOPE = [
  "packages/core/src/x.ts",
  "packages/helpers/src/x.ts",
  "games/demo/hooks/x.ts",
] as const;

/** Banned globals from VC-022 / FR-023 (15 forms) + XMLHttpRequest from FR-023. */
const BANNED_GLOBALS: ReadonlyArray<{ id: string; code: string; name: string }> =
  [
    { id: "Date-now", code: "Date.now();\n", name: "Date" },
    { id: "new-Date", code: "new Date();\n", name: "Date" },
    { id: "Math-random", code: "Math.random();\n", name: "Math.random" },
    { id: "performance-now", code: "performance.now();\n", name: "performance" },
    { id: "process-env", code: "process.env.X;\n", name: "process" },
    { id: "setTimeout", code: "setTimeout(() => {}, 0);\n", name: "setTimeout" },
    { id: "setInterval", code: "setInterval(() => {}, 0);\n", name: "setInterval" },
    {
      id: "setImmediate",
      code: "setImmediate(() => {});\n",
      name: "setImmediate",
    },
    {
      id: "queueMicrotask",
      code: "queueMicrotask(() => {});\n",
      name: "queueMicrotask",
    },
    {
      id: "crypto-randomUUID",
      code: "crypto.randomUUID();\n",
      name: "crypto",
    },
    {
      id: "globalThis-crypto",
      code: "globalThis.crypto;\n",
      name: "globalThis.crypto",
    },
    {
      id: "SharedArrayBuffer",
      code: "new SharedArrayBuffer(8);\n",
      name: "SharedArrayBuffer",
    },
    {
      id: "Atomics-load",
      code: "Atomics.load(new Int32Array(new SharedArrayBuffer(4)), 0);\n",
      name: "Atomics",
    },
    { id: "fetch", code: "fetch('https://example.com');\n", name: "fetch" },
    {
      id: "WebSocket",
      code: "new WebSocket('wss://example.com');\n",
      name: "WebSocket",
    },
    {
      id: "XMLHttpRequest",
      code: "new XMLHttpRequest();\n",
      name: "XMLHttpRequest",
    },
  ];

/** Import forms from VC-024 / FR-024. */
const BANNED_IMPORTS: ReadonlyArray<{
  id: string;
  code: string;
  name: string;
}> = [
  {
    id: "static-node-fs",
    code: 'import fs from "node:fs";\nvoid fs;\n',
    name: "node:fs",
  },
  { id: "static-bare-fs", code: 'import "fs";\n', name: "fs" },
  {
    id: "static-node-crypto",
    code: 'import "node:crypto";\n',
    name: "node:crypto",
  },
  { id: "static-bare-crypto", code: 'import "crypto";\n', name: "crypto" },
  {
    id: "static-node-worker_threads",
    code: 'import "node:worker_threads";\n',
    name: "node:worker_threads",
  },
  { id: "static-bare-stream", code: 'import "stream";\n', name: "stream" },
  {
    id: "dynamic-node-fs",
    code: 'await import("node:fs");\n',
    name: "node:fs",
  },
  {
    id: "reexport-star-node-path",
    code: 'export * from "node:path";\n',
    name: "node:path",
  },
  {
    id: "reexport-named-node-path",
    code: 'export { join } from "node:path";\n',
    name: "node:path",
  },
];

function bannedCases(): LintCase[] {
  const cases: LintCase[] = [];

  for (const g of BANNED_GLOBALS) {
    for (const filePath of IN_SCOPE) {
      const scope = filePath.includes("helpers")
        ? "helpers"
        : filePath.includes("games")
          ? "hooks"
          : "core";
      cases.push({
        id: `ban-global-${g.id}-${scope}`,
        filePath,
        code: g.code,
        expect: {
          ruleId: "cge/no-nondeterministic-globals",
          name: g.name,
        },
      });
    }
  }

  for (const imp of BANNED_IMPORTS) {
    for (const filePath of IN_SCOPE) {
      const scope = filePath.includes("helpers")
        ? "helpers"
        : filePath.includes("games")
          ? "hooks"
          : "core";
      cases.push({
        id: `ban-import-${imp.id}-${scope}`,
        filePath,
        code: imp.code,
        expect: {
          ruleId: "cge/no-nondeterministic-imports",
          name: imp.name,
        },
      });
    }
  }

  return cases;
}

/** VC-023 / BR-004: same banned forms in a test file → allowed. */
function testExemptionCases(): LintCase[] {
  const filePath = "packages/core/src/x.test.ts";
  const cases: LintCase[] = [];
  for (const g of BANNED_GLOBALS) {
    cases.push({
      id: `exempt-test-global-${g.id}`,
      filePath,
      code: g.code,
      expect: null,
    });
  }
  for (const imp of BANNED_IMPORTS) {
    cases.push({
      id: `exempt-test-import-${imp.id}`,
      filePath,
      code: imp.code,
      expect: null,
    });
  }
  return cases;
}

/** VC-025 / FR-025 and VC-026 / BR-005 allowed cases (≥ 5). */
function allowedCases(): LintCase[] {
  const outOfScopeCode =
    'Date.now();\nimport fs from "node:fs";\nvoid fs;\n';

  return [
    {
      id: "allow-server",
      filePath: "packages/server/src/x.ts",
      code: outOfScopeCode,
      expect: null,
    },
    {
      id: "allow-adapter-store-sqlite",
      filePath: "packages/adapters/store-sqlite/src/x.ts",
      code: outOfScopeCode,
      expect: null,
    },
    {
      id: "allow-config",
      filePath: "packages/config/src/x.ts",
      code: outOfScopeCode,
      expect: null,
    },
    {
      id: "allow-vitest-config",
      filePath: "vitest.config.ts",
      code: outOfScopeCode,
      expect: null,
    },
    {
      id: "allow-core-test-file",
      filePath: "packages/core/src/x.test.ts",
      code: outOfScopeCode,
      expect: null,
    },
    {
      id: "allow-promise-in-core",
      filePath: "packages/core/src/x.ts",
      code: "await Promise.resolve();\n",
      expect: null,
    },
    {
      id: "allow-shadowed-Date",
      filePath: "packages/core/src/x.ts",
      code: "const Date = { now: () => 0 };\nDate.now();\n",
      expect: null,
    },
  ];
}

export const lintCases: LintCase[] = [
  ...bannedCases(),
  ...testExemptionCases(),
  ...allowedCases(),
];
