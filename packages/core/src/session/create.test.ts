import { describe, expect, it } from "vitest";
import { buildDefinition } from "../definition/definition.testing.js";
import { assertDefinitionStructure } from "../definition/assert.js";
import { stateDigest } from "../replay/canonical/index.js";
import { createSession } from "./create.js";
import { cardId, playerId, seatId, sessionId, teamId, zoneId } from "./ids.js";
import type { SeatId, TeamId, PlayerId } from "./ids.js";
import { isDeepFrozen } from "./snapshot.testing.js";
import type { RosterEntry } from "./state.js";
import type { CompiledGameDefinition } from "../definition/types.js";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const sid = (v: string): SeatId => must(seatId(v));
const tid = (v: string): TeamId => must(teamId(v));
const pid = (v: string): PlayerId => must(playerId(v));
const session = must(sessionId("sess-1"));

const validRoster = (): RosterEntry[] => [
  { seat: sid("s1"), player: pid("p1"), team: tid("t1") },
  { seat: sid("s2"), team: tid("t2") },
];

const z = (v: string) => must(zoneId(v));

describe("VC-010 createSession initial state", () => {
  const def = buildDefinition({
    cards: Array.from({ length: 10 }, (_, i) => ({
      id: must(cardId(`k${String(i)}`)),
      metadataSchema: { rank: "int" as const },
      startingZone: z(i < 6 ? "deck" : "table"),
    })),
  });

  it("builds the specified initial state", () => {
    const r = createSession(def, session, validRoster());
    const s = must(r);
    expect(s.id).toBe(session);
    expect(s.seq).toBe(0);
    expect(s.lifecycle).toBe("active");
    expect(Object.keys(s.cards)).toHaveLength(10);
    for (const card of def.cards) {
      expect(s.cards[card.id]?.zone).toBe(card.startingZone);
      expect(s.cards[card.id]?.orientation).toBe("face_down");
      expect(s.cards[card.id]?.metadata).toEqual({});
    }
    expect(s.zones[z("deck")]?.members).toEqual(
      def.cards.slice(0, 6).map((c) => c.id),
    );
    expect(s.zones[z("table")]?.members).toHaveLength(4);
    expect(s.zones[z("discard")]?.members).toEqual([]);
    expect(s.zoneOrdinals).toEqual({});
    // stored counters at initial value; the derived one is not stored
    expect(s.counters).toEqual({ pot: 0n, bank: 100n });
    expect(s.meta).toEqual({ notes: {} });
    expect(s.roster.seats).toEqual({
      s1: { status: "seated", player: "p1", team: "t1" },
      s2: { status: "seated", team: "t2" },
    });
    expect(s.control).toEqual({
      phase: "play",
      turnOrder: ["s1", "s2"],
      activeSeats: ["s1"],
      direction: 1,
      pointers: {},
    });
    expect(s.gates).toEqual({ open: {}, resolved: {} });
    expect(s.delegations).toEqual([]);
    expect(s.grants).toEqual({});
    expect("outcome" in s).toBe(false);
  });

  it("is deep-frozen and shares nothing with the definition (VC-013 initial half)", () => {
    const s = must(createSession(def, session, validRoster()));
    expect(isDeepFrozen(s)).toBe(true);
    expect(Object.isFrozen(def.control.turnOrder)).toBe(false);
    expect(Object.isFrozen(def.control.initialActiveSeats)).toBe(false);
  });
});

describe("VC-011 roster validation", () => {
  const def = buildDefinition();
  const teamless = buildDefinition({
    seats: [{ id: sid("s1") }, { id: sid("s2"), team: tid("t2") }],
    teams: [tid("t2")],
  });
  function expectErr(
    d: CompiledGameDefinition,
    roster: RosterEntry[],
    id: string,
  ) {
    const r = createSession(d, session, roster);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("MALFORMED_ACTION");
    expect(r.error.detail).toContain(id);
    expect(r.error.actionIndex).toBeUndefined();
  }
  it("undeclared seat", () =>
    expectErr(def, [...validRoster(), { seat: sid("zz") }], "zz"));
  it("missing seat", () =>
    expectErr(def, [{ seat: sid("s1"), team: tid("t1") }], "s2"));
  it("duplicate seat", () =>
    expectErr(def, [...validRoster(), { seat: sid("s1") }], "s1"));
  it("team mismatch", () =>
    expectErr(
      def,
      [{ seat: sid("s1"), team: tid("t2") }, { seat: sid("s2") }],
      "s1",
    ));
  it("team on a seat declared without one", () =>
    expectErr(
      teamless,
      [{ seat: sid("s1"), team: tid("t1") }, { seat: sid("s2") }],
      "s1",
    ));
  it("duplicate player", () =>
    expectErr(
      def,
      [
        { seat: sid("s1"), player: pid("p1") },
        { seat: sid("s2"), player: pid("p1") },
      ],
      "p1",
    ));
  it("valid roster, with and without optional fields", () => {
    expect(createSession(def, session, validRoster()).ok).toBe(true);
    expect(
      createSession(def, session, [{ seat: sid("s2") }, { seat: sid("s1") }])
        .ok,
    ).toBe(true);
  });
});

describe("VC-054 (create half) reserved engine.* meta schema", () => {
  it("assertDefinitionStructure and createSession both fail", () => {
    const def = buildDefinition({
      metaSchemas: [{ id: "engine.custom", fields: {}, reducer: (p) => p }],
    });
    const direct = assertDefinitionStructure(def);
    expect(direct.ok).toBe(false);
    const r = createSession(def, session, validRoster());
    expect(r).toEqual(direct);
    if (!r.ok) {
      expect(r.error.code).toBe("MALFORMED_ACTION");
      expect(r.error.detail).toContain("engine.custom");
      expect(r.error.actionIndex).toBeUndefined();
    }
  });
  it("structure errors win over roster errors", () => {
    const def = buildDefinition({ viewKeys: [] });
    const r = createSession(def, session, []);
    expect(!r.ok && r.error.detail).toContain("viewKeys");
  });
});

describe("VC-014 mutation guard", () => {
  it("push, assignment and delete throw and leave the digest unchanged", () => {
    const def = buildDefinition();
    const s = must(createSession(def, session, validRoster()));
    const before = stateDigest(def, s);
    type Loose = {
      zones: Record<string, { members: string[] }>;
      counters: Record<string, bigint>;
      control: { phase: string };
      cards: Record<string, unknown>;
    };
    const m = s as unknown as Loose;
    expect(() => m.zones["deck"]?.members.push("x")).toThrow(TypeError);
    expect(() => {
      m.counters["pot"] = 5n;
    }).toThrow(TypeError);
    expect(() => {
      m.control.phase = "end";
    }).toThrow(TypeError);
    expect(() => {
      delete m.cards["c1"];
    }).toThrow(TypeError);
    expect(stateDigest(def, s)).toBe(before);
  });
});
