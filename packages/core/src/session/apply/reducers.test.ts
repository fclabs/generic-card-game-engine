import { describe, expect, it } from "vitest";
import { stateDigest } from "../../replay/canonical/index.js";
import { A } from "../actions.testing.js";
import type { Action } from "../actions.js";
import type { Snapshot } from "../snapshot.js";
import { isDeepFrozen } from "../snapshot.testing.js";
import { variant } from "../state.testing.js";
import type { JsonValue, RosterState, SessionState } from "../state.js";
import { errorOf, must, startState } from "./apply.testing.js";
import { findInvariantViolation } from "./invariants.js";
import { apply } from "./index.js";
import {
  buildReducerDefinition,
  engine,
  meta,
  rosterOp,
} from "./reducers.testing.js";
import type { Reducer } from "../reducer.js";
import type { CompiledGameDefinition } from "../../definition/types.js";

const def = buildReducerDefinition();
const start = startState(def);

function run(
  state: Snapshot<SessionState>,
  batch: Action[],
  d: CompiledGameDefinition = def,
) {
  return apply(d, state, batch);
}
const next = (state: Snapshot<SessionState>, ...batch: Action[]) =>
  must(run(state, batch)).state;

/** Every top-level member of a state except the named ones is `===`. */
function sameExcept(
  a: Snapshot<SessionState>,
  b: Snapshot<SessionState>,
  ...changed: string[]
) {
  for (const key of Object.keys(a)) {
    if (key === "seq" || changed.includes(key)) continue;
    expect(b[key as keyof SessionState], key).toBe(
      a[key as keyof SessionState],
    );
  }
}

describe("VC-045 meta and roster reducers", () => {
  it("a registered meta reducer changes only its own partition", () => {
    const s = next(start, meta("notes", { text: "hello" }));
    expect(s.meta.notes).toEqual({ text: "hello" });
    expect(s.meta.score).toBe(start.meta.score);
    sameExcept(start, s, "meta");
    expect(isDeepFrozen(s)).toBe(true);
    expect(s.seq).toBe(1);
  });

  it("an unregistered schema_id is MALFORMED_ACTION at its index", () => {
    const e = errorOf(
      run(start, [A.move("c1", "deck", "table"), meta("nope", {})]),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(1);
    expect(e.path).toBe("$[1].schema_id");
    expect(e.detail).toContain("nope");
  });

  it("a definition without the reducer entry rejects the schema_id too", () => {
    const noReducer = {
      ...def,
      metaSchemas: [{ id: "notes", fields: { text: "string" as const } }],
    } as unknown as CompiledGameDefinition;
    expect(errorOf(run(start, [meta("notes", {})], noReducer)).code).toBe(
      "MALFORMED_ACTION",
    );
  });

  it("roster join (roster reducer) changes only roster", () => {
    const s = next(start, rosterOp("join", { player_id: "p2", seat_id: "s2" }));
    expect(s.roster.seats["s2" as never]).toMatchObject({ player: "p2" });
    expect(s.roster.seats["s1" as never]).toEqual(
      start.roster.seats["s1" as never],
    );
    sameExcept(start, s, "roster");
    const out = next(
      s,
      rosterOp("set_status", { seat_id: "s2", status: "sitting_out" }),
    );
    expect(out.roster.seats["s2" as never]?.status).toBe("sitting_out");
  });

  it("roster op without a roster reducer is MALFORMED_ACTION", () => {
    const { rosterReducer, ...rest } = def;
    expect(rosterReducer).toBeDefined();
    const e = errorOf(
      run(start, [rosterOp("join", { player_id: "p2", seat_id: "s2" })], rest),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.path).toBe("$[0].op");
  });

  it("passes a frozen payload: the reducer sees the action fields", () => {
    let seen: unknown;
    const d = buildReducerDefinition({
      notes: (p, payload) => {
        seen = payload;
        return p;
      },
    });
    next(startState(d), meta("notes", { text: "x" })) satisfies unknown;
    run(startState(d), [meta("notes", { text: "x" })], d);
    expect(seen).toEqual({ text: "x" });
    expect(Object.isFrozen(seen)).toBe(true);
  });
});

describe("VC-051 reducer output validation (KFR-050)", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const bad: [string, Reducer<JsonValue>, string][] = [
    ["a float", () => ({ points: 1.5 }), "score"],
    ["a function", () => ({ text: () => 1 }) as never, "notes"],
    ["a cyclic object", () => ({ data: cyclic }) as never, "blob"],
    ["undefined", () => undefined as never, "notes"],
    ["an array", () => [] as never, "notes"],
    ["an undeclared field", () => ({ text: "a", extra: 1 }), "notes"],
    ["a wrong-typed field", () => ({ text: 5 }), "notes"],
    ["a bigint", () => ({ data: 1n }) as never, "blob"],
    ["a Map", () => ({ data: new Map() }) as never, "blob"],
    [
      "a throwing getter",
      () =>
        Object.defineProperty({}, "text", {
          enumerable: true,
          get() {
            throw new Error("boom");
          },
        }),
      "notes",
    ],
  ];
  for (const [name, reducer, schema] of bad) {
    it(`returning ${name} is REDUCER_ERROR and the state is unchanged`, () => {
      const d = buildReducerDefinition({ [schema]: reducer });
      const s = startState(d);
      const before = stateDigest(d, s);
      const e = errorOf(
        run(s, [A.move("c1", "deck", "table"), meta(schema, { text: "x" })], d),
      );
      expect(e.code).toBe("REDUCER_ERROR");
      expect(e.actionIndex).toBe(1);
      expect(e.detail).toContain(schema);
      expect(stateDigest(d, s)).toBe(before);
      expect(isDeepFrozen(s)).toBe(true);
    });
  }

  it("a thrown error (and a thrown non-error) is REDUCER_ERROR", () => {
    const thrower =
      (value: unknown): Reducer<JsonValue> =>
      () => {
        throw value;
      };
    for (const value of [new Error("kaboom"), "text", 42]) {
      const d = buildReducerDefinition({ notes: thrower(value) });
      const e = errorOf(run(startState(d), [meta("notes", {})], d));
      expect(e.code).toBe("REDUCER_ERROR");
      if (value instanceof Error) expect(e.detail).toContain("kaboom");
    }
  });

  it("mutating the frozen partition or payload throws and is REDUCER_ERROR", () => {
    const d = buildReducerDefinition({
      notes: (p) => {
        (p as Record<string, JsonValue>).text = "mutated";
        return p;
      },
      score: (_p, payload) => {
        (payload as Record<string, JsonValue>).points = 9;
        return {};
      },
    });
    const s = startState(d);
    expect(errorOf(run(s, [meta("notes", {})], d)).code).toBe("REDUCER_ERROR");
    expect(errorOf(run(s, [meta("score", { points: 1 })], d)).code).toBe(
      "REDUCER_ERROR",
    );
  });

  it("KBR-010: counters mutated through a cast are REDUCER_ERROR, state unchanged", () => {
    const d = buildReducerDefinition({
      notes: (p) => {
        // reach the counters through a captured reference and a cast
        (s0.counters as Record<string, bigint>).pot = 10n ** 30n;
        return p;
      },
    });
    const s0 = startState(d);
    const before = stateDigest(d, s0);
    const e = errorOf(run(s0, [meta("notes", {})], d));
    expect(e.code).toBe("REDUCER_ERROR");
    expect(stateDigest(d, s0)).toBe(before);
    expect(s0.counters["pot" as never]).toBe(0n);
  });

  it("a roster reducer that writes counters or zones in its output is REDUCER_ERROR", () => {
    for (const extra of ["counters", "zones"]) {
      const d = buildReducerDefinition({
        roster: (roster) => ({ ...roster, [extra]: {} }),
      });
      const e = errorOf(
        run(
          startState(d),
          [rosterOp("join", { player_id: "p2", seat_id: "s2" })],
          d,
        ),
      );
      expect(e.code).toBe("REDUCER_ERROR");
      expect(e.detail).toContain(extra);
    }
  });

  it("roster output shape: undeclared seat, bad status, undeclared team, duplicate player", () => {
    const seat = (extra: Record<string, unknown>) =>
      ({
        seats: { s1: { status: "seated" }, s2: { status: "seated" }, ...extra },
      }) as never;
    const cases: [string, RosterState, string][] = [
      ["undeclared seat", seat({ s9: { status: "seated" } }), "s9"],
      ["bad status", seat({ s2: { status: "gone" } }), "gone"],
      ["undeclared team", seat({ s2: { status: "seated", team: "t9" } }), "t9"],
      [
        "duplicate player",
        seat({
          s1: { status: "seated", player: "p1" },
          s2: { status: "seated", player: "p1" },
        }),
        "p1",
      ],
    ];
    for (const [name, output, needle] of cases) {
      const d = buildReducerDefinition({ roster: () => output });
      const e = errorOf(
        run(
          startState(d),
          [rosterOp("set_status", { seat_id: "s1", status: "seated" })],
          d,
        ),
      );
      expect(e.code, name).toBe("REDUCER_ERROR");
      expect(e.detail, name).toContain(needle);
    }
  });

  it("KBR-010: a roster reducer that drops a seat the control state uses is REDUCER_ERROR", () => {
    const d = buildReducerDefinition({
      roster: (roster) =>
        ({ seats: { s2: roster.seats["s2" as never] } }) as RosterState,
    });
    const s = startState(d);
    const e = errorOf(
      run(s, [rosterOp("leave", { player_id: "p1", seat_id: "s1" })], d),
    );
    expect(e.code).toBe("REDUCER_ERROR");
    expect(e.detail).toContain("KBR-008");
    expect(e.detail).toContain("s1");
  });

  it("VC-004 reducer case: a reducer failure at input index 3 has actionIndex 3", () => {
    const d = buildReducerDefinition({
      notes: () => {
        throw new Error("no");
      },
    });
    const e = errorOf(
      run(
        startState(d),
        [
          A.move("c1", "deck", "table"),
          A.move("c2", "deck", "table"),
          A.flip("c3", "face_up"),
          meta("notes", {}),
        ],
        d,
      ),
    );
    expect(e.code).toBe("REDUCER_ERROR");
    expect(e.actionIndex).toBe(3);
  });
});

describe("KBR-010 invariant re-check (direct)", () => {
  const problem = (edit: Parameters<typeof variant>[1]) =>
    findInvariantViolation(def, variant(start, edit));

  it("accepts a valid state", () => {
    expect(findInvariantViolation(def, start)).toBeUndefined();
  });

  it("KBR-010 reports KBR-001 violations", () => {
    expect(
      problem((d) => {
        d.zones["discard" as never]?.members.push("c1" as never);
      }),
    ).toContain("KBR-001");
    expect(
      problem((d) => {
        const deck = d.zones["deck" as never];
        if (deck) deck.members.length = 0;
      }),
    ).toContain("is in no zone");
    expect(
      problem((d) => {
        const card = d.cards["c1" as never];
        if (card) card.zone = "table" as never;
      }),
    ).toContain("KBR-001");
  });

  it("KBR-010 reports KBR-006 violations", () => {
    const withHand = next(start, A.zoneCreate("hand", "s1"));
    const bad = (edit: Parameters<typeof variant>[1]) =>
      findInvariantViolation(def, variant(withHand, edit));
    expect(findInvariantViolation(def, withHand)).toBeUndefined();
    expect(
      bad((d) => {
        d.zones["pile/_/1" as never] = { template: "pile", members: [] };
        d.zones["pile/_/2" as never] = { template: "pile", members: [] };
        d.zones["pile/_/3" as never] = { template: "pile", members: [] };
        d.zones["pile/_/4" as never] = { template: "pile", members: [] };
        d.zones["pile/_/5" as never] = { template: "pile", members: [] };
      }),
    ).toContain("max_instances");
    expect(
      bad((d) => {
        d.zones["x/_/1" as never] = { template: "ghost", members: [] };
      }),
    ).toContain("ghost");
    expect(
      bad((d) => {
        const hand = d.zones["hand/s1/1" as never];
        if (hand) hand.owner = "nobody" as never;
      }),
    ).toContain("owner");
    expect(
      bad((d) => {
        d.zones["pile/_/1" as never] = {
          template: "pile",
          owner: "s1" as never,
          members: [],
        };
      }),
    ).toContain("none rule");
  });

  it("KBR-010 reports KBR-007 and KBR-008 violations and counter bounds", () => {
    const gated = next(
      start,
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "x",
        expected_seats: ["s1"],
      }),
    );
    expect(
      findInvariantViolation(
        def,
        variant(gated, (d) => {
          const gate = d.gates.open["g1" as never];
          if (gate) gate.submissions["s2" as never] = 1;
        }),
      ),
    ).toContain("KBR-007");
    expect(problem((d) => (d.control.phase = "nope"))).toContain("KBR-008");
    expect(
      problem((d) => d.control.activeSeats.push("ghost" as never)),
    ).toContain("ghost");
    expect(
      problem((d) => {
        d.control.pointers.dealer = "ghost" as never;
      }),
    ).toContain("pointer dealer");
    expect(
      problem((d) =>
        d.delegations.push({ seat: "ghost" as never, principal: "p" }),
      ),
    ).toContain("delegation");
    expect(problem((d) => (d.counters["pot" as never] = -1n))).toContain("pot");
    expect(problem((d) => (d.counters["bank" as never] = 5000n))).toContain(
      "bank",
    );
    expect(
      problem((d) => {
        Reflect.deleteProperty(d.counters, "pot");
      }),
    ).toContain("missing");
  });
});

describe("VC-052 engine.* actions (KFR-051)", () => {
  const open = (id = "g1", seats: JsonValue = ["s1", "s2"]) =>
    engine("gate_open", {
      gate_id: id,
      schema_id: "pass3",
      expected_seats: seats,
    });
  const submit = (seat: string, payload: JsonValue, id = "g1") =>
    engine("gate_submit", { gate_id: id, seat, payload });
  const gateStart = next(start, open());

  const malformed = (batch: Action[], from = start) => {
    const e = errorOf(run(from, batch));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(batch.length - 1);
    return e;
  };

  it("gate_open opens a gate with its expected seats and no submissions", () => {
    expect(gateStart.gates.open["g1" as never]).toEqual({
      schemaId: "pass3",
      expectedSeats: ["s1", "s2"],
      submissions: {},
    });
    sameExcept(start, gateStart, "gates");
    expect(gateStart.gates.resolved).toBe(start.gates.resolved);
    expect(isDeepFrozen(gateStart)).toBe(true);
  });

  it("gate_open failing paths", () => {
    malformed([open("g1"), open("g1")]); // duplicate within the batch
    malformed([open("g1", [])]);
    malformed([open("g1", ["s1", "s1"])]);
    malformed([open("g1", ["s1", "ghost"])]);
    malformed([open("g1", "s1")]);
    malformed([open("g1", [1])]);
    malformed([open("bad id")]);
    malformed([
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "",
        expected_seats: ["s1"],
      }),
    ]);
    malformed([engine("gate_open", { gate_id: "g1", schema_id: "x" })]); // missing field
    malformed([
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "x",
        expected_seats: ["s1"],
        more: 1,
      }),
    ]);
    malformed([engine("gate_open", [1])]);
    malformed([engine("gate_open", null)]);
    // duplicate against an already resolved gate
    const resolved = next(gateStart, engine("gate_resolve", { gate_id: "g1" }));
    expect(malformed([open("g1")], resolved).detail).toContain("g1");
  });

  it("gate_submit stores a sealed submission; a second submit by the seat replaces it", () => {
    const one = next(gateStart, submit("s1", { card: "c1" }));
    expect(one.gates.open["g1" as never]?.submissions).toEqual({
      s1: { card: "c1" },
    });
    const two = next(one, submit("s1", [1, 2]), submit("s2", null));
    expect(two.gates.open["g1" as never]?.submissions).toEqual({
      s1: [1, 2],
      s2: null,
    });
    expect(isDeepFrozen(two)).toBe(true);
    expect(gateStart.gates.open["g1" as never]?.submissions).toEqual({});
  });

  it("gate_retract removes the submission; absent submission or unknown gate is MALFORMED_ACTION", () => {
    const sub = next(gateStart, submit("s1", 1));
    const out = next(
      sub,
      engine("gate_retract", { gate_id: "g1", seat: "s1" }),
    );
    expect(out.gates.open["g1" as never]?.submissions).toEqual({});
    malformed(
      [engine("gate_retract", { gate_id: "g1", seat: "s1" })],
      gateStart,
    );
    malformed(
      [engine("gate_retract", { gate_id: "zz", seat: "s1" })],
      gateStart,
    );
    malformed([engine("gate_retract", { gate_id: "g1" })], gateStart);
    malformed(
      [engine("gate_retract", { gate_id: "g1", seat: "s1", payload: 1 })],
      sub,
    );
  });

  it("gate_resolve moves the gate with its submissions to resolved", () => {
    const sub = next(gateStart, submit("s2", "x"));
    const r = next(sub, engine("gate_resolve", { gate_id: "g1" }));
    expect(r.gates.open).toEqual({});
    expect(r.gates.resolved["g1" as never]).toEqual({
      schemaId: "pass3",
      expectedSeats: ["s1", "s2"],
      submissions: { s2: "x" },
    });
    malformed([engine("gate_resolve", { gate_id: "zz" })], sub);
    malformed([engine("gate_resolve", { gate_id: 7 })], sub);
    const e = errorOf(run(r, [engine("gate_resolve", { gate_id: "g1" })]));
    expect(e.code).toBe("GATE_CLOSED");
    expect(e.actionIndex).toBe(0);
  });

  it("a gate opened, submitted to and resolved inside one batch works in order", () => {
    const s = next(
      start,
      open(),
      submit("s1", 1),
      submit("s2", 2),
      engine("gate_resolve", { gate_id: "g1" }),
    );
    expect(s.gates.resolved["g1" as never]?.submissions).toEqual({
      s1: 1,
      s2: 2,
    });
  });

  it("grant_expire and grant_consume remove the named grant", () => {
    const g = A.grant(
      { kind: "card", card_id: "c1" },
      ["public"],
      "all_seated",
    );
    const granted = next(start, g, g);
    expect(Object.keys(granted.grants)).toEqual(["grant/1/0", "grant/1/1"]);
    const expired = next(
      granted,
      engine("grant_expire", { grant_id: "grant/1/0" }),
    );
    expect(Object.keys(expired.grants)).toEqual(["grant/1/1"]);
    const consumed = next(
      expired,
      engine("grant_consume", { grant_id: "grant/1/1" }),
    );
    expect(consumed.grants).toEqual({});
    for (const name of ["grant_expire", "grant_consume"]) {
      malformed([engine(name, { grant_id: "grant/9/9" })], granted);
      malformed([engine(name, {})], granted);
      malformed([engine(name, { grant_id: "grant/1/0", x: 1 })], granted);
    }
  });

  it("an unknown engine.* name is MALFORMED_ACTION", () => {
    const e = malformed([engine("nope", {})]);
    expect(e.detail).toContain("engine.nope");
    expect(e.path).toBe("$[0].schema_id");
  });

  it("engine.* takes the engine reducer even if a definition tries to register it", () => {
    const sneaky = {
      ...def,
      metaSchemas: [
        ...def.metaSchemas,
        { id: "engine.gate_open", fields: {}, reducer: () => ({}) },
      ],
    } as CompiledGameDefinition;
    const e = errorOf(run(start, [engine("gate_open", {})], sneaky));
    expect(e.detail).toContain("missing field");
  });
});

describe("VC-053 / KBR-007 gate submissions", () => {
  const open = engine("gate_open", {
    gate_id: "g1",
    schema_id: "pass3",
    expected_seats: ["s1"],
  });
  const gated = next(start, open);

  it("KBR-007: submit from a seat that is not expected is GATE_CLOSED", () => {
    const e = errorOf(
      run(gated, [
        engine("gate_submit", { gate_id: "g1", seat: "s2", payload: 1 }),
      ]),
    );
    expect(e.code).toBe("GATE_CLOSED");
    expect(e.actionIndex).toBe(0);
    expect(e.detail).toContain("s2");
    const unknownSeat = errorOf(
      run(gated, [
        engine("gate_submit", { gate_id: "g1", seat: "ghost", payload: 1 }),
      ]),
    );
    expect(unknownSeat.code).toBe("GATE_CLOSED");
  });

  it("KBR-007: submit or retract on a resolved gate is GATE_CLOSED", () => {
    const resolved = next(gated, engine("gate_resolve", { gate_id: "g1" }));
    for (const action of [
      engine("gate_submit", { gate_id: "g1", seat: "s1", payload: 1 }),
      engine("gate_retract", { gate_id: "g1", seat: "s1" }),
    ]) {
      const e = errorOf(run(resolved, [action]));
      expect(e.code).toBe("GATE_CLOSED");
      expect(e.detail).toContain("g1");
    }
    expect(resolved.gates.resolved["g1" as never]?.submissions).toEqual({});
  });

  it("KBR-007: submit to an unknown gate is MALFORMED_ACTION", () => {
    const e = errorOf(
      run(gated, [
        engine("gate_submit", { gate_id: "zz", seat: "s1", payload: 1 }),
      ]),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("zz");
  });

  it("KBR-007: a failed submit leaves the input state untouched", () => {
    const before = stateDigest(def, gated);
    errorOf(
      run(gated, [
        engine("gate_submit", { gate_id: "g1", seat: "s2", payload: 1 }),
      ]),
    );
    expect(stateDigest(def, gated)).toBe(before);
  });
});

describe("VC-056 reducer in the middle of a conservation batch", () => {
  const counter = (id: string) => ({
    id: id as never,
    owner: "table" as const,
    min: 0n,
    initial: 100n,
  });
  const cdef = {
    ...def,
    counters: [counter("a"), counter("b")],
    conservationGroups: [{ id: "pair", counters: ["a", "b"] as never[] }],
  } as CompiledGameDefinition;
  const cstart = startState(cdef);

  it("[adjust(a,-1), meta(no-op reducer), adjust(b,+1)] is ok: conservation holds at batch end", () => {
    const r = must(
      run(
        cstart,
        [A.adjust("a", -1n), meta("notes", {}), A.adjust("b", 1n)],
        cdef,
      ),
    );
    expect(r.state.counters["a" as never]).toBe(99n);
    expect(r.state.counters["b" as never]).toBe(101n);
    expect(r.committed).toHaveLength(3);
  });

  it("an imbalance that survives the batch is still COUNTER_BOUNDS at the last changing action", () => {
    const e = errorOf(
      run(
        cstart,
        [A.adjust("a", -1n), meta("notes", {}), A.flip("c1", "face_up")],
        cdef,
      ),
    );
    expect(e.code).toBe("COUNTER_BOUNDS");
    expect(e.actionIndex).toBe(0);
  });
});

describe("VC-088 housekeeping actions are applied like any logged action", () => {
  it("[engine.grant_consume, roster revoke_delegation, move] commits in order, each once", () => {
    const setup = next(
      start,
      A.grant({ kind: "zone", zone_id: "deck" }, ["public"], "all_seated"),
      A.delegate("s1", "alice"),
    );
    expect(Object.keys(setup.grants)).toEqual(["grant/1/0"]);
    const batch: Action[] = [
      engine("grant_consume", { grant_id: "grant/1/0" }),
      A.revokeDelegation("s1", "alice"),
      A.move("c1", "deck", "table"),
    ];
    const r = must(run(setup, batch));
    expect(r.committed).toEqual(batch);
    expect(r.state.grants).toEqual({});
    expect(r.state.delegations).toEqual([]);
    expect(r.state.zones["table" as never]?.members).toEqual(["c1"]);
    expect(r.state.seq).toBe(setup.seq + 1);
  });

  it("apply never generates housekeeping: a plain batch commits exactly its actions", () => {
    const granted = next(
      start,
      A.grant({ kind: "card", card_id: "c1" }, ["public"], "all_seated", {
        kind: "once",
      }),
      A.grant({ kind: "card", card_id: "c1" }, ["public"], "s1", {
        kind: "until_seq",
        n: 2,
      }),
      A.delegate("s1", "alice"),
    );
    const batch = [A.move("c1", "deck", "table"), meta("notes", { text: "x" })];
    const r = must(run(granted, batch));
    expect(r.committed).toEqual(batch);
    expect(r.state.grants).toBe(granted.grants);
    expect(r.state.delegations).toBe(granted.delegations);
  });
});
