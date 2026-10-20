import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../replay/canonical/canonicalize.js";
import { sha256Hex } from "../replay/canonical/sha256.js";
import * as root from "../index.js";
import { isDefinitionId } from "../session/ids.js";
import { compileDefinition } from "./compile/compile.js";
import { deckDoc, doc, success } from "./compile/compile.testing.js";
import {
  FULL_BUNDLE,
  FULL_DEFINITION,
} from "./compile/full-definition.testing.js";
import {
  bundleIdentitySchema,
  computeDefinitionId,
  definitionContentHash,
  hookBundleHash,
  idIdentitySchema,
} from "./identity.js";
import type { CompiledGameDefinition } from "./types.js";

type Json = Record<string, unknown>;

const fixtureUrl = (name: string) =>
  new URL(`./fixtures/${name}`, import.meta.url);
const FLOOR_PATH = fileURLToPath(fixtureUrl("floor-definition.json"));
const DIST_INDEX = fileURLToPath(
  new URL("../../dist/index.js", import.meta.url),
);

/**
 * Child-process script (ESM, run by `node --input-type=module -e`): compiles a JSON document
 * against the built package (`dist`) and prints its content hash. It lives in this test file
 * because only `*.test.ts` is exempt from the core determinism lint scope (a separate `.mjs`
 * under `packages/core` would need `node:fs` and `process`).
 */
const CHILD_SCRIPT = `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { compileDefinition, definitionContentHash } = await import(pathToFileURL(process.argv[1]).href);
const reverseKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
};
let raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (process.argv[3] === "--reverse-keys") raw = reverseKeys(raw);
const result = compileDefinition(raw);
if (!result.ok) { process.stderr.write(JSON.stringify(result.errors)); process.exit(1); }
process.stdout.write(definitionContentHash(result.value));
`;
const floorRaw = (): Json =>
  JSON.parse(readFileSync(FLOOR_PATH, "utf8")) as Json;

const clone = (v: Json): Json => structuredClone(v);
const compileFull = (raw: Json = FULL_DEFINITION): CompiledGameDefinition => {
  const r = compileDefinition(raw, { bundle: FULL_BUNDLE });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};
const hashOf = (raw: Json): string => definitionContentHash(compileFull(raw));
const reverseKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .reverse()
        .map(([k, x]) => [k, reverseKeys(x)]),
    );
  }
  return v;
};

interface Expected {
  readonly contentHashes: Readonly<Record<string, string>>;
  readonly bundles: readonly {
    text: string;
    exports: string[];
    hash: string;
  }[];
  readonly ids: Readonly<Record<string, string>>;
}
const expected = JSON.parse(
  readFileSync(fileURLToPath(fixtureUrl("../identity-expected.json")), "utf8"),
) as Expected;
const bytes = (text: string) => new TextEncoder().encode(text);

describe("VC-230 equivalent documents have equal contentHash (object form; YAML text re-asserted in iteration 7)", () => {
  const base = hashOf(FULL_DEFINITION);

  it("is stable when compiled twice in-process (DNFR-001)", () => {
    expect(hashOf(FULL_DEFINITION)).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores mapping key order at every depth", () => {
    expect(hashOf(reverseKeys(FULL_DEFINITION) as Json)).toBe(base);
  });

  it("ignores shared references (the object form of anchors and aliases)", () => {
    const shared = { suit: { type: "string", visibility: "public" } };
    const aliased = doc({
      zones: [{ id: "stock", ordering: "ordered" }],
      cards: [
        {
          id: "a",
          zone: "stock",
          metadata: { suit: "S" },
          metadata_schema: shared,
        },
        {
          id: "b",
          zone: "stock",
          metadata: { suit: "H" },
          metadata_schema: shared,
        },
      ],
    });
    const copied = doc({
      zones: [{ id: "stock", ordering: "ordered" }],
      cards: [
        {
          id: "a",
          zone: "stock",
          metadata: { suit: "S" },
          metadata_schema: { suit: { type: "string", visibility: "public" } },
        },
        {
          id: "b",
          zone: "stock",
          metadata: { suit: "H" },
          metadata_schema: { suit: { type: "string", visibility: "public" } },
        },
      ],
    });
    expect(definitionContentHash(success(aliased))).toBe(
      definitionContentHash(success(copied)),
    );
  });

  it("ignores explicit values equal to the documented defaults", () => {
    const minimal = doc();
    const explicit = doc({
      roles: [],
      zones: [],
      cards: [],
      counters: [],
      conservation_groups: [],
      meta_schemas: [],
      control: {
        phases: ["main"],
        initial_phase: "main",
        enforce_active_seats: false,
        pointers: [],
        out_of_turn: [],
      },
      view_keys: ["card_face", "zone_membership", "zone_count", "zone_order"],
      policies: { cascade_cap: 16, cost_budgets: {} },
      seats: {
        list: [
          { id: "seat1" },
          { id: "seat2" },
          { id: "seat3" },
          { id: "seat4" },
        ],
      },
    });
    expect(definitionContentHash(success(explicit))).toBe(
      definitionContentHash(success(minimal)),
    );
  });

  it("compiles in a child process (reversed key order) to the same hash", () => {
    const inProcess = definitionContentHash(success(floorRaw()));
    for (const flag of [[], ["--reverse-keys"]]) {
      const out = execFileSync(
        "node",
        [
          "--input-type=module",
          "-e",
          CHILD_SCRIPT,
          DIST_INDEX,
          FLOOR_PATH,
          ...flag,
        ],
        { encoding: "utf8" },
      );
      expect(out.trim()).toBe(inProcess);
    }
  });
});

describe("VC-231 one-field mutations change the contentHash", () => {
  const base = hashOf(FULL_DEFINITION);
  const mutations: readonly (readonly [string, (d: Json) => void])[] = [
    [
      "swap two cards",
      (d) => {
        const cards = d["cards"] as unknown[];
        [cards[0], cards[1]] = [cards[1], cards[0]];
      },
    ],
    [
      "a card's zone",
      (d) => {
        (d["zones"] as Json[]).push({ id: "other", ordering: "ordered" });
        ((d["cards"] as Json[])[1] as Json)["zone"] = "other";
      },
    ],
    [
      "a counter's max",
      (d) => {
        ((d["counters"] as Json[])[1] as Json)["max"] = "999";
      },
    ],
    [
      "a seat's team",
      (d) => {
        (((d["seats"] as Json)["list"] as Json[])[0] as Json)["team"] = "ew";
      },
    ],
    [
      "hook list order",
      (d) => {
        (d["hooks"] as Json)["authorization"] = ["setup", "authorize"];
      },
    ],
    [
      "a visibility audience",
      (d) => {
        ((d["zones"] as Json[])[0] as Json)["visibility"] = {
          default: "public",
        };
      },
    ],
    [
      "cascade_cap",
      (d) => {
        (d["policies"] as Json)["cascade_cap"] = 17;
      },
    ],
    [
      "a view_keys entry",
      (d) => {
        d["view_keys"] = ["card_face", "zone_count"];
      },
    ],
    [
      "gameId",
      (d) => {
        d["id"] = "hearts2";
      },
    ],
    [
      "a metadata value",
      (d) => {
        ((d["cards"] as Json[])[1] as Json)["metadata"] = { x: 1 };
        ((d["cards"] as Json[])[1] as Json)["metadata_schema"] = {
          x: { type: "int", visibility: "public" },
        };
      },
    ],
    [
      "a field's visibility",
      (d) => {
        const cards = d["cards"] as Json[];
        const schema = ((cards[0] as Json)["generate"] as Json)[
          "metadata_schema"
        ] as Json;
        (schema["rank"] as Json)["visibility"] = "secret";
      },
    ],
    [
      "the for_each seat count",
      (d) => {
        d["seats"] = {
          list: [
            { id: "north", team: "ns" },
            { id: "east", team: "ew" },
            { id: "south", team: "ns" },
          ],
          teams: ["ns", "ew"],
        };
        (d["control"] as Json)["turn_order"] = ["north", "east", "south"];
      },
    ],
  ];

  it.each(mutations)("%s", (_name, mutate) => {
    const d = clone(FULL_DEFINITION);
    mutate(d);
    expect(hashOf(d)).not.toBe(base);
  });

  it("all mutated hashes are distinct from each other", () => {
    const seen = new Set<string>([base]);
    for (const [, mutate] of mutations) {
      const d = clone(FULL_DEFINITION);
      mutate(d);
      seen.add(hashOf(d));
    }
    expect(seen.size).toBe(mutations.length + 1);
  });

  it("changing hooks.module between two valid paths (same bundle info) leaves it unchanged", () => {
    const d = clone(FULL_DEFINITION);
    (d["hooks"] as Json)["module"] = "./other/hooks.js";
    expect(hashOf(d)).toBe(base);
  });

  it("the bundle info hash is not part of the content hash", () => {
    const other = compileDefinition(FULL_DEFINITION, {
      bundle: { ...FULL_BUNDLE, hash: "another" },
    });
    if (!other.ok) throw new Error("compile failed");
    expect(definitionContentHash(other.value)).toBe(base);
  });
});

describe("VC-215 (hash half) axis order changes the contentHash", () => {
  it("swapping the two axis items changes the hash", () => {
    const suit = { name: "suit", values: ["S", "H", "D", "C"] };
    const rank = { name: "rank", values: { range: [1, 13] } };
    const gen = (axes: unknown[]) => ({
      generate: {
        axes,
        id: "{suit}{rank}",
        zone: "stock",
      },
    });
    const zones = [{ id: "stock", ordering: "ordered" }];
    const a = success(doc({ zones, cards: [gen([suit, rank])] }));
    const b = success(doc({ zones, cards: [gen([rank, suit])] }));
    expect(definitionContentHash(a)).not.toBe(definitionContentHash(b));
    // mapping-key order of the generator does not matter
    const c = success(
      doc({
        zones,
        cards: [
          {
            generate: { zone: "stock", id: "{suit}{rank}", axes: [suit, rank] },
          },
        ],
      }),
    );
    expect(definitionContentHash(c)).toBe(definitionContentHash(a));
    expect(definitionContentHash(success(deckDoc()))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("VC-232 committed expected values", () => {
  it("content hashes of the committed fixtures equal the expected file", () => {
    expect(hashOf(FULL_DEFINITION)).toBe(expected.contentHashes["full"]);
    expect(definitionContentHash(success(floorRaw()))).toBe(
      expected.contentHashes["floor"],
    );
  });

  it("hookBundleHash of fixed inputs equals the expected file and the spec formula", () => {
    expect(expected.bundles.length).toBeGreaterThanOrEqual(3);
    for (const b of expected.bundles) {
      expect(hookBundleHash(bytes(b.text), b.exports)).toBe(b.hash);
      const formula = sha256Hex(
        canonicalize(bundleIdentitySchema, {
          js: sha256Hex(bytes(b.text)),
          exports: [...b.exports].sort(),
        }),
      );
      expect(formula).toBe(b.hash);
    }
  });

  it("computeDefinitionId of fixed inputs equals the expected file", () => {
    const c = expected.contentHashes["full"] ?? "";
    const b = expected.bundles[0]?.hash ?? "";
    expect(computeDefinitionId(c)).toBe(expected.ids["noBundle"]);
    expect(computeDefinitionId(c, b)).toBe(expected.ids["withBundle"]);
  });

  const js = bytes("export const a = 1;\nexport const b = 2;\n");
  const names = ["a", "b"];
  const hash = hookBundleHash(js, names);

  it("one changed byte changes it", () => {
    const flipped = new Uint8Array(js);
    flipped[7] = (flipped[7] ?? 0) ^ 1;
    expect(hookBundleHash(flipped, names)).not.toBe(hash);
  });

  it("an added, removed or renamed export changes it", () => {
    expect(hookBundleHash(js, [...names, "c"])).not.toBe(hash);
    expect(hookBundleHash(js, ["a"])).not.toBe(hash);
    expect(hookBundleHash(js, ["a", "c"])).not.toBe(hash);
  });

  it("export order and duplicates in the input do not matter", () => {
    expect(hookBundleHash(js, ["b", "a"])).toBe(hash);
    expect(hookBundleHash(js, ["b", "a", "a"])).toBe(hash);
  });

  it("a property: any permutation of the exports gives the same hash", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 8 }),
        (xs) => {
          expect(hookBundleHash(js, [...xs].reverse())).toBe(
            hookBundleHash(js, xs),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("VC-233 computeDefinitionId", () => {
  const c = hashOf(FULL_DEFINITION);
  const emptyBundle = hookBundleHash(new Uint8Array(0), []);

  it("differs with and without a bundle, even an empty one", () => {
    expect(computeDefinitionId(c)).not.toBe(
      computeDefinitionId(c, emptyBundle),
    );
  });

  it("has the form sha256:<64 hex> and passes isDefinitionId", () => {
    for (const id of [
      computeDefinitionId(c),
      computeDefinitionId(c, emptyBundle),
    ]) {
      expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(id).toHaveLength(71);
      expect(isDefinitionId(id)).toBe(true);
    }
  });

  it("matches the idIdentitySchema formula", () => {
    const formula = `sha256:${sha256Hex(canonicalize(idIdentitySchema, { contentHash: c }))}`;
    expect(computeDefinitionId(c)).toBe(formula);
    const withB = `sha256:${sha256Hex(canonicalize(idIdentitySchema, { contentHash: c, bundleHash: emptyBundle }))}`;
    expect(computeDefinitionId(c, emptyBundle)).toBe(withB);
  });

  it("is stable for identical YAML plus identical bundle, different for a different bundle", () => {
    const bundleA = hookBundleHash(bytes("a"), ["x"]);
    const bundleB = hookBundleHash(bytes("b"), ["x"]);
    expect(computeDefinitionId(hashOf(FULL_DEFINITION), bundleA)).toBe(
      computeDefinitionId(c, bundleA),
    );
    expect(computeDefinitionId(c, bundleA)).not.toBe(
      computeDefinitionId(c, bundleB),
    );
  });

  it("the package root exports both definitionId (P1 validator) and computeDefinitionId", () => {
    expect(typeof root.definitionId).toBe("function");
    expect(typeof root.computeDefinitionId).toBe("function");
    expect(root.definitionId(computeDefinitionId(c)).ok).toBe(true);
    expect(root.definitionId("not an id!").ok).toBe(false);
    expect(root.definitionContentHash).toBe(definitionContentHash);
    expect(root.hookBundleHash).toBe(hookBundleHash);
  });
});

describe("VC-255 binding functions does not change identity", () => {
  it("equal contentHash and DefinitionId after binding reducers and a derived evaluator", () => {
    const def = compileFull();
    const bound: CompiledGameDefinition = {
      ...def,
      rosterReducer: (roster) => roster,
      metaSchemas: def.metaSchemas.map((m) => ({ ...m, reducer: (p) => p })),
      counters: def.counters.map((k) =>
        k.derived !== undefined ? { ...k, derived: () => 7n } : k,
      ),
    };
    expect(bound.metaSchemas[0]?.reducer).toBeTypeOf("function");
    const bundleHash = hookBundleHash(bytes("export {}"), FULL_BUNDLE.exports);
    expect(definitionContentHash(bound)).toBe(definitionContentHash(def));
    expect(computeDefinitionId(definitionContentHash(bound), bundleHash)).toBe(
      computeDefinitionId(definitionContentHash(def), bundleHash),
    );
  });
});
