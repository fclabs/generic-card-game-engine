import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  compileDefinition,
  computeDefinitionId,
  definitionContentHash,
  definitionData,
  hookBundleHash,
  type CompiledGameDefinition,
  type DefinitionError,
  type DefinitionId,
} from "@cge/core";
import { buildHookBundle } from "./bundle.js";
import { createFilesystemDefinitionRegistry } from "./registry.js";
import { loadServerConfig } from "./server-config.js";
import { parseYaml } from "./yaml.js";

/**
 * One failing-path test per business rule, each named with its id so that a
 * scan of the test titles (dbr-names.test.ts) can prove every rule is guarded.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");
const CORE_SRC = join(HERE, "..", "..", "core", "src");
const temps: string[] = [];

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cge-dbr-"));
  temps.push(dir);
  return dir;
}

const BASE = {
  id: "rules",
  action_schema_version: 1,
  seats: { count: 2 },
  zones: [
    { id: "stock", ordering: "ordered" },
    { id: "discard", ordering: "ordered" },
  ],
  cards: [
    { id: "c1", zone: "stock" },
    { id: "c2", zone: "stock" },
  ],
} as const;

function compile(raw: unknown, ctx = {}): CompiledGameDefinition {
  const result = compileDefinition(raw, ctx);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function errorsOf(raw: unknown, ctx = {}): readonly DefinitionError[] {
  const result = compileDefinition(raw, ctx);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

function yamlValue(text: string): unknown {
  const parsed = parseYaml(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("business rules (failing paths)", () => {
  it("DBR-001 everything replay depends on is covered by the DefinitionId; comments, key order and build paths are not", async () => {
    const h0 = definitionContentHash(compile(BASE));
    // A semantic change is a new content hash ...
    const moved = compile({
      ...BASE,
      cards: [
        { id: "c1", zone: "discard" },
        { id: "c2", zone: "stock" },
      ],
    });
    expect(definitionContentHash(moved)).not.toBe(h0);
    // ... while comments, whitespace and key order are not.
    const a = compile(
      yamlValue(
        "id: rules\naction_schema_version: 1\nseats: { count: 2 }\nzones: [{ id: stock, ordering: ordered }]\n",
      ),
    );
    const b = compile(
      yamlValue(
        "# comment\nzones:   [ { ordering: ordered, id: stock } ]\nseats: { count: 2 }\naction_schema_version: 1\nid: rules\n",
      ),
    );
    expect(definitionContentHash(a)).toBe(definitionContentHash(b));
    // One changed bundle byte is a new bundle hash and a new id.
    const js = new TextEncoder().encode("export const f = 1;\n");
    const flipped = Uint8Array.from(js);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const h1 = hookBundleHash(js, ["f"]);
    expect(hookBundleHash(flipped, ["f"])).not.toBe(h1);
    expect(computeDefinitionId(h0, h1)).not.toBe(
      computeDefinitionId(h0, hookBundleHash(flipped, ["f"])),
    );
    expect(computeDefinitionId(h0)).not.toBe(computeDefinitionId(h0, h1));
    // The directory a game is built in does not influence the bundle hash.
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const dir = join(temp(), `place-${String(i)}`, "game");
      mkdirSync(dir, { recursive: true });
      cpSync(join(FIXTURES, "hook-games", "good-basic"), dir, {
        recursive: true,
      });
      const built = await buildHookBundle(dir);
      expect(built.ok).toBe(true);
      if (built.ok) hashes.push(built.value.hash);
    }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("DBR-002 the compiler is pure: a frozen input is accepted unchanged and the same input gives the same result", () => {
    const frozen = deepFreeze(structuredClone(BASE));
    const before = JSON.stringify(frozen);
    const first = compile(frozen);
    const second = compile(frozen);
    expect(definitionData(first)).toEqual(definitionData(second));
    expect(definitionContentHash(first)).toBe(definitionContentHash(second));
    expect(JSON.stringify(frozen)).toBe(before);
    const bad = deepFreeze({ ...structuredClone(BASE), bogus: 1 });
    expect(errorsOf(bad)).toEqual(errorsOf(bad));
    expect(errorsOf(bad).map((e) => e.code)).toEqual(["SCHEMA_UNKNOWN_KEY"]);
  });

  it("DBR-003 the schema is strict: unknown keys, wrong types and unknown enum values are errors, never coerced", () => {
    expect(
      errorsOf({ ...BASE, zones: [{ id: "z", ordering: "ordered", x: 1 }] }),
    ).toMatchObject([{ code: "SCHEMA_UNKNOWN_KEY", path: "zones[0].x" }]);
    expect(errorsOf({ ...BASE, seats: { count: "2" } })).toMatchObject([
      { code: "SCHEMA_TYPE", path: "seats.count" },
    ]);
    expect(
      errorsOf({ ...BASE, zones: [{ id: "z", ordering: "sorted" }] }),
    ).toMatchObject([{ code: "INVALID_VALUE", path: "zones[0].ordering" }]);
    expect(errorsOf({ ...BASE, action_schema_version: 1.5 })).toMatchObject([
      { code: "SCHEMA_TYPE", path: "action_schema_version" },
    ]);
  });

  it("DBR-004 declarations fail closed: a field without visibility, an unknown role and an owner audience on an unowned zone are errors", () => {
    const missing = errorsOf({
      ...BASE,
      cards: [
        {
          id: "c1",
          zone: "stock",
          metadata_schema: { rank: { type: "int" } },
        },
      ],
    });
    expect(missing[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      path: "cards[0].metadata_schema.rank.visibility",
    });
    const unknownRole = errorsOf({
      ...BASE,
      zones: [
        { id: "z", ordering: "ordered", visibility: { referee: "public" } },
      ],
    });
    expect(unknownRole[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      entity: "z",
    });
    const unowned = errorsOf({
      ...BASE,
      zones: [
        { id: "z", ordering: "ordered", visibility: { default: "owner" } },
      ],
    });
    expect(unowned[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      entity: "z",
    });
    // An absent block is "no declaration", not a permissive default.
    expect(compile(BASE).zones.map((z) => z.visibility)).toEqual([{}, {}]);
  });

  it("DBR-005 hook code is never executed: loading and resolving a bundle with a throwing top level runs nothing", async () => {
    const root = temp();
    const dir = join(root, "inert");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "game.yaml"),
      "id: inert\naction_schema_version: 1\nseats: { count: 2 }\nhooks:\n  module: ./hooks.ts\n  validation: { play_card: validatePlay }\n",
    );
    writeFileSync(
      join(dir, "hooks.ts"),
      'const sentinel = globalThis as Record<string, unknown>;\nsentinel["cgeBundleExecuted"] = true;\nthrow new Error("the bundle must never run");\nexport function validatePlay(): boolean {\n  return true;\n}\n',
    );
    expect((await buildHookBundle(dir)).ok).toBe(true);
    const loaded = await createFilesystemDefinitionRegistry({
      searchPaths: [root],
      limits: { cascadeCapMax: 256 },
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const id = loaded.value.definitions[0]?.definitionId as DefinitionId;
    expect((await loaded.value.registry.resolve(id)).ok).toBe(true);
    expect(
      (globalThis as Record<string, unknown>)["cgeBundleExecuted"],
    ).toBeUndefined();
  });

  it("DBR-006 engine ceilings win: a game or config value above a ceiling is rejected", () => {
    const over = errorsOf(
      {
        ...BASE,
        policies: { cascade_cap: 100, cost_budgets: { reaction: 90 } },
      },
      { limits: { cascadeCapMax: 50, costBudgetMax: 80 } },
    );
    expect(over.map((e) => [e.code, e.path])).toEqual([
      ["LIMIT_EXCEEDED", "policies.cascade_cap"],
      ["LIMIT_EXCEEDED", "policies.cost_budgets.reaction"],
    ]);
    const config = loadServerConfig(
      'auth:\n  mode: static-api-key\n  keys:\n    - id: host\n      secret: "${K}"\n      can: [admin]\nlimits:\n  cascade_cap: { default: 300, max: 256 }\n',
      { K: "k".repeat(16) },
    );
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error[0]).toMatchObject({
        code: "CONFIG_INVALID",
        path: "limits.cascade_cap.default",
      });
      expect(config.error[0]?.detail).toContain("limits.cascade_cap.max");
    }
  });

  it("DBR-007 secrets enter only through the environment and never appear in an error", () => {
    const literal = "0123456789abcdefLITERAL";
    const text = (secret: string): string =>
      `auth:\n  mode: static-api-key\n  keys:\n    - id: host\n      secret: ${secret}\n      can: [admin]\n`;
    const literalResult = loadServerConfig(text(`"${literal}"`), {});
    expect(literalResult.ok).toBe(false);
    if (!literalResult.ok) {
      expect(literalResult.error[0]).toMatchObject({
        code: "CONFIG_INVALID",
        path: "auth.keys[0].secret",
      });
      expect(JSON.stringify(literalResult.error)).not.toContain(literal);
    }
    const short = loadServerConfig(text('"${K}"'), { K: "tooshort-value" });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(JSON.stringify(short.error)).toContain("<redacted>");
      expect(JSON.stringify(short.error)).not.toContain("tooshort-value");
    }
    const mixed = loadServerConfig(text('"prefix-${K}"'), {
      K: "k".repeat(20),
    });
    expect(mixed.ok).toBe(false);
  });

  it("DBR-008 reserved names and the id charset are enforced: an engine. schema id, a slash in a template name and a space in an id are rejected", () => {
    expect(
      errorsOf({
        ...BASE,
        meta_schemas: [{ id: "engine.custom", reducer: "r" }],
        hooks: { module: "./hooks.ts" },
      }).find((e) => e.code === "RESERVED_NAME"),
    ).toMatchObject({ path: "meta_schemas[0].id", entity: "engine.custom" });
    expect(
      errorsOf({
        ...BASE,
        zones: [
          {
            template: "a/b",
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
          },
        ],
      })[0],
    ).toMatchObject({ code: "INVALID_VALUE", path: "zones[0].template" });
    expect(
      errorsOf({ ...BASE, seats: { count: 2, prefix: "Seat " } })[0],
    ).toMatchObject({ code: "INVALID_VALUE", path: "seats.prefix" });
  });

  it("DBR-009 only packages/config has runtime dependencies, exactly yaml, zod and esbuild, exactly pinned; core has none", () => {
    const read = (path: string): Record<string, unknown> =>
      JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const violations = (pkg: Record<string, unknown>): string[] => {
      const deps = (pkg["dependencies"] ?? {}) as Record<string, string>;
      const allowed = ["esbuild", "yaml", "zod"];
      const out: string[] = [];
      for (const [name, version] of Object.entries(deps)) {
        if (name === "@cge/core") {
          if (version !== "workspace:*") out.push(`${name} ${version}`);
        } else if (!allowed.includes(name)) out.push(`${name} not allowed`);
        else if (!/^\d+\.\d+\.\d+$/.test(version)) out.push(`${name} unpinned`);
      }
      for (const name of allowed) {
        if (!(name in deps)) out.push(`${name} missing`);
      }
      return out;
    };
    const config = read(join(HERE, "..", "package.json"));
    expect(violations(config)).toEqual([]);
    expect(Object.keys(config["dependencies"] as object).sort()).toEqual([
      "@cge/core",
      "esbuild",
      "yaml",
      "zod",
    ]);
    expect(read(join(CORE_SRC, "..", "package.json"))["dependencies"]).toBe(
      undefined,
    );
    // The same check flags each way a later change could break the rule.
    const deps = config["dependencies"] as Record<string, string>;
    expect(
      violations({ dependencies: { ...deps, lodash: "4.17.21" } }),
    ).toEqual(["lodash not allowed"]);
    expect(violations({ dependencies: { ...deps, yaml: "^2.9.1" } })).toEqual([
      "yaml unpinned",
    ]);
    expect(
      violations({ dependencies: { "@cge/core": "workspace:*" } }),
    ).toEqual(["esbuild missing", "yaml missing", "zod missing"]);
  });

  it("DBR-010 phase 1 stays frozen: the golden vector, golden stream and PRNG files are byte-identical", () => {
    const expected: Record<string, string> = {
      "replay/canonical/golden-vectors.json":
        "41bad9fcc9c5fc7f34607bc4457a7f6328f378c91abdd5a03025022535cfd7f8",
      "session/golden-stream.json":
        "becc83b3b346d814e6516214093e8f2b0b004007844fa53cbe9a36ae1313fe39",
      "session/prng-vectors.json":
        "c375a610aa307a074e29dfa6453a8070c7c69a38ecd382f8adbb8c0e7c5ea460",
    };
    for (const [file, digest] of Object.entries(expected)) {
      const bytes = readFileSync(join(CORE_SRC, file));
      expect(sha256(bytes), file).toBe(digest);
      // A single changed byte would be noticed.
      const tampered = Uint8Array.from(bytes);
      tampered[0] = (tampered[0] ?? 0) ^ 1;
      expect(sha256(tampered), file).not.toBe(digest);
    }
  });

  it("DBR-011 the registry is built once: a file edited after load can never produce a different definition under the old id", async () => {
    const root = temp();
    const dir = join(root, "stable");
    mkdirSync(dir);
    const yaml = (zone: string, comment = ""): string =>
      `${comment}id: stable\naction_schema_version: 1\nseats: { count: 2 }\nzones:\n  - { id: stock, ordering: ordered }\n  - { id: discard, ordering: ordered }\ncards: [{ id: c1, zone: ${zone} }]\n`;
    writeFileSync(join(dir, "game.yaml"), yaml("stock"));
    const loaded = await createFilesystemDefinitionRegistry({
      searchPaths: [root],
      limits: { cascadeCapMax: 256 },
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { registry, definitions } = loaded.value;
    const oldId = definitions[0]?.definitionId as DefinitionId;
    // A semantics-preserving edit still resolves ...
    writeFileSync(join(dir, "game.yaml"), yaml("stock", "# no change\n"));
    expect((await registry.resolve(oldId)).ok).toBe(true);
    // ... a semantic edit is a mismatch that names both ids.
    writeFileSync(join(dir, "game.yaml"), yaml("discard"));
    const result = await registry.resolve(oldId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DEFINITION_HASH_MISMATCH");
      expect(result.error.detail).toContain(oldId);
    }
  });
});
