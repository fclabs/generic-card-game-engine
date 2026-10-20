import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDefinition } from "@cge/core";
import { buildHookBundle, bundleGames } from "./bundle.js";
import { parseYaml } from "./yaml.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "hook-games");
const entry = join(here, "..", "dist", "bundle-games.js");
const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cge-bundle-"));
  temps.push(dir);
  return dir;
}

/** Copies fixture games into a fresh root so builds never write into the repo. */
function copyGames(root: string, ...names: string[]): void {
  for (const name of names) {
    cpSync(join(fixtures, name), join(root, name), { recursive: true });
  }
}

function gameWith(yaml: string, files: Record<string, string> = {}): string {
  const dir = temp();
  writeFileSync(join(dir, "game.yaml"), yaml);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const read = (dir: string, file: string): Buffer =>
  readFileSync(join(dir, file));

describe("buildHookBundle (VC-234, DFR-044)", () => {
  it("builds a single self-contained, unminified file from a module with a local helper", async () => {
    const root = temp();
    copyGames(root, "good-helper");
    const dir = join(root, "good-helper");
    const result = await buildHookBundle(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const js = read(dir, "dist/hooks.js").toString("utf8");
    expect(readdirSync(join(dir, "dist")).sort()).toEqual([
      "hooks.js",
      "hooks.manifest.json",
    ]);
    // inlined helper, readable names, no relative import left
    expect(js).toContain("function clampScore(");
    expect(js).toContain("function authorize(");
    expect(js).not.toMatch(/\bfrom\s+["'][./]/);
    expect(js).not.toMatch(/\bimport\s*["'(]/);
    expect(js).not.toMatch(/\brequire\(/);
    expect(js).not.toContain("sourceMappingURL");
    expect(js).not.toContain(root);
    expect(js).not.toMatch(/(^|[\s"'(])\/(Users|home|private|tmp|var)\//);
    expect(js).not.toMatch(/[A-Za-z]:\\/);
    expect(js).toMatch(/^export \{/m);
    expect(result.value.exports).toEqual(["authorize"]);
    expect(read(dir, "dist/hooks.manifest.json").toString("utf8")).toBe(
      '{"exports":["authorize"]}\n',
    );
  });

  it("lists the exports sorted and distinct, and the info hash matches the bundle", async () => {
    const root = temp();
    copyGames(root, "good-basic");
    const dir = join(root, "good-basic");
    const result = await buildHookBundle(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exports).toEqual(["onSetup", "validatePlay"]);
    expect(result.value.hash).toMatch(/^[0-9a-f]{64}$/);
    const manifest = JSON.parse(
      read(dir, "dist/hooks.manifest.json").toString("utf8"),
    ) as { exports: string[] };
    expect(manifest).toEqual({ exports: ["onSetup", "validatePlay"] });
    // the produced info feeds the compiler: every reference resolves
    const raw = parseYaml(read(dir, "game.yaml").toString("utf8"));
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    expect(compileDefinition(raw.value, { bundle: result.value }).ok).toBe(
      true,
    );
  });

  it("DNFR-001: a second build is byte-identical, also after the game is moved elsewhere", async () => {
    const rootA = temp();
    copyGames(rootA, "good-helper", "good-basic");
    const results = [];
    for (const name of ["good-helper", "good-basic"]) {
      const dir = join(rootA, name);
      const first = await buildHookBundle(dir);
      const js1 = read(dir, "dist/hooks.js");
      const man1 = read(dir, "dist/hooks.manifest.json");
      const second = await buildHookBundle(dir);
      expect(read(dir, "dist/hooks.js").equals(js1)).toBe(true);
      expect(read(dir, "dist/hooks.manifest.json").equals(man1)).toBe(true);
      expect(second).toEqual(first);
      // a copy in a different (deeper) location yields the same bytes and hash
      const moved = join(temp(), "deeper", "still", name);
      mkdirSync(dirname(moved), { recursive: true });
      cpSync(join(fixtures, name), moved, { recursive: true });
      const third = await buildHookBundle(moved);
      expect(read(moved, "dist/hooks.js").equals(js1)).toBe(true);
      expect(read(moved, "dist/hooks.manifest.json").equals(man1)).toBe(true);
      expect(third).toEqual(first);
      results.push(first.ok);
    }
    expect(results).toEqual([true, true]);
  });

  it("accepts a relative game directory", async () => {
    const root = temp();
    copyGames(root, "good-basic");
    const result = await buildHookBundle(
      join(root, "good-basic", "..", "good-basic"),
    );
    expect(result.ok).toBe(true);
  });

  it("BUNDLE_INVALID for a syntax error, with the build message and location", async () => {
    const root = temp();
    copyGames(root, "broken");
    const result = await buildHookBundle(join(root, "broken"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.code).toBe("BUNDLE_INVALID");
    expect(result.error[0]?.path).toBe("hooks.module");
    expect(result.error[0]?.detail).toContain("hooks.ts:");
    expect(result.error[0]?.detail).not.toContain(root);
    expect(() =>
      readFileSync(join(root, "broken", "dist", "hooks.js")),
    ).toThrow();
  });

  it("BUNDLE_INVALID when the module file is missing", async () => {
    const dir = gameWith(
      "id: g\naction_schema_version: 1\nseats: { count: 2 }\nhooks: { module: ./hooks.ts }\n",
    );
    const result = await buildHookBundle(dir);
    expect(result).toMatchObject({
      ok: false,
      error: [{ code: "BUNDLE_INVALID", path: "hooks.module" }],
    });
  });

  it("BUNDLE_INVALID when the module exports nothing while the YAML references hooks (DFR-044 reading)", async () => {
    const referencing = gameWith(
      "id: g\naction_schema_version: 1\nseats: { count: 2 }\nhooks: { module: ./hooks.ts, validation: { play: v } }\n",
      { "hooks.ts": "const unused = 1;\nvoid unused;\n" },
    );
    const result = await buildHookBundle(referencing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe("BUNDLE_INVALID");
      expect(result.error[0]?.detail).toContain("exports nothing");
    }
    // without references an empty module is a valid, empty bundle
    const plain = gameWith(
      "id: g\naction_schema_version: 1\nseats: { count: 2 }\nhooks: { module: ./hooks.ts }\n",
      { "hooks.ts": "const unused = 1;\nvoid unused;\n" },
    );
    const empty = await buildHookBundle(plain);
    expect(empty).toMatchObject({ ok: true, value: { exports: [] } });
  });

  it("does not check references against exports (left to the compiler)", async () => {
    const dir = gameWith(
      "id: g\naction_schema_version: 1\nseats: { count: 2 }\nhooks: { module: ./hooks.ts, validation: { play: missing } }\n",
      { "hooks.ts": "export const other = 1;\n" },
    );
    expect(await buildHookBundle(dir)).toMatchObject({
      ok: true,
      value: { exports: ["other"] },
    });
  });

  it("rejects a missing game.yaml, YAML errors, a missing or malformed hooks.module", async () => {
    const empty = temp();
    expect(await buildHookBundle(empty)).toMatchObject({
      ok: false,
      error: [{ code: "GAME_YAML_MISSING" }],
    });
    expect(await buildHookBundle(gameWith("a: [1, 2"))).toMatchObject({
      ok: false,
      error: [{ code: "YAML_SYNTAX" }],
    });
    expect(await buildHookBundle(gameWith("id: g\n"))).toMatchObject({
      ok: false,
      error: [{ code: "BUNDLE_INVALID", detail: "hooks.module is not set" }],
    });
    for (const module of [
      "../x.ts",
      "hooks.ts",
      "./hooks.mjs",
      "./a/../b.ts",
    ]) {
      const result = await buildHookBundle(
        gameWith(`id: g\nhooks: { module: "${module}" }\n`),
      );
      expect(result).toMatchObject({
        ok: false,
        error: [{ code: "BUNDLE_INVALID" }],
      });
    }
  });

  it("never reads a directory that does not exist as a bundle (no throw)", async () => {
    const result = await buildHookBundle(join(temp(), "nope"));
    expect(result.ok).toBe(false);
  });
});

describe("bundleGames and pnpm bundle:games (VC-236, DFR-046)", () => {
  it("builds every game that declares hooks.module and skips the rest", async () => {
    const root = temp();
    copyGames(root, "good-helper", "good-basic");
    mkdirSync(join(root, ".hidden"));
    mkdirSync(join(root, "no-yaml"));
    mkdirSync(join(root, "no-hooks"));
    writeFileSync(
      join(root, "no-hooks", "game.yaml"),
      "id: no-hooks\naction_schema_version: 1\nseats: { count: 2 }\n",
    );
    writeFileSync(join(root, "stray.txt"), "x");
    const outcomes = await bundleGames(root);
    expect(outcomes.map((o) => [o.game, o.ok])).toEqual([
      ["good-basic", true],
      ["good-helper", true],
    ]);
    expect(await bundleGames(join(root, "absent"))).toEqual([]);
  });

  it("process: builds both good games and exits 0", () => {
    const root = temp();
    copyGames(root, "good-helper", "good-basic");
    const run = spawnSync(process.execPath, [entry, root], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("built good-basic");
    expect(run.stdout).toContain("built good-helper");
    expect(
      read(join(root, "good-basic"), "dist/hooks.js").length,
    ).toBeGreaterThan(0);
    expect(
      read(join(root, "good-helper"), "dist/hooks.manifest.json").length,
    ).toBeGreaterThan(0);
  });

  it("process: with one broken game exits non-zero naming it", () => {
    const root = temp();
    copyGames(root, "good-helper", "good-basic", "broken");
    const run = spawnSync(process.execPath, [entry, root], {
      encoding: "utf8",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("broken");
    expect(run.stderr).toContain("BUNDLE_INVALID");
    expect(run.stdout).toContain("built good-basic");
  });

  it("process: an absent or empty games root exits 0 with a message", () => {
    const missing = spawnSync(process.execPath, [entry, join(temp(), "none")], {
      encoding: "utf8",
    });
    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain("no games directory");
    const empty = spawnSync(process.execPath, [entry, temp()], {
      encoding: "utf8",
    });
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("no game declares hooks.module");
  });

  it("process: the default root is games under the working directory", () => {
    const cwd = temp();
    const run = spawnSync(process.execPath, [entry], { cwd, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no games directory");
  });
});
