import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileDefinition,
  DEFAULT_DEFINITION_LIMITS,
  type DefinitionError,
  type DefinitionId,
} from "@cge/core";
import { buildHookBundle } from "./bundle.js";
import { createFilesystemDefinitionRegistry } from "./registry.js";
import { parseYaml } from "./yaml.js";
import { runRegistryContract } from "./registry-contract.testing.js";
import { perfGameName, writePerfGames } from "./perf-fixture.testing.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const limits = DEFAULT_DEFINITION_LIMITS;
const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cge-registry-"));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function game(root: string, name: string, yaml: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.yaml"), yaml);
  return dir;
}

const simple = (id: string, extra = ""): string =>
  `id: ${id}\naction_schema_version: 1\nseats: { count: 2 }\n${extra}`;

const load = (...searchPaths: string[]) =>
  createFilesystemDefinitionRegistry({ searchPaths, limits });

function failed(result: Awaited<ReturnType<typeof load>>): DefinitionError[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : [...result.error];
}

describe("VC-241: loading a search path (DFR-051)", () => {
  it("loads three valid games, ignoring an empty directory, .gitkeep and a stray file", async () => {
    const root = temp();
    game(root, "alpha", simple("alpha"));
    game(
      root,
      "beta",
      simple("beta", "zones: [{ id: z, ordering: ordered }]\n"),
    );
    game(root, "gamma", simple("gamma"));
    mkdirSync(join(root, "empty"));
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, ".gitkeep"), "");
    writeFileSync(join(root, "README.txt"), "stray");
    // The directory "empty" has no game.yaml: it is an error, not ignored.
    expect(failed(await load(root)).map((e) => e.code)).toEqual([
      "GAME_YAML_MISSING",
    ]);
    rmSync(join(root, "empty"), { recursive: true });
    const result = await load(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { definitions } = result.value;
    expect(definitions.map((d) => d.gameId)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(new Set(definitions.map((d) => d.definitionId)).size).toBe(3);
    for (const d of definitions) {
      expect(d.schemaVersion).toBe(1);
      expect(d.definitionId).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("an empty search path is ok with zero definitions; a directory holding only .gitkeep too", async () => {
    const root = temp();
    writeFileSync(join(root, ".gitkeep"), "");
    const result = await load(root, temp());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.definitions).toEqual([]);
  });

  it("reports the errors of two invalid games together, each prefixed by its directory", async () => {
    const root = temp();
    game(root, "good", simple("good"));
    const bad1 = game(
      root,
      "bad1",
      "id: bad1\naction_schema_version: 1\nseats: { count: 2 }\nzones: [{ id: z }]\n",
    );
    const bad2 = game(
      root,
      "bad2",
      "id: bad2\naction_schema_version: 1\nseats: { count: 2 }\nbogus: 1\n",
    );
    const errors = failed(await load(root));
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["SCHEMA_MISSING", `${bad1}/zones[0].ordering`],
      ["SCHEMA_UNKNOWN_KEY", `${bad2}/bogus`],
    ]);
  });

  it("a root-level error path is the directory itself; YAML errors are prefixed too", async () => {
    const root = temp();
    const dir = game(root, "bad", "a: [1, 2\n");
    const errors = failed(await load(root));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("YAML_SYNTAX");
    expect(errors[0]?.path).toBe(dir);
  });
});

describe("VC-242: load-time error codes (DFR-052, DFR-055)", () => {
  it("GAME_YAML_MISSING for a directory without game.yaml", async () => {
    const root = temp();
    const dir = join(root, "nogame");
    mkdirSync(dir);
    const errors = failed(await load(root));
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["GAME_YAML_MISSING", `${dir}/game.yaml`],
    ]);
  });

  it("GAME_ID_MISMATCH when the directory name differs from the YAML id", async () => {
    const root = temp();
    game(root, "hearts", simple("spades"));
    const errors = failed(await load(root));
    expect(errors.map((e) => e.code)).toEqual(["GAME_ID_MISMATCH"]);
    expect(errors[0]?.detail).toContain("hearts");
    expect(errors[0]?.detail).toContain("spades");
  });

  it("SEARCH_PATH_MISSING for an absent path and for a path that is a file", async () => {
    const root = temp();
    const file = join(root, "file.txt");
    writeFileSync(file, "x");
    const errors = failed(await load(join(root, "absent"), file));
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["SEARCH_PATH_MISSING", join(root, "absent")],
      ["SEARCH_PATH_MISSING", file],
    ]);
  });

  it("DUPLICATE_ID for the same id in two search paths", async () => {
    const a = temp();
    const b = temp();
    game(a, "hearts", simple("hearts"));
    const dup = game(b, "hearts", simple("hearts"));
    const errors = failed(await load(a, b));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("DUPLICATE_ID");
    expect(errors[0]?.entity).toBe("hearts");
    expect(errors[0]?.path).toBe(`${dup}/id`);
  });

  it("UNSUPPORTED_SCHEMA_VERSION for action_schema_version: 2", async () => {
    const root = temp();
    game(root, "v2", "id: v2\naction_schema_version: 2\nseats: { count: 2 }\n");
    const errors = failed(await load(root));
    expect(errors.map((e) => e.code)).toEqual(["UNSUPPORTED_SCHEMA_VERSION"]);
  });

  it("a game that needs a bundle without dist/ fails BUNDLE_MISSING; a bad manifest fails BUNDLE_INVALID", async () => {
    const root = temp();
    const yaml = readFileSync(
      join(fixtures, "hook-games", "good-basic", "game.yaml"),
      "utf8",
    );
    const dir = game(root, "good-basic", yaml);
    writeFileSync(
      join(dir, "hooks.ts"),
      "export function validatePlay() {}\nexport function onSetup() {}\n",
    );
    expect(failed(await load(root)).map((e) => e.code)).toContain(
      "BUNDLE_MISSING",
    );
    expect((await buildHookBundle(dir)).ok).toBe(true);
    expect((await load(root)).ok).toBe(true);
    writeFileSync(join(dir, "dist", "hooks.manifest.json"), "{not json");
    expect(failed(await load(root)).map((e) => e.code)).toContain(
      "BUNDLE_INVALID",
    );
  });
});

describe("VC-237 leftover dist/ part (DFR-047, DFR-051)", () => {
  it("a game with no hooks gets the same DefinitionId with and without a stray dist/", async () => {
    const clean = temp();
    const dirty = temp();
    game(clean, "plain", simple("plain"));
    const dir = game(dirty, "plain", simple("plain"));
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "hooks.js"), "export const x = 1;\n");
    writeFileSync(
      join(dir, "dist", "hooks.manifest.json"),
      '{"exports":["x"]}\n',
    );
    const a = await load(clean);
    const b = await load(dirty);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.definitions[0]?.definitionId).toBe(
      a.value.definitions[0]?.definitionId,
    );
    // Editing the stray bundle later cannot change resolution either.
    writeFileSync(join(dir, "dist", "hooks.js"), "export const x = 2;\n");
    const id = b.value.definitions[0]?.definitionId as DefinitionId;
    expect((await b.value.registry.resolve(id)).ok).toBe(true);
  });
});

/** Filesystem adapter under the contract suite (VC-243). */
const CONTRACT_YAML = (extra: string): string =>
  `${extra}id: contract-game
action_schema_version: 1
seats: { count: 2 }
zones:
  - { id: stock, ordering: ordered }
  - { id: discard, ordering: ordered }
cards:
  - { id: c1, zone: stock }
  - { id: c2, zone: stock }
hooks:
  module: ./hooks.ts
  validation: { play_card: validatePlay }
  reaction: { "trigger:setup": onSetup }
`;

runRegistryContract("filesystem", async () => {
  const root = temp();
  const dir = join(root, "contract-game");
  mkdirSync(dir);
  cpSync(
    join(fixtures, "hook-games", "good-basic", "hooks.ts"),
    join(dir, "hooks.ts"),
  );
  const yamlPath = join(dir, "game.yaml");
  writeFileSync(yamlPath, CONTRACT_YAML(""));
  const built = await buildHookBundle(dir);
  if (!built.ok) throw new Error("fixture bundle failed");
  const parsed = parseYaml(readFileSync(yamlPath, "utf8"));
  if (!parsed.ok) throw new Error("fixture yaml failed");
  const compiled = compileDefinition(parsed.value, {
    bundle: built.value,
    limits,
  });
  if (!compiled.ok) throw new Error("fixture compile failed");
  const loaded = await load(root);
  if (!loaded.ok)
    throw new Error(`fixture load failed: ${JSON.stringify(loaded.error)}`);
  const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
  return {
    registry: loaded.value.registry,
    id,
    expected: compiled.value,
    edits: {
      semantic: () => {
        writeFileSync(
          yamlPath,
          readFileSync(yamlPath, "utf8").replace(
            "{ id: c2, zone: stock }",
            "{ id: c2, zone: discard }",
          ),
        );
      },
      bundleByte: () => {
        const path = join(dir, "dist", "hooks.js");
        const bytes = readFileSync(path);
        bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0x01;
        writeFileSync(path, bytes);
      },
      comment: () => {
        writeFileSync(
          yamlPath,
          CONTRACT_YAML("# an edit that changes nothing\n"),
        );
      },
      broken: () => {
        writeFileSync(yamlPath, "a: [1, 2\n");
      },
    },
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
});

describe("registry behaviours beyond the contract (DFR-053)", () => {
  it("DEFINITION_INVALID when the game directory disappears; never throws", async () => {
    const root = temp();
    const dir = game(root, "gone", simple("gone"));
    const loaded = await load(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
    rmSync(dir, { recursive: true, force: true });
    const result = await loaded.value.registry.resolve(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DEFINITION_INVALID");
    const odd = await loaded.value.registry.resolve(
      undefined as unknown as DefinitionId,
    );
    expect(odd.ok).toBe(false);
  });

  it("a hooks.module-only edit to a game with no bundle reference changes nothing; removing the bundle of a needed game is DEFINITION_INVALID", async () => {
    const root = temp();
    const yaml = readFileSync(
      join(fixtures, "hook-games", "good-basic", "game.yaml"),
      "utf8",
    );
    const dir = game(root, "good-basic", yaml);
    cpSync(
      join(fixtures, "hook-games", "good-basic", "hooks.ts"),
      join(dir, "hooks.ts"),
    );
    expect((await buildHookBundle(dir)).ok).toBe(true);
    const loaded = await load(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
    rmSync(join(dir, "dist"), { recursive: true });
    const result = await loaded.value.registry.resolve(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DEFINITION_INVALID");
  });
});

function existsDockerenv(): boolean {
  return existsSync("/.dockerenv");
}

describe("VC-244: registry cost (DNFR-004)", () => {
  const strict = process.env["CGE_PERF_STRICT"] === "1" || existsDockerenv();
  const factor = strict ? 1 : 10;
  const perfRoot = join(tmpdir(), `cge-perf-games-${String(process.pid)}`);

  beforeAll(async () => {
    temps.push(perfRoot);
    await writePerfGames(perfRoot);
  }, 120_000);

  it("generates 20 games of 52 cards, 6 zones, 4 counters and a ~4 KiB bundle", async () => {
    const loaded = await load(perfRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.definitions).toHaveLength(20);
    const bundle = readFileSync(
      join(perfRoot, perfGameName(0), "dist", "hooks.js"),
    );
    expect(bundle.length).toBeGreaterThanOrEqual(4096);
    expect(bundle.length).toBeLessThan(6000);
    const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
    const def = await loaded.value.registry.resolve(id);
    expect(def.ok && def.value.cards.length).toBe(52);
    expect(def.ok && def.value.zones.length).toBe(6);
    expect(def.ok && def.value.counters.length).toBe(4);
  });

  it("loads the 20-game search path in <= 5 s (median of 5 after 1 warm-up)", async () => {
    await load(perfRoot);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await load(perfRoot);
      times.push(performance.now() - t0);
      expect(r.ok).toBe(true);
    }
    times.sort((a, b) => a - b);
    const median = times[2] ?? Infinity;
    console.info(
      `VC-244 20-game load: median ${median.toFixed(1)} ms (bound ${String(5000 * factor)} ms)`,
    );
    expect(median).toBeLessThanOrEqual(5000 * factor);
  });

  it("resolve of an unchanged 700-card definition takes <= 50 ms (median of 20 after 3 warm-ups)", async () => {
    const root = temp();
    const dir = join(root, "floor");
    mkdirSync(dir);
    cpSync(join(fixtures, "floor-definition.yaml"), join(dir, "game.yaml"));
    const loaded = await load(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
    for (let i = 0; i < 3; i++) await loaded.value.registry.resolve(id);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await loaded.value.registry.resolve(id);
      times.push(performance.now() - t0);
      expect(r.ok && r.value.cards.length).toBe(700);
    }
    times.sort((a, b) => a - b);
    const median = ((times[9] ?? 0) + (times[10] ?? 0)) / 2;
    console.info(
      `VC-244 resolve (700 cards): median ${median.toFixed(2)} ms (bound ${String(50 * factor)} ms)`,
    );
    expect(median).toBeLessThanOrEqual(50 * factor);
  });
});
