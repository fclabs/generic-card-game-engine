import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * VC-105 (KBR-012): the Phase 0 determinism guardrail still reports a forbidden import and
 * a forbidden global when they appear in `packages/core/src/session`. The violations exist
 * only as temp-directory fixtures linted under a virtual `session/` path; nothing is
 * committed. The ESLint instance uses the real `determinismConfig` the repository lint uses.
 */

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SESSION_DIR = new URL("./session/", import.meta.url).pathname;
const IMPORTS = "cge/no-nondeterministic-imports";
const GLOBALS = "cge/no-nondeterministic-globals";

interface LintResult {
  readonly messages: readonly {
    readonly ruleId: string | null;
    readonly message: string;
  }[];
}
interface LinterLike {
  lintText(code: string, options: { filePath: string }): Promise<LintResult[]>;
}

// `eslint` is a repository (root) dev tool, not a dependency of core, so it is loaded by a
// computed specifier: dependency-cruiser sees no `eslint` import in core, and the test runs
// the same linter instance factory the guardrail suite uses (real `determinismConfig`).
async function newLinter(): Promise<LinterLike> {
  const configUrl = pathToFileURL(
    join(REPO_ROOT, "eslint/determinism.mjs"),
  ).href;
  const config = (await import(/* @vite-ignore */ configUrl)) as unknown as {
    determinismConfig: unknown[];
  };
  const specifier = "eslint";
  const eslint = (await import(/* @vite-ignore */ specifier)) as unknown as {
    ESLint: new (options: object) => LinterLike;
  };
  return new eslint.ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      { languageOptions: { ecmaVersion: 2022, sourceType: "module" } },
      ...config.determinismConfig,
    ],
  });
}

async function cgeMessages(linter: LinterLike, code: string, filePath: string) {
  const results = await linter.lintText(code, { filePath });
  return (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === IMPORTS || m.ruleId === GLOBALS,
  );
}

/** Writes each fixture to a fresh temp dir, runs `body` on the read-back contents, cleans up. */
async function withFixtures(
  files: Readonly<Record<string, string>>,
  body: (read: (name: string) => string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "cge-guardrail-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    await body((name) => readFileSync(join(dir, name), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VIRTUAL = "packages/core/src/session/guardrail-fixture.ts";

describe("VC-105 the determinism guardrail still reports violations in core/session", () => {
  it("reports an `import 'node:fs'`", async () => {
    const linter = await newLinter();
    await withFixtures(
      {
        "bad-import.ts":
          'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n',
        "bad-side-effect-import.ts": 'import "node:fs";\n',
        "bad-dynamic-import.ts":
          'export const load = () => import("node:fs");\n',
      },
      async (read) => {
        for (const name of [
          "bad-import.ts",
          "bad-side-effect-import.ts",
          "bad-dynamic-import.ts",
        ]) {
          const messages = await cgeMessages(linter, read(name), VIRTUAL);
          const hit = messages.find(
            (m) => m.ruleId === IMPORTS && m.message.includes("node:fs"),
          );
          expect(hit, `${name}: ${JSON.stringify(messages)}`).toBeDefined();
        }
      },
    );
  });

  it("reports `Date.now()` and the other banned globals", async () => {
    const linter = await newLinter();
    await withFixtures(
      {
        "bad-date.ts": "export const stamp = () => Date.now();\n",
        "bad-random.ts": "export const r = () => Math.random();\n",
        "bad-perf.ts": "export const t = () => performance.now();\n",
        "bad-env.ts": "export const e = process.env;\n",
      },
      async (read) => {
        const expected: Readonly<Record<string, string>> = {
          "bad-date.ts": "Date",
          "bad-random.ts": "Math.random",
          "bad-perf.ts": "performance",
          "bad-env.ts": "process",
        };
        for (const [name, token] of Object.entries(expected)) {
          const messages = await cgeMessages(linter, read(name), VIRTUAL);
          const hit = messages.find(
            (m) => m.ruleId === GLOBALS && m.message.includes(token),
          );
          expect(hit, `${name}: ${JSON.stringify(messages)}`).toBeDefined();
        }
      },
    );
  });

  it("accepts clean code, and test files stay exempt", async () => {
    const linter = await newLinter();
    await withFixtures(
      { "clean.ts": "export const one = (x: number): number => x + 1;\n" },
      async (read) => {
        expect(await cgeMessages(linter, read("clean.ts"), VIRTUAL)).toEqual(
          [],
        );
      },
    );
    const bad = 'import "node:fs";\nexport const n = Date.now();\n';
    expect(
      await cgeMessages(
        linter,
        bad,
        "packages/core/src/session/guardrail-fixture.test.ts",
      ),
    ).toEqual([]);
    expect((await cgeMessages(linter, bad, VIRTUAL)).length).toBeGreaterThan(1);
  });

  it("the real sources of core/session are clean (no committed violation)", async () => {
    const linter = await newLinter();
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".ts")) files.push(p);
      }
    };
    walk(SESSION_DIR);
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const virtual = file.slice(REPO_ROOT.length);
      expect(
        await cgeMessages(linter, readFileSync(file, "utf8"), virtual),
        virtual,
      ).toEqual([]);
    }
  });
});
