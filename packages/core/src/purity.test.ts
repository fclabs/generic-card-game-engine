import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Drop comments, then (for the identifier check) string and template literals. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
function stripStrings(src: string): string {
  return src.replace(
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    '""',
  );
}

describe("VC-065 no node:/crypto in non-test core sources", () => {
  const root = new URL("./", import.meta.url).pathname;
  const files = sources(root);

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no import specifier starting node: or crypto", () => {
    const spec =
      /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'](node:[^"']*|crypto[^"']*)["']/;
    const offenders = files.filter((f) =>
      spec.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("no identifier crypto or globalThis.crypto", () => {
    const offenders = files.filter((f) =>
      /\bcrypto\b/.test(stripStrings(stripComments(readFileSync(f, "utf8")))),
    );
    expect(offenders).toEqual([]);
  });

  it("the scanner would catch a violation", () => {
    const bad = stripStrings(
      stripComments(
        'import { x } from "node:crypto";\nconst c = crypto.x; // crypto',
      ),
    );
    expect(/\bcrypto\b/.test(bad)).toBe(true);
    expect(
      /from\s*["'](node:[^"']*)["']/.test(
        stripComments('import a from "node:fs";'),
      ),
    ).toBe(true);
  });
});
