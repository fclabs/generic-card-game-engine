import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configRoot = join(here, "..");

/** Constructs that could execute bundle content (DFR-045, DBR-005). */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: "import(", pattern: /\bimport\s*\(/ },
  { name: "require(", pattern: /\brequire\s*\(/ },
  { name: "eval(", pattern: /\beval\s*\(/ },
  { name: "new Function", pattern: /\bnew\s+Function\b/ },
  { name: "node:vm", pattern: /["']node:vm["']|["']vm["']/ },
];

function files(dir: string, include: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, include));
    else if (include.test(name)) out.push(path);
  }
  return out;
}

const SOURCE = /\.(ts|js|mjs|cjs)$/;
const NOT_TEST = /\.(test|testing)\.(ts|js)$/;

/** Violations as `<relative file>: <construct>`. `include` selects the files scanned. */
function scan(dir: string, include: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files(dir, include)) {
    if (NOT_TEST.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(text))
        hits.push(`${relative(configRoot, file)}: ${name}`);
    }
  }
  return hits;
}

describe("VC-235: nothing executes a hook bundle (DFR-045, DBR-005)", () => {
  it("packages/core/src/definition and packages/config/src contain no dynamic-execution construct", () => {
    const dirs = [
      join(configRoot, "..", "core", "src", "definition"),
      join(configRoot, "src"),
    ];
    const scanned = dirs
      .flatMap((dir) => files(dir, SOURCE))
      .filter((f) => !NOT_TEST.test(f));
    expect(scanned.length).toBeGreaterThan(10);
    expect(dirs.flatMap((dir) => scan(dir, SOURCE))).toEqual([]);
  });

  it("the esbuild build call is the only bundler entry point", () => {
    const text = readFileSync(join(configRoot, "src", "bundle.ts"), "utf8");
    expect(text).toContain('from "esbuild"');
  });

  it("fails on the seeded fixture that imports a bundle path", () => {
    const hits = scan(join(configRoot, "fixtures", "static-violation"), /./);
    expect(hits).toEqual([
      "fixtures/static-violation/executes-bundle.ts.txt: import(",
    ]);
  });
});
