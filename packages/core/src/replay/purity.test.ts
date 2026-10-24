import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PNFR-005 / VC-371 (static half): `core/src/visibility` and `core/src/replay` import no
 * `node:*` module (nor a bare Node built-in) outside test files. The dependency-cruiser rule
 * `core-no-node` is the CI guard; this reads the same files so a violation also fails `pnpm test`
 * inside the package.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDERS = ["visibility", "replay"] as const;
const BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "os",
  "path",
  "process",
  "stream",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );
}

const files = FOLDERS.flatMap((f) => walk(join(SRC, f)));
const specifiers = (text: string): string[] =>
  [
    ...text.matchAll(/(?:from|import\s*\(|require\s*\()\s*["']([^"']+)["']/g),
  ].map((m) => m[1] ?? "");

describe("core/src/{visibility,replay} import no Node built-in", () => {
  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("no source file imports node:* or a bare built-in", () => {
    const bad = files.flatMap((file) =>
      specifiers(readFileSync(file, "utf8"))
        .filter((s) => s.startsWith("node:") || BUILTINS.includes(s))
        .map((s) => `${file.slice(SRC.length + 1)} imports ${s}`),
    );
    expect(bad).toEqual([]);
  });

  it("the scanner would catch a violation", () => {
    expect(specifiers(`import { x } from "node:fs";`)).toEqual(["node:fs"]);
    expect(specifiers(`const m = await import("node:path");`)).toEqual([
      "node:path",
    ]);
    expect(specifiers(`import x from "./a.js";`)).toEqual(["./a.js"]);
  });
});
