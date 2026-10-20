import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, "..", "..");

/** Every `*.test.ts` below `packages/`, without build output and dependencies. */
function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "fixtures"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(path));
    else if (entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const TITLE = /\b(?:it|test)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Titles of all tests, keyed by the file that declares them. */
function titles(): { file: string; title: string }[] {
  const out: { file: string; title: string }[] = [];
  for (const file of testFiles(PACKAGES)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(TITLE)) {
      out.push({
        file: relative(join(PACKAGES, ".."), file),
        title: match[2] ?? "",
      });
    }
  }
  return out;
}

const BUSINESS_RULES = Array.from(
  { length: 11 },
  (_, i) => `DBR-${String(i + 1).padStart(3, "0")}`,
);

describe("business rule coverage", () => {
  it("every business rule has a test whose name contains its id", () => {
    const all = titles();
    const missing: string[] = [];
    const lines: string[] = [];
    for (const id of BUSINESS_RULES) {
      const found = all.filter((t) => t.title.includes(id));
      lines.push(
        `${id}: ${String(found.length)} test(s), e.g. ${found[0]?.file ?? "none"}`,
      );
      if (found.length === 0) missing.push(id);
    }
    console.info(`Business rules with a named test:\n${lines.join("\n")}`);
    expect(missing).toEqual([]);
  });
});
