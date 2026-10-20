import { describe, expect, it } from "vitest";
import { assertDefinitionStructure } from "../definition/assert.js";
import { buildDefinition } from "../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { stateDigest } from "../replay/canonical/index.js";
import { createSession } from "./create.js";
import { A } from "./actions.testing.js";
import { apply } from "./apply/index.js";
import {
  errorOf,
  must,
  defaultRoster,
  startState,
} from "./apply/apply.testing.js";
import {
  buildReducerDefinition,
  meta,
  rosterOp,
} from "./apply/reducers.testing.js";
import { seatId, sessionId } from "./ids.js";

const base = buildDefinition();
const firstCard = base.cards[0];
const firstZone = base.zones[0];
if (firstCard === undefined || firstZone === undefined)
  throw new Error("fixture");
const sess = must(sessionId("sess-1"));

describe("VC-250 initialMetadata seeding (DFR-061)", () => {
  const seeded = buildDefinition({
    cards: [
      { ...firstCard, initialMetadata: { suit: "S", rank: 1 } },
      ...base.cards.slice(1),
    ],
  });

  it("seeds cards[c].metadata from initialMetadata; absent gives {}", () => {
    const s = must(createSession(seeded, sess, defaultRoster()));
    expect(s.cards[firstCard.id]?.metadata).toEqual({ suit: "S", rank: 1 });
    const other = base.cards[1];
    if (other === undefined) throw new Error("fixture");
    expect(s.cards[other.id]?.metadata).toEqual({});
  });

  it("does not share the declaration's object with the state", () => {
    const s = must(createSession(seeded, sess, defaultRoster()));
    expect(s.cards[firstCard.id]?.metadata).not.toBe(
      seeded.cards[0]?.initialMetadata,
    );
  });

  it("an undeclared initialMetadata field names card and field", () => {
    const bad = buildDefinition({
      cards: [{ ...firstCard, initialMetadata: { color: "red" } }],
    });
    const r = assertDefinitionStructure(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MALFORMED_ACTION");
      expect(r.error.detail).toContain("card c1");
      expect(r.error.detail).toContain("color");
    }
    expect(createSession(bad, sess, defaultRoster())).toEqual(r);
  });

  it("a wrong-typed initialMetadata field names card and field", () => {
    const bad = buildDefinition({
      cards: [{ ...firstCard, initialMetadata: { rank: "x" } }],
    });
    const r = assertDefinitionStructure(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.detail).toContain("card c1");
      expect(r.error.detail).toContain("rank");
      expect(r.error.detail).toContain("int");
    }
  });

  it("json fields accept any JSON value", () => {
    const def = buildDefinition({
      cards: [
        {
          ...firstCard,
          metadataSchema: { blob: "json", flag: "bool" },
          initialMetadata: { blob: { a: [1, null] }, flag: true },
        },
      ],
    });
    expect(assertDefinitionStructure(def).ok).toBe(true);
  });

  it("set_metadata afterwards behaves as VC-034", () => {
    const s0 = startState(seeded);
    const out = must(apply(seeded, s0, [A.setMetadata("c1", { rank: 9 })]));
    expect(out.state.cards[firstCard.id]?.metadata).toEqual({
      suit: "S",
      rank: 9,
    });
    const e = errorOf(apply(seeded, s0, [A.setMetadata("c1", { nope: 1 })]));
    expect(e.code).toBe("MALFORMED_ACTION");
  });
});

describe("VC-251 zone owner seeding (DFR-062)", () => {
  const north = must(seatId("s1"));
  const owned = buildDefinition({
    zones: [{ ...firstZone, owner: north }, ...base.zones.slice(1)],
  });

  it("seeds zones[z].owner and leaves no owner key when absent", () => {
    const s = must(createSession(owned, sess, defaultRoster()));
    expect(s.zones[firstZone.id]?.owner).toBe("s1");
    const second = base.zones[1];
    if (second === undefined) throw new Error("fixture");
    const z = s.zones[second.id];
    expect(z).toBeDefined();
    expect(z !== undefined && "owner" in z).toBe(false);
  });

  it("stateDigest is unchanged for definitions without owners", () => {
    const s = startState(base);
    const again = startState(buildDefinition());
    expect(stateDigest(base, s)).toBe(stateDigest(base, again));
    for (const z of Object.values(s.zones)) expect("owner" in z).toBe(false);
  });

  it("an owner changes the digest of the seeded state", () => {
    const withOwner = startState(owned);
    expect(stateDigest(owned, withOwner)).not.toBe(
      stateDigest(base, startState(base)),
    );
  });
});

describe("VC-252 reducer references (DFR-064, DFR-065)", () => {
  const bound = buildReducerDefinition();
  const schema = bound.metaSchemas[0];
  if (schema === undefined) throw new Error("fixture");
  const { reducer, ...unboundSchema } = schema;
  expect(reducer).toBeDefined();
  const unbound: CompiledGameDefinition = {
    ...bound,
    metaSchemas: [unboundSchema, ...bound.metaSchemas.slice(1)],
  };

  it("assertDefinitionStructure accepts a reference with no bound function", () => {
    expect(assertDefinitionStructure(unbound).ok).toBe(true);
  });

  it("assertDefinitionStructure rejects a missing or empty reducerRef", () => {
    for (const reducerRef of ["", undefined as unknown as string]) {
      const bad: CompiledGameDefinition = {
        ...bound,
        metaSchemas: [{ ...unboundSchema, reducerRef }],
      };
      const r = assertDefinitionStructure(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.detail).toBe(
          `meta schema ${schema.id} has no reducer reference`,
        );
      }
    }
  });

  it("meta action: unbound is REDUCER_ERROR", () => {
    const s0 = startState(unbound);
    const e = errorOf(apply(unbound, s0, [meta(schema.id, { text: "x" })]));
    expect(e.code).toBe("REDUCER_ERROR");
    expect(e.detail).toBe(`reducer not bound: ${schema.reducerRef}`);
  });

  it("meta action: bound applies", () => {
    const s0 = startState(bound);
    const out = must(apply(bound, s0, [meta(schema.id, { text: "x" })]));
    expect(out.state.meta[schema.id]).toEqual({ text: "x" });
  });

  it("meta action: an undeclared schema_id is MALFORMED_ACTION", () => {
    const e = errorOf(apply(unbound, startState(unbound), [meta("nope", {})]));
    expect(e.code).toBe("MALFORMED_ACTION");
  });

  const join = rosterOp("join", { player_id: "p2", seat_id: "s2" });

  it("roster action: reference present, no function is REDUCER_ERROR", () => {
    const { rosterReducer, ...rest } = bound;
    expect(rosterReducer).toBeDefined();
    const e = errorOf(apply(rest, startState(bound), [join]));
    expect(e.code).toBe("REDUCER_ERROR");
    expect(e.detail).toBe(`reducer not bound: ${bound.rosterReducerRef}`);
  });

  it("roster action: function bound applies", () => {
    const out = must(apply(bound, startState(bound), [join]));
    expect(out.state.roster.seats["s2" as never]).toMatchObject({
      player: "p2",
    });
  });

  it("roster action: no reference and no function is MALFORMED_ACTION", () => {
    const { rosterReducer, rosterReducerRef, ...rest } = bound;
    expect(rosterReducer).toBeDefined();
    expect(rosterReducerRef).toBeDefined();
    const e = errorOf(apply(rest, startState(bound), [join]));
    expect(e.code).toBe("MALFORMED_ACTION");
  });

  it("engine.custom is still rejected", () => {
    const bad = buildDefinition({
      metaSchemas: [
        {
          id: "engine.custom",
          fields: {},
          reducerRef: "r",
          fieldVisibility: {},
          reducer: (p) => p,
        },
      ],
    });
    expect(assertDefinitionStructure(bad).ok).toBe(false);
  });
});
