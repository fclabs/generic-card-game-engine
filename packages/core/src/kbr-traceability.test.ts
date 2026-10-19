import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/** Business rules that are proven by failing-path tests whose title carries the rule id. */
const TESTED_RULES = [
  "KBR-001",
  "KBR-002",
  "KBR-003",
  "KBR-004",
  "KBR-005",
  "KBR-006",
  "KBR-007",
  "KBR-008",
  "KBR-009",
  "KBR-010",
  "KBR-011",
] as const;

/** Rules proven by static checks instead: the test files that carry them. */
const STATIC_RULES: Readonly<Record<string, readonly string[]>> = {
  "KBR-012": ["purity.test.ts", "guardrail-fixtures.test.ts"],
  "KBR-013": ["no-timestamps.test.ts"],
};

const root = new URL("./", import.meta.url).pathname;
const SELF = basename(new URL(import.meta.url).pathname);

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testFiles(p));
    else if (name.endsWith(".test.ts") && name !== SELF) out.push(p);
  }
  return out;
}

/** Titles of `it(...)` / `test(...)` calls written with a string literal (describe blocks do not count). */
function testTitles(source: string): string[] {
  const call =
    /\b(?:it|test)(?:\.[a-zA-Z]+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  return [...source.matchAll(call)].map((m) => m[2] ?? "");
}

/** rule id -> "relative/file.test.ts: test title" entries whose title contains the id. */
function traceability(files: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const rel = file.slice(root.length);
    for (const title of testTitles(readFileSync(file, "utf8"))) {
      for (const id of title.match(/KBR-\d{3}/g) ?? []) {
        found.set(id, [...(found.get(id) ?? []), `${rel}: ${title}`]);
      }
    }
  }
  return found;
}

describe("business-rule traceability", () => {
  const files = testFiles(root);
  const found = traceability(files);

  it("scans the kernel test suite", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(TESTED_RULES)(
    "%s has at least one failing-path test named after it",
    (id) => {
      const entries = found.get(id) ?? [];
      expect(entries.length, `no test title contains ${id}`).toBeGreaterThan(0);
    },
  );

  it("lists every rule with its tests", () => {
    const lines = TESTED_RULES.map((id) => {
      const entries = found.get(id) ?? [];
      return `${id}  ${String(entries.length)} test(s)\n${entries.map((e) => `    ${e}`).join("\n")}`;
    });
    for (const [id, carriers] of Object.entries(STATIC_RULES)) {
      lines.push(`${id}  static checks: ${carriers.join(", ")}`);
    }
    // Visible with `vitest run --silent=false`; the assertions above are the gate.
    console.log(`KBR traceability\n${lines.join("\n")}`);
    expect(lines.length).toBe(TESTED_RULES.length + 2);
  });

  it.each(Object.entries(STATIC_RULES))(
    "%s is covered by static-check test files that exist",
    (_id, carriers) => {
      const names = new Set(files.map((f) => basename(f)));
      for (const carrier of carriers) expect(names.has(carrier)).toBe(true);
    },
  );

  it("the title scanner ignores describe blocks and unrelated titles", () => {
    const titles = testTitles(
      [
        'describe("KBR-001 only a block", () => {',
        '  it("KBR-002: real", () => {});',
        "  it(`KBR-003 template`, () => {});",
        '  test.skip("no id here", () => {});',
      ].join("\n"),
    );
    expect(titles).toEqual(["KBR-002: real", "KBR-003 template", "no id here"]);
  });

  it("a rule without a titled test would be reported", () => {
    const synthetic = traceability([]);
    expect(synthetic.get("KBR-001")).toBeUndefined();
  });
});
