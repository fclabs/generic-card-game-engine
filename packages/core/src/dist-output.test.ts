import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inspects the emitted JavaScript of `spi` and `ports` (VC-081, VC-085, VC-095).
 * `pnpm test` runs `pnpm build` first; when vitest is run directly the build must already
 * exist, so a missing dist fails loudly instead of passing vacuously.
 */
const pkgRoot = new URL("../", import.meta.url).pathname;

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

function emitted(
  module: string,
  ext = ".js",
): { path: string; text: string }[] {
  const root = join(pkgRoot, "dist", module);
  if (!existsSync(root)) {
    throw new Error(
      `packages/core/dist/${module} is missing: run \`pnpm build\` first (\`pnpm test\` does this).`,
    );
  }
  const files = walk(root, ext).map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
  if (files.length === 0) throw new Error(`no ${ext} under dist/${module}`);
  return files;
}

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Runtime export surface left in emitted JS: `export {}` is the empty surface. */
function exportsOf(src: string): string[] {
  return code(src)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^export\b/.test(l) && !/^export\s*\{\s*\}\s*;?$/.test(l));
}

describe.each(["spi", "ports"])("emitted %s JavaScript", (module) => {
  const files = emitted(module);

  it("exports no runtime value at all", () => {
    for (const f of files) expect(exportsOf(f.text), f.path).toEqual([]);
  });

  it("declares no function or class", () => {
    for (const f of files) {
      expect(code(f.text), f.path).not.toMatch(/\bfunction\b|\bclass\b|=>/);
    }
  });
});

describe("VC-081 emitted spi contains no timers, dynamic import or await", () => {
  const files = emitted("spi");
  it.each(["setTimeout", "setInterval", "import(", "await"])(
    "no %s",
    (token) => {
      for (const f of files) expect(code(f.text), f.path).not.toContain(token);
    },
  );
});

describe("VC-095 production build does not reference AbortSignal", () => {
  it("tsconfig.json compiles with types: []", () => {
    const cfg = readFileSync(join(pkgRoot, "tsconfig.json"), "utf8");
    expect(cfg).toMatch(/"types"\s*:\s*\[\s*\]/);
  });

  it.each(["spi", "ports"])(
    "%s output and sources name only AbortSignalLike",
    (m) => {
      const texts = [
        ...emitted(m, ".d.ts"),
        ...emitted(m, ".js"),
        ...walk(join(pkgRoot, "src", m), ".ts")
          .filter((p) => !/\.(test|testing)\.ts$/.test(p))
          .map((path) => ({ path, text: readFileSync(path, "utf8") })),
      ];
      for (const f of texts) {
        expect(code(f.text), f.path).not.toMatch(/\bAbortSignal\b/);
      }
    },
  );
});
