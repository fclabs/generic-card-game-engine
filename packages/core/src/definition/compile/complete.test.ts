import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSession } from "../../session/create.js";
import { sessionId } from "../../session/ids.js";
import { assertDefinitionStructure } from "../assert.js";
import { definitionData } from "../data.js";
import { definitionContentHash } from "../identity.js";
import { compileDefinition } from "./compile.js";
import {
  codePaths,
  deckDoc,
  doc,
  failure,
  success,
} from "./compile.testing.js";
import { FULL_BUNDLE, FULL_DEFINITION } from "./full-definition.testing.js";
import type { HookBundleInfo } from "./references.js";

const compileFull = () => {
  const r = compileDefinition(FULL_DEFINITION, { bundle: FULL_BUNDLE });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

describe("VC-210 fully populated fixture", () => {
  const def = compileFull();

  it("compiles top-level scalars, roles, seats and view keys", () => {
    expect(def.gameId).toBe("hearts");
    expect(def.schemaVersion).toBe(1);
    expect(def.roles).toEqual([{ id: "spectator", subject: "forbidden" }]);
    expect(def.seats).toEqual([
      { id: "north", team: "ns" },
      { id: "east", team: "ew" },
      { id: "south", team: "ns" },
      { id: "west", team: "ew" },
    ]);
    expect(def.teams).toEqual(["ns", "ew"]);
    expect(def.viewKeys).toEqual(["card_face", "zone_membership"]);
  });

  it("compiles zones and templates (name map of section 7.2)", () => {
    expect(def.zones).toEqual([
      { id: "stock", ordered: true, visibility: { default: "hidden" } },
      ...["north", "east", "south", "west"].map((s) => ({
        id: `hand-${s}`,
        ordered: false,
        owner: s,
        visibility: { default: "hidden", player: "owner", spectator: "public" },
      })),
    ]);
    expect(def.zoneTemplates).toEqual([
      {
        name: "meld",
        ownerRule: "team",
        ordered: true,
        maxInstances: 8,
        visibility: {},
      },
    ]);
  });

  it("compiles cards in expanded order, then the explicit card", () => {
    expect(def.cards).toHaveLength(53);
    expect(def.cards[0]).toEqual({
      id: "S1",
      type: "S",
      startingZone: "stock",
      metadataSchema: { suit: "string", rank: "int" },
      metadataVisibility: { suit: "public", rank: "public" },
      initialMetadata: { suit: "S", rank: 1 },
    });
    expect(def.cards[51]?.id).toBe("C13");
    expect(def.cards[52]).toEqual({
      id: "joker",
      metadataSchema: {},
      startingZone: "stock",
      initialMetadata: {},
      metadataVisibility: {},
    });
  });

  it("compiles counters (bigint bounds, derived spec) and groups", () => {
    const data = definitionData(def).counters;
    expect(data).toEqual([
      {
        id: "pot",
        owner: "table",
        min: 0n,
        initial: 0n,
        visibility: { default: "public" },
      },
      ...["north", "east", "south", "west"].map((s) => ({
        id: `chips-${s}`,
        owner: "player",
        ownerId: s,
        min: 0n,
        max: 10n ** 21n,
        initial: 100n,
        scale: 2,
        rounding: "half_even",
        visibility: {},
      })),
      {
        id: "bank",
        owner: "table",
        min: 0n,
        initial: 0n,
        supplyRole: "mint",
        visibility: {},
      },
      {
        id: "stock_size",
        owner: "table",
        min: 0n,
        initial: 0n,
        visibility: { default: "public" },
        derivedSpec: { kind: "zone_size", zone: "stock" },
      },
    ]);
    expect(typeof def.counters[6]?.derived).toBe("function");
    expect(def.conservationGroups).toEqual([
      {
        id: "money",
        counters: [
          "pot",
          "chips-north",
          "chips-east",
          "chips-south",
          "chips-west",
        ],
      },
    ]);
  });

  it("compiles control, meta schemas, hooks and policies", () => {
    expect(def.control).toEqual({
      phases: ["deal", "play"],
      initialPhase: "deal",
      turnOrder: ["north", "east", "south", "west"],
      initialActiveSeats: ["north"],
      pointerNames: ["button"],
      enforceActiveSeats: true,
      outOfTurnKinds: ["chat"],
    });
    expect(def.metaSchemas).toEqual([
      {
        id: "hearts.score",
        fields: { points: "int", note: "string" },
        reducerRef: "reduceScore",
        fieldVisibility: { points: "public", note: "secret" },
      },
    ]);
    expect(def.rosterReducerRef).toBe("reduceRoster");
    expect(def.hookBindings).toEqual({
      "validation:play_card": ["validatePlay"],
      "reaction:phase:play": ["onTrickComplete"],
      "reaction:trigger:setup": ["setup"],
      "gate_resolve:hearts.pass": ["resolvePass"],
      "authorization:default": ["authorize"],
    });
    expect(
      JSON.stringify(definitionData(def), (_k, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ).not.toContain("hooks.ts");
    expect(def.policies).toEqual({
      cascadeCap: 16,
      costBudgets: { validation: 500000, reaction: 2000000 },
    });
  });

  it("VC-226: satisfies assertDefinitionStructure and createSession", () => {
    expect(assertDefinitionStructure(def).ok).toBe(true);
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const r = createSession(
      def,
      sid.value,
      def.seats.map((s) => ({
        seat: s.id,
        ...(s.team === undefined ? {} : { team: s.team }),
      })),
    );
    expect(r.ok).toBe(true);
  });

  it("VC-226: a hand-built duplicate card still fails the structure check", () => {
    const first = def.cards[0];
    if (first === undefined) throw new Error("card");
    const bad = { ...def, cards: [first, first] };
    expect(assertDefinitionStructure(bad).ok).toBe(false);
  });
});

describe("VC-211 each compiler code with code, path and entity", () => {
  const bundleOf = (exports: string[]): HookBundleInfo => ({
    hash: "h",
    exports,
  });
  const fromCtx = (raw: unknown, bundle?: HookBundleInfo) => {
    const r = compileDefinition(raw, bundle === undefined ? {} : { bundle });
    if (r.ok) throw new Error("expected failure");
    return r.errors;
  };
  const reducerDoc = (extra: Record<string, unknown> = {}) =>
    doc({
      meta_schemas: [{ id: "g.s", reducer: "r1", fields: {} }],
      ...extra,
    });

  const cases: ReadonlyArray<
    [string, readonly unknown[], string, string, string | undefined]
  > = [
    [
      "SCHEMA_UNKNOWN_KEY",
      [doc({ bogus: 1 })],
      "SCHEMA_UNKNOWN_KEY",
      "bogus",
      undefined,
    ],
    [
      "SCHEMA_TYPE",
      [doc({ seats: "four" })],
      "SCHEMA_TYPE",
      "seats",
      undefined,
    ],
    [
      "SCHEMA_MISSING",
      [{ action_schema_version: 1, seats: { count: 2 } }],
      "SCHEMA_MISSING",
      "id",
      undefined,
    ],
    ["INVALID_VALUE", [doc({ id: "Hearts" })], "INVALID_VALUE", "id", "Hearts"],
    [
      "DUPLICATE_ID",
      [
        doc({
          zones: [
            { id: "a", ordering: "ordered" },
            { id: "a", ordering: "ordered" },
          ],
        }),
      ],
      "DUPLICATE_ID",
      "zones[1].id",
      "a",
    ],
    [
      "UNKNOWN_REFERENCE",
      [deckDoc({ cards: [{ id: "x", zone: "nope" }] })],
      "UNKNOWN_REFERENCE",
      "cards[0].zone",
      "x",
    ],
    [
      "INVALID_VISIBILITY",
      [
        doc({
          zones: [
            { id: "z", ordering: "ordered", visibility: { referee: "public" } },
          ],
        }),
      ],
      "INVALID_VISIBILITY",
      "zones[0].visibility.referee",
      "z",
    ],
    [
      "RESERVED_NAME",
      [
        doc({ meta_schemas: [{ id: "engine.x", reducer: "r1" }] }),
        bundleOf(["r1"]),
      ],
      "RESERVED_NAME",
      "meta_schemas[0].id",
      "engine.x",
    ],
    [
      "MISSING_REDUCER",
      [doc({ meta_schemas: [{ id: "g.s", fields: {} }] })],
      "MISSING_REDUCER",
      "meta_schemas[0].reducer",
      "g.s",
    ],
    [
      "MISSING_HOOK_MODULE",
      [reducerDoc(), bundleOf(["r1"])],
      "MISSING_HOOK_MODULE",
      "meta_schemas[0].reducer",
      "r1",
    ],
    [
      "UNKNOWN_HOOK_EXPORT",
      [reducerDoc({ hooks: { module: "./h.ts" } }), bundleOf(["other"])],
      "UNKNOWN_HOOK_EXPORT",
      "meta_schemas[0].reducer",
      "r1",
    ],
    [
      "BUNDLE_MISSING",
      [reducerDoc({ hooks: { module: "./h.ts" } })],
      "BUNDLE_MISSING",
      "hooks.module",
      undefined,
    ],
    [
      "UNSUPPORTED_SCHEMA_VERSION",
      [doc({ action_schema_version: 2 })],
      "UNSUPPORTED_SCHEMA_VERSION",
      "action_schema_version",
      undefined,
    ],
    [
      "LIMIT_EXCEEDED",
      [
        doc({
          control: {
            phases: Array.from({ length: 65 }, (_, i) => `p${i}`),
            initial_phase: "p0",
          },
        }),
      ],
      "LIMIT_EXCEEDED",
      "control.phases",
      undefined,
    ],
  ];

  it.each(cases)("%s", (_name, args, code, path, entity) => {
    const [raw, bundle] = args as [unknown, HookBundleInfo | undefined];
    const errors = fromCtx(raw, bundle);
    const hit = errors.find((e) => e.code === code);
    expect(hit, JSON.stringify(errors)).toBeDefined();
    expect(hit?.path).toBe(path);
    expect(hit?.entity).toBe(entity);
  });

  it("covers all 14 compiler codes", () => {
    expect(new Set(cases.map((c) => c[0])).size).toBe(14);
  });

  it("reports an unknown key at top level, zones[1], derived and control", () => {
    const raw = doc({
      zones: [
        { id: "a", ordering: "ordered" },
        { id: "b", ordering: "ordered", extra: 1 },
      ],
      counters: [{ id: "n", derived: { zone_size: "a", extra: 1 } }],
      control: { extra: 1 },
      top: 1,
    });
    expect(codePaths(failure(raw))).toEqual([
      ["SCHEMA_UNKNOWN_KEY", "top"],
      ["SCHEMA_UNKNOWN_KEY", "zones[1].extra"],
      ["SCHEMA_UNKNOWN_KEY", "counters[0].derived.extra"],
      ["SCHEMA_UNKNOWN_KEY", "control.extra"],
    ]);
  });

  it("collects 130 errors as exactly 100, truncated, in document order", () => {
    const zones = Array.from({ length: 130 }, (_, i) => ({ id: `z${i}` }));
    const r = compileDefinition(doc({ zones }));
    if (r.ok) throw new Error("expected failure");
    expect(r.errors).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(r.errors.map((e) => e.path)).toEqual(
      Array.from({ length: 100 }, (_, i) => `zones[${i}].ordering`),
    );
  });

  it("never throws for 1000 random values", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const r = compileDefinition(value);
        return r.ok || r.errors.length > 0;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("VC-228 canonical-profile guard (ok implies identity)", () => {
  const withMeta = (value: unknown) =>
    deckDoc({
      cards: [
        {
          id: "c",
          zone: "stock",
          metadata: { blob: value },
          metadata_schema: { blob: { type: "json", visibility: "public" } },
        },
      ],
    });
  const nested = (depth: number): unknown =>
    depth === 0 ? 1 : { a: nested(depth - 1) };

  it("rejects a float, depth 65, a lone surrogate and an unsafe integer", () => {
    expect(failure(withMeta(1.5))[0]?.code).toBe("SCHEMA_TYPE");
    expect(failure(withMeta(nested(65)))[0]?.code).toBe("INVALID_VALUE");
    expect(failure(withMeta("\ud800"))[0]?.code).toBe("INVALID_VALUE");
    expect(failure(withMeta(Number("9007199254740993")))[0]?.code).toBe(
      "INVALID_VALUE",
    );
    expect(failure(withMeta(nested(65)))[0]?.path).toContain("blob");
    expect(success(withMeta(nested(63))).cards).toHaveLength(1);
  });

  it("identity data of every ok compile canonicalises (500 runs)", () => {
    fc.assert(
      fc.property(
        fc.anything({ maxDepth: 4 }),
        fc.string({ unit: "binary" }),
        (value, text) => {
          const r = compileDefinition(
            deckDoc({
              cards: [
                {
                  id: "c",
                  zone: "stock",
                  metadata: { a: value, b: text },
                  metadata_schema: {
                    a: { type: "json", visibility: "public" },
                    b: { type: "string", visibility: "public" },
                  },
                },
              ],
            }),
          );
          if (!r.ok) return true;
          definitionContentHash(r.value);
          return true;
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("VC-229 id charset (remaining cases)", () => {
  it("rejects a phase named empty and a space in a for_each zone id", () => {
    const empty = failure(
      doc({ control: { phases: [""], initial_phase: "" } }),
    );
    expect(empty[0]?.code).toBe("INVALID_VALUE");
    expect(empty[0]?.path).toBe("control.phases[0]");
    const spaced = failure(
      doc({
        zones: [{ id: "hand {seat}", for_each: "seat", ordering: "ordered" }],
      }),
    );
    expect(spaced[0]?.code).toBe("INVALID_VALUE");
  });

  it("accepts 128-character ids with every allowed character", () => {
    const id = "A0_.:/-".repeat(19).slice(0, 128);
    expect(id).toHaveLength(128);
    const def = success(
      doc({
        control: { phases: [id], initial_phase: id },
        roles: [{ id, subject: "optional" }],
      }),
    );
    expect(def.control.phases).toEqual([id]);
  });
});
