import { describe, expect, expectTypeOf, it } from "vitest";
import { assertDefinitionStructure } from "./assert.js";
import { definitionData } from "./data.js";
import { buildDefinition, buildFloorDefinition } from "./definition.testing.js";
import type { CompiledGameDefinition } from "./types.js";
import { counterId, seatId, teamId, zoneId } from "../session/ids.js";
import type { CardId, ZoneId } from "../session/ids.js";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error("unexpected err");
  return r.value;
}

function detailOf(def: CompiledGameDefinition): string | undefined {
  const r = assertDefinitionStructure(def);
  return r.ok ? undefined : r.error.detail;
}

const base = buildDefinition();
const firstCard = base.cards[0];
if (firstCard === undefined) throw new Error("fixture");

describe("assertDefinitionStructure (VC-083)", () => {
  it("accepts valid fixtures", () => {
    expect(assertDefinitionStructure(base).ok).toBe(true);
    expect(assertDefinitionStructure(buildFloorDefinition()).ok).toBe(true);
  });

  const sid = (v: string) => must(seatId(v));
  const cases: [string, CompiledGameDefinition, string][] = [
    [
      "duplicate card id",
      buildDefinition({ cards: [...base.cards, firstCard] }),
      "duplicate card id: c1",
    ],
    [
      "missing starting zone",
      buildDefinition({
        cards: [{ ...firstCard, startingZone: undefined as unknown as ZoneId }],
      }),
      "card c1 has no starting zone",
    ],
    [
      "unknown starting zone",
      buildDefinition({
        cards: [{ ...firstCard, startingZone: must(zoneId("nowhere")) }],
      }),
      "card c1 starts in unknown zone: nowhere",
    ],
    [
      "duplicate zone id",
      buildDefinition({ zones: [...base.zones, ...base.zones.slice(0, 1)] }),
      "duplicate zone id: deck",
    ],
    [
      "duplicate counter id",
      buildDefinition({
        counters: [...base.counters, ...base.counters.slice(0, 1)],
      }),
      "duplicate counter id: pot",
    ],
    [
      "duplicate seat id",
      buildDefinition({ seats: [...base.seats, ...base.seats.slice(0, 1)] }),
      "duplicate seat id: s1",
    ],
    [
      "conservation group unknown counter",
      buildDefinition({
        conservationGroups: [{ id: "g", counters: [must(counterId("ghost"))] }],
      }),
      "conservation group g names unknown counter: ghost",
    ],
    [
      "conservation group derived counter",
      buildDefinition({
        conservationGroups: [{ id: "g", counters: [must(counterId("total"))] }],
      }),
      "conservation group g names derived counter: total",
    ],
    [
      "initial below min",
      buildDefinition({
        counters: [
          { id: must(counterId("x")), owner: "table", min: 0n, initial: -1n },
        ],
        conservationGroups: [],
      }),
      "counter x initial -1 is outside its bounds",
    ],
    [
      "initial above max",
      buildDefinition({
        counters: [
          {
            id: must(counterId("x")),
            owner: "table",
            min: 0n,
            max: 5n,
            initial: 6n,
          },
        ],
        conservationGroups: [],
      }),
      "counter x initial 6 is outside its bounds",
    ],
    [
      "meta schema without reducer",
      buildDefinition({ metaSchemas: [{ id: "notes", fields: {} }] }),
      "meta schema notes has no reducer",
    ],
    [
      "reserved engine. meta schema (VC-054)",
      buildDefinition({
        metaSchemas: [{ id: "engine.custom", fields: {}, reducer: (p) => p }],
      }),
      "meta schema engine.custom uses the reserved engine. namespace",
    ],
    [
      "template name with slash",
      buildDefinition({
        zoneTemplates: [
          { name: "a/b", ownerRule: "none", ordered: true, maxInstances: 1 },
        ],
      }),
      "zone template a/b contains",
    ],
    [
      "template name over 48 chars",
      buildDefinition({
        zoneTemplates: [
          {
            name: "x".repeat(49),
            ownerRule: "none",
            ordered: true,
            maxInstances: 1,
          },
        ],
      }),
      "exceeds 48 characters",
    ],
    [
      "turn order omits a seat",
      buildDefinition({
        control: { ...base.control, turnOrder: [sid("s1")] },
      }),
      "turn order omits seat: s2",
    ],
    [
      "turn order names undeclared seat",
      buildDefinition({
        control: {
          ...base.control,
          turnOrder: [sid("s1"), sid("s2"), sid("s9")],
        },
      }),
      "turn order names undeclared seat: s9",
    ],
    [
      "turn order repeats a seat",
      buildDefinition({
        control: { ...base.control, turnOrder: [sid("s1"), sid("s1")] },
      }),
      "turn order repeats seat: s1",
    ],
    [
      "initial phase outside set",
      buildDefinition({ control: { ...base.control, initialPhase: "bogus" } }),
      "initial phase bogus is not in the phase set",
    ],
    [
      "undeclared initial active seat",
      buildDefinition({
        control: { ...base.control, initialActiveSeats: [sid("s7")] },
      }),
      "initial active seat is not declared: s7",
    ],
    [
      "seat with undeclared team",
      buildDefinition({
        seats: [
          { id: sid("s1"), team: must(teamId("tx")) },
          ...base.seats.slice(1),
        ],
      }),
      "seat s1 names undeclared team: tx",
    ],
    ["empty viewKeys", buildDefinition({ viewKeys: [] }), "viewKeys is empty"],
    [
      "empty viewKeys entry",
      buildDefinition({ viewKeys: ["a", ""] }),
      "empty entry",
    ],
    [
      "duplicate viewKeys entry",
      buildDefinition({ viewKeys: ["a", "b", "a"] }),
      "duplicate viewKeys entry: a",
    ],
  ];

  it.each(cases)("rejects %s", (_name, def, fragment) => {
    const r = assertDefinitionStructure(def);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MALFORMED_ACTION");
      expect(r.error.actionIndex).toBeUndefined();
      expect(r.error.detail).toContain(fragment);
    }
  });

  it("returns the first violation in KFR-101 order", () => {
    const def = buildDefinition({
      viewKeys: [],
      cards: [...base.cards, firstCard],
    });
    expect(detailOf(def)).toBe("duplicate card id: c1");
  });
});

describe("definition shape (VC-089, shape half)", () => {
  it("uses every KFR-100 component", () => {
    expect(base.counters.some((c) => c.derived !== undefined)).toBe(true);
    expect(base.counters.some((c) => c.supplyRole !== undefined)).toBe(true);
    expect(base.metaSchemas.every((m) => typeof m.reducer === "function")).toBe(
      true,
    );
    expect(typeof base.rosterReducer).toBe("function");
    expect(Object.keys(base.hookBindings).length).toBeGreaterThan(0);
    expect(base.control.pointerNames.length).toBeGreaterThan(0);
    expect(base.policies.cascadeCap).toBe(16);
    expectTypeOf(base.cards[0]?.id).toEqualTypeOf<CardId | undefined>();
  });

  it("definitionData strips exactly the function-valued members", () => {
    const data = definitionData(base);
    const seen = new Set<unknown>();
    const walk = (v: unknown): void => {
      expect(typeof v).not.toBe("function");
      expect(v).not.toBeUndefined();
      if (typeof v === "object" && v !== null && !seen.has(v)) {
        seen.add(v);
        Object.values(v).forEach(walk);
      }
    };
    walk(data);
    expect(data.counters.map((c) => c.derived)).toEqual([false, false, true]);
    expect(data.metaSchemas[0]?.hasReducer).toBe(true);
    expect(data.hasRosterReducer).toBe(true);
    const { rosterReducer, ...noRoster } = base;
    expect(typeof rosterReducer).toBe("function");
    expect(definitionData(noRoster).hasRosterReducer).toBe(false);
  });
});

describe("buildFloorDefinition (KFR-102)", () => {
  it("has 14 seats, 4 teams, 700 cards, 64 zones", () => {
    const def = buildFloorDefinition();
    expect(def.seats).toHaveLength(14);
    expect(def.teams).toHaveLength(4);
    expect(def.cards).toHaveLength(700);
    expect(def.zones).toHaveLength(64);
    expect(assertDefinitionStructure(def).ok).toBe(true);
  });
});
