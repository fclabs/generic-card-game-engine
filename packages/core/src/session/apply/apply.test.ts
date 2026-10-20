import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildDefinition,
  buildFloorDefinition,
} from "../../definition/definition.testing.js";
import { stateDigest } from "../../replay/canonical/index.js";
import { SAMPLES, A, actionsText } from "../actions.testing.js";
import type { Action, Macro } from "../actions.js";
import { cardId, seatId, zoneId } from "../ids.js";
import type { SeatId } from "../ids.js";
import type { Snapshot } from "../snapshot.js";
import { isDeepFrozen } from "../snapshot.testing.js";
import type { SessionState } from "../state.js";
import { variant } from "../state.testing.js";
import { apply } from "./index.js";
import type { ApplyOptions } from "./index.js";
import { errorOf, must, startState } from "./apply.testing.js";
import { structuralProblems } from "./invariants.testing.js";

const def = buildDefinition();
const start = startState(def);
const s1: SeatId = must(seatId("s1"));
const s2: SeatId = must(seatId("s2"));

function run(
  state: Snapshot<SessionState>,
  batch: readonly (Action | Macro)[],
  opts?: ApplyOptions,
) {
  return apply(def, state, batch, opts);
}

describe("VC-004 (first cases) error index and detail", () => {
  it("[move(valid), move(card not in zone)] -> CARD_NOT_IN_ZONE at index 1 naming the card", () => {
    const e = errorOf(
      run(start, [
        A.move("c1", "deck", "table"),
        A.move("c2", "discard", "table"),
      ]),
    );
    expect(e.code).toBe("CARD_NOT_IN_ZONE");
    expect(e.actionIndex).toBe(1);
    expect(e.detail).toContain("c2");
  });

  it("malformed actions carry the input index and a $[i] path", () => {
    const e = errorOf(
      run(start, [
        A.move("c1", "deck", "table"),
        { kind: "flip", card_id: "c1" } as never,
      ]),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(1);
    expect(e.path).toBe("$[1].orientation");
  });

  it("whole-batch shape validation comes before any state work", () => {
    // action 0 would fail with CARD_NOT_IN_ZONE, but action 1 is malformed and is reported first
    const e = errorOf(
      run(start, [A.move("c1", "discard", "table"), { kind: "nope" } as never]),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(1);
  });

  it("a non-array batch is malformed", () => {
    for (const batch of [null, undefined, {}, "x", 1]) {
      expect(errorOf(apply(def, start, batch as never)).code).toBe(
        "MALFORMED_ACTION",
      );
    }
  });
});

describe("VC-005 fuzz: malformed input never throws", () => {
  const corrupt = fc.tuple(
    fc.constantFrom(...SAMPLES),
    fc.nat(5),
    fc.constantFrom<unknown>(
      1.5,
      NaN,
      Symbol("s"),
      () => 1,
      undefined,
      {},
      [],
      null,
      "bad id",
      -1,
      2n ** 70n,
    ),
    fc.nat(40),
  );

  it("1000 corrupted actions -> Err", () => {
    fc.assert(
      fc.property(corrupt, ([sample, mode, junk, pick]) => {
        const keys = Object.keys(sample).filter((k) => k !== "kind");
        let raw: unknown;
        if (mode === 0) raw = { ...sample, kind: junk };
        else if (mode === 1)
          raw = { ...sample, [`extra${String(pick)}`]: junk };
        else if (mode === 2) {
          raw = { ...sample, kind: "zz_unknown" };
        } else if (mode === 3) {
          // a value that no field accepts (symbols and functions are not data)
          const key = keys[pick % keys.length] ?? "kind";
          raw = { ...sample, [key]: pick % 2 === 0 ? Symbol("bad") : () => 1 };
        } else if (mode === 4) raw = junk;
        else raw = [sample];
        const r = apply(def, start, [raw as never]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code === "MALFORMED_ACTION").toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("arbitrary junk values -> Err, never an exception", () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        const r = apply(def, start, [junk as never]);
        expect(r.ok).toBe(false);
      }),
      { numRuns: 1000 },
    );
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        expect(apply(def, start, junk as never).ok).toBe(
          junk instanceof Array && junk.length === 0,
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe("VC-013 post-apply freeze walk", () => {
  it("everything reachable from the new state, the result and the committed actions is frozen", () => {
    const r = must(
      run(start, [
        A.setMetadata("c1", { rank: 4, suit: "x" }),
        A.move("c1", "deck", "table"),
        A.shuffle("deck", ["c6", "c5", "c4", "c3", "c2"]),
        A.lifecycle("completed", { scores: { s1: [1, 2], s2: [3] } }),
      ]),
    );
    expect(isDeepFrozen(r.state)).toBe(true);
    expect(isDeepFrozen(r.committed)).toBe(true);
    expect(isDeepFrozen(r.notifications)).toBe(true);
    expect(Object.isFrozen(r)).toBe(true);
    expect(isDeepFrozen(r.state.cards["c1" as never]?.metadata)).toBe(true);
    expect(isDeepFrozen(r.state.outcome)).toBe(true);
  });

  it("the caller's own action objects are never frozen or retained", () => {
    const action = A.setMetadata("c1", { rank: 4 });
    const fields = action.fields;
    const r = must(run(start, [action]));
    expect(Object.isFrozen(action)).toBe(false);
    expect(Object.isFrozen(fields)).toBe(false);
    expect(r.committed[0]).not.toBe(action);
  });

  it("the input state stays frozen and unchanged", () => {
    const before = stateDigest(def, start);
    run(start, [A.move("c1", "deck", "table")]);
    expect(isDeepFrozen(start)).toBe(true);
    expect(stateDigest(def, start)).toBe(before);
  });
});

describe("VC-015 structural sharing at the floor", () => {
  const floor = buildFloorDefinition();
  const roster = floor.seats.map((s) => ({
    seat: s.id,
    ...(s.team !== undefined ? { team: s.team } : {}),
  }));
  const big = startState(floor, roster);
  const zoneIds = floor.zones.map((z) => z.id);

  it("one move leaves 62 zones, the counters record and the rest `===`", () => {
    const r = must(
      apply(floor, big, [A.move("card-000", "zone-00", "zone-01")]),
    );
    const after = r.state;
    const changed = zoneIds.filter((z) => after.zones[z] !== big.zones[z]);
    expect(changed.sort()).toEqual(["zone-00", "zone-01"]);
    expect(zoneIds.filter((z) => after.zones[z] === big.zones[z])).toHaveLength(
      62,
    );
    expect(after.counters).toBe(big.counters);
    expect(after.meta).toBe(big.meta);
    expect(after.roster).toBe(big.roster);
    expect(after.control).toBe(big.control);
    expect(after.gates).toBe(big.gates);
    expect(after.delegations).toBe(big.delegations);
    expect(after.grants).toBe(big.grants);
    expect(after.zoneOrdinals).toBe(big.zoneOrdinals);
    expect(after.zones).not.toBe(big.zones);
    expect(after.cards).not.toBe(big.cards);
    const movedCards = Object.keys(big.cards).filter(
      (c) => after.cards[c as never] !== big.cards[c as never],
    );
    expect(movedCards).toEqual(["card-000"]);
    expect(isDeepFrozen(after)).toBe(true);
    expect(structuralProblems(after)).toEqual([]);
  });

  it("a 20-move batch confined to 4 zones leaves 60 zones `===`", () => {
    const four = ["zone-00", "zone-01", "zone-02", "zone-03"];
    const sim = new Map<string, string[]>(
      four.map((z) => [z, [...(big.zones[must(zoneId(z))]?.members ?? [])]]),
    );
    const ordered = new Set(["zone-00", "zone-02"]);
    const batch: Action[] = [];
    for (let j = 0; j < 20; j++) {
      const src = four[j % 4] ?? "";
      const dst = four[(j + 1) % 4] ?? "";
      const card = sim.get(src)?.shift() ?? "";
      const to = sim.get(dst) ?? [];
      batch.push(A.move(card, src, dst, ordered.has(dst) ? 0 : undefined));
      if (ordered.has(dst)) to.unshift(card);
      else to.push(card);
    }
    const r = must(apply(floor, big, batch));
    const after = r.state;
    expect(r.committed).toHaveLength(20);
    expect(zoneIds.filter((z) => after.zones[z] === big.zones[z])).toHaveLength(
      60,
    );
    for (const z of four)
      expect(after.zones[must(zoneId(z))]).not.toBe(big.zones[must(zoneId(z))]);
    expect(after.counters).toBe(big.counters);
    const touched = Object.keys(big.cards).filter(
      (c) => after.cards[c as never] !== big.cards[c as never],
    );
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.length).toBeLessThanOrEqual(20);
    expect(
      Object.keys(big.cards).length - touched.length,
    ).toBeGreaterThanOrEqual(680);
    expect(structuralProblems(after)).toEqual([]);
    for (const z of four) {
      expect(after.zones[must(zoneId(z))]?.members).toEqual(sim.get(z));
    }
  });
});

describe("VC-020 / VC-021 purity of the call", () => {
  it("returns a plain value, not a promise; apply is not async", () => {
    const r = run(start, [A.move("c1", "deck", "table")]);
    expect(typeof (r as unknown as { then?: unknown }).then).not.toBe(
      "function",
    );
    expect(apply.constructor.name).not.toBe("AsyncFunction");
  });

  it("succeeds with Date, Math.random and performance.now replaced by throwing stubs", () => {
    const boom = () => {
      throw new Error("forbidden in apply");
    };
    const realNow = Date.now;
    const realRandom = Math.random;
    const realPerf = performance.now.bind(performance);
    const realDate = globalThis.Date;
    Date.now = boom;
    Math.random = boom;
    performance.now = boom;
    globalThis.Date = new Proxy(realDate, { construct: boom });
    try {
      const r = run(start, [
        A.move("c1", "deck", "table"),
        A.flip("c1", "face_up"),
      ]);
      expect(r.ok).toBe(true);
    } finally {
      globalThis.Date = realDate;
      Date.now = realNow;
      Math.random = realRandom;
      performance.now = realPerf;
    }
  });
});

describe("VC-023 / VC-024 commit and empty batches", () => {
  it("3 actions: seq n -> n+1, committed in order", () => {
    const batch = [
      A.move("c1", "deck", "table"),
      A.flip("c1", "face_up"),
      A.move("c2", "deck", "discard", 0),
    ];
    const first = must(run(start, batch));
    expect(first.state.seq).toBe(1);
    expect(first.committed).toEqual(batch);
    const second = must(run(first.state, [A.flip("c3", "face_up")]));
    expect(second.state.seq).toBe(2);
    const seqN = variant(start, (d) => {
      d.seq = 41 as never;
    });
    expect(must(run(seqN, batch)).state.seq).toBe(42);
  });

  it("[] returns the same state reference, commits nothing, keeps seq", () => {
    const r = must(run(start, []));
    expect(r.state).toBe(start);
    expect(r.committed).toEqual([]);
    expect(r.notifications).toEqual([]);
    expect(r.state.seq).toBe(0);
  });

  it("seq past the safe range is a precondition violation (throws)", () => {
    const edge = variant(start, (d) => {
      d.seq = Number.MAX_SAFE_INTEGER as never;
    });
    expect(() => run(edge, [A.flip("c1", "face_up")])).toThrow(RangeError);
  });
});

describe("VC-025 same stream twice", () => {
  const stream: (readonly (Action | Macro)[])[] = [
    [A.move("c1", "deck", "discard", 0), A.move("c2", "deck", "table")],
    [A.flip("c1", "face_up"), A.setMetadata("c1", { rank: 9, suit: "s" })],
    [A.shuffle("deck", ["c6", "c4", "c3", "c5"])],
    [],
    [A.move("c1", "discard", "deck", 2), A.flip("c2", "face_up")],
    [A.lifecycle("completed", { winner: "s2" })],
    [A.lifecycle("terminated")],
  ];

  function play() {
    const trace: { committed: string; digest: string; seq: number }[] = [];
    let state = startState(def);
    trace.push({
      committed: "",
      digest: stateDigest(def, state),
      seq: state.seq,
    });
    for (const batch of stream) {
      const r = must(apply(def, state, batch));
      state = r.state;
      trace.push({
        committed: actionsText(r.committed),
        digest: stateDigest(def, state),
        seq: state.seq,
      });
    }
    return trace;
  }

  it("identical committed actions and digests after every step", () => {
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(new Set(a.map((t) => t.digest)).size).toBeGreaterThan(5);
    expect(a.map((t) => t.seq)).toEqual([0, 1, 2, 3, 3, 4, 5, 6]);
  });
});

describe("VC-027 turn enforcement", () => {
  const move = [A.move("c1", "deck", "table")];
  const player = (seat: SeatId | undefined, kind = "move"): ApplyOptions => ({
    proposal: {
      origin: "player",
      kind,
      ...(seat !== undefined ? { actingSeat: seat } : {}),
    },
  });

  it("a player outside active_seats -> NOT_YOUR_TURN at index 0", () => {
    const e = errorOf(run(start, move, player(s2)));
    expect(e.code).toBe("NOT_YOUR_TURN");
    expect(e.actionIndex).toBe(0);
    expect(e.detail).toContain("s2");
  });

  it("a player in active_seats is admitted", () => {
    expect(run(start, move, player(s1)).ok).toBe(true);
  });

  it("an out-of-turn kind, a dealer/control/system origin and no descriptor are admitted", () => {
    expect(run(start, move, player(s2, "chat")).ok).toBe(true);
    for (const origin of ["dealer", "control", "system"] as const) {
      expect(
        run(start, move, { proposal: { origin, kind: "move", actingSeat: s2 } })
          .ok,
      ).toBe(true);
    }
    expect(run(start, move).ok).toBe(true);
    expect(run(start, move, {}).ok).toBe(true);
  });

  it("a player proposal with no actingSeat -> NOT_YOUR_TURN while enforced (D-015)", () => {
    expect(errorOf(run(start, move, player(undefined))).code).toBe(
      "NOT_YOUR_TURN",
    );
    // ...but not when active seats are not enforced
    const lax = buildDefinition({
      control: { ...def.control, enforceActiveSeats: false },
    });
    expect(apply(lax, startState(lax), move, player(undefined)).ok).toBe(true);
    expect(apply(lax, startState(lax), move, player(s2)).ok).toBe(true);
  });

  it("is judged on the input state: an active player changing active_seats is admitted", () => {
    const result = must(
      run(start, [A.controlSet({ activeSeats: ["s2"] })], player(s1)),
    );
    expect(result.state.control.activeSeats).toEqual([s2]);
    // the next batch is judged on the new state: s1 is no longer active
    expect(
      errorOf(run(result.state, [A.controlSet({ phase: "end" })], player(s1)))
        .code,
    ).toBe("NOT_YOUR_TURN");
  });

  it("turn admission runs before shape validation", () => {
    const e = errorOf(run(start, [{ kind: "nope" } as never], player(s2)));
    expect(e.code).toBe("NOT_YOUR_TURN");
  });

  it("opts differing only in proposal may differ; equal opts give identical results", () => {
    const a = run(start, move, player(s2));
    const b = run(start, move);
    expect(a.ok).not.toBe(b.ok);
    const x = must(run(start, move, player(s1)));
    const y = must(run(start, move, player(s1)));
    expect(stateDigest(def, x.state)).toBe(stateDigest(def, y.state));
    expect(actionsText(x.committed)).toBe(actionsText(y.committed));
  });
});

describe("VC-028 SessionEnded notifications", () => {
  it("one per lifecycle transition, with the action's outcome", () => {
    const done = must(run(start, [A.lifecycle("completed", { winner: "s1" })]));
    expect(done.notifications).toEqual([
      { to: "completed", outcome: { winner: "s1" } },
    ]);
    const ended = must(run(done.state, [A.lifecycle("terminated")]));
    expect(ended.notifications).toEqual([{ to: "terminated" }]);
    expect("outcome" in (ended.notifications[0] ?? {})).toBe(false);
    const direct = must(run(start, [A.lifecycle("terminated", 7)]));
    expect(direct.notifications).toEqual([{ to: "terminated", outcome: 7 }]);
  });

  it("none without a lifecycle action", () => {
    expect(
      must(run(start, [A.move("c1", "deck", "table")])).notifications,
    ).toEqual([]);
  });
});

describe("VC-029 malformed actions", () => {
  const cases: [string, unknown, string][] = [
    ["unknown kind", { kind: "teleport" }, "$[0].kind"],
    [
      "missing card_id",
      { kind: "flip", orientation: "face_up" },
      "$[0].card_id",
    ],
    [
      "extra field",
      { kind: "flip", card_id: "c1", orientation: "face_up", note: "x" },
      "$[0].note",
    ],
    [
      "count 1.5",
      { kind: "draw", from_zone: "deck", to_zone: "table", count: 1.5 },
      "$[0].count",
    ],
    ["steps 0", { kind: "control_advance", steps: 0 }, "$[0].steps"],
  ];
  it.each(cases)("%s", (_name, raw, path) => {
    const e = errorOf(run(start, [raw as never]));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(0);
    expect(e.path).toBe(path);
    expect(e.detail).toContain(path);
  });
});

describe("VC-040 ended-session admission", () => {
  const completed = variant(start, (d) => {
    d.lifecycle = "completed";
  });
  const terminated = variant(start, (d) => {
    d.lifecycle = "terminated";
  });
  const move = A.move("c1", "deck", "table");

  it("completed: only [lifecycle(terminated)] is admitted", () => {
    const r = must(run(completed, [A.lifecycle("terminated")]));
    expect(r.state.lifecycle).toBe("terminated");
    expect(r.notifications).toEqual([{ to: "terminated" }]);
    expect(r.state.seq).toBe(1);
  });

  it("completed: every other batch -> SESSION_ENDED at index 0, state unchanged", () => {
    const batches: (readonly (Action | Macro)[])[] = [
      [move],
      [],
      [A.draw("deck", 0, "table")],
      [A.lifecycle("active")],
      [A.lifecycle("completed")],
      [A.lifecycle("terminated"), move],
      [move, A.lifecycle("terminated")],
    ];
    const before = stateDigest(def, completed);
    for (const batch of batches) {
      const e = errorOf(run(completed, batch));
      expect(e.code).toBe("SESSION_ENDED");
      expect(e.actionIndex).toBe(0);
      expect(e.detail).toContain("completed");
    }
    expect(stateDigest(def, completed)).toBe(before);
  });

  it("terminated: every batch, including [] and [lifecycle(terminated)], -> SESSION_ENDED", () => {
    const before = stateDigest(def, terminated);
    for (const batch of [
      [],
      [move],
      [A.lifecycle("terminated")],
      [A.draw("deck", 0, "table")],
    ]) {
      expect(errorOf(run(terminated, batch)).code).toBe("SESSION_ENDED");
    }
    expect(errorOf(apply(def, terminated, "junk" as never)).code).toBe(
      "SESSION_ENDED",
    );
    expect(stateDigest(def, terminated)).toBe(before);
    expect(isDeepFrozen(terminated)).toBe(true);
  });

  it("admission precedes shape validation, and a malformed single completed batch is rejected as ended", () => {
    expect(errorOf(run(completed, [{ kind: "nope" } as never])).code).toBe(
      "SESSION_ENDED",
    );
    // the terminate exception still goes through validation (extra field)
    const e = errorOf(
      run(completed, [
        { kind: "lifecycle", to_state: "terminated", x: 1 } as never,
      ]),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
  });
});

describe("atomicity spot test", () => {
  it("a failing batch leaves the input reference and digest unchanged", () => {
    const before = stateDigest(def, start);
    const batches: (readonly (Action | Macro)[])[] = [
      [
        A.move("c1", "deck", "table"),
        A.flip("c1", "face_up"),
        A.move("c1", "deck", "table"),
      ],
      [A.setMetadata("c1", { rank: 1 }), A.shuffle("deck", ["c1"])],
      [
        A.move("c1", "deck", "table"),
        A.lifecycle("completed"),
        A.flip("c2", "face_up"),
      ],
      [A.move("c1", "deck", "table"), { kind: "nope" } as never],
    ];
    for (const batch of batches) {
      expect(run(start, batch).ok).toBe(false);
      expect(stateDigest(def, start)).toBe(before);
      expect(isDeepFrozen(start)).toBe(true);
    }
    expect(start.seq).toBe(0);
    expect(start.cards["c1" as never]?.zone).toBe("deck");
  });
});

describe("KBR-001 by construction", () => {
  it("every card is in exactly one zone after a mixed batch", () => {
    const r = must(
      run(start, [
        A.move("c1", "deck", "table"),
        A.move("c2", "deck", "discard", 0),
        A.move("c1", "table", "discard", 1),
        A.shuffle("deck", ["c6", "c5", "c4", "c3"]),
        A.move("c3", "deck", "deck", 0),
        A.move("c2", "discard", "table"),
      ]),
    );
    expect(structuralProblems(r.state)).toEqual([]);
    expect(structuralProblems(start)).toEqual([]);
  });
});

describe("ids that collide with Object.prototype members (carry-over from iteration 4)", () => {
  it("unknown ids such as constructor/toString are unknown, not inherited", () => {
    for (const id of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
    ]) {
      const e = errorOf(run(start, [A.move(id, "deck", "table")]));
      expect(e.code).toBe("MALFORMED_ACTION");
      expect(e.detail).toContain(id);
      expect(errorOf(run(start, [A.flip(id, "face_up")])).code).toBe(
        "MALFORMED_ACTION",
      );
      expect(errorOf(run(start, [A.move("c1", "deck", id)])).code).toBe(
        "MALFORMED_ACTION",
      );
      expect(errorOf(run(start, [A.move("c1", id, "table")])).code).toBe(
        "CARD_NOT_IN_ZONE",
      );
    }
  });

  it("a card and a zone literally named __proto__ work end to end", () => {
    const proto = buildDefinition({
      cards: [
        {
          id: must(cardId("__proto__")),
          metadataSchema: { rank: "int" },
          startingZone: must(zoneId("deck")),
          initialMetadata: {},
          metadataVisibility: {},
        },
        {
          id: must(cardId("c2")),
          metadataSchema: { rank: "int" },
          startingZone: must(zoneId("deck")),
          initialMetadata: {},
          metadataVisibility: {},
        },
      ],
      zones: [
        { id: must(zoneId("deck")), ordered: true, visibility: {} },
        { id: must(zoneId("__proto__")), ordered: false, visibility: {} },
      ],
    });
    const s0 = startState(proto);
    expect(Object.keys(s0.cards)).toEqual(["__proto__", "c2"]);
    expect(Object.getPrototypeOf(s0.cards)).toBe(Object.prototype);
    const r = must(
      apply(proto, s0, [
        A.flip("__proto__", "face_up"),
        A.setMetadata("__proto__", { rank: 3 }),
        A.move("__proto__", "deck", "__proto__"),
      ]),
    );
    expect(Object.keys(r.state.zones)).toEqual(["deck", "__proto__"]);
    expect(
      Object.getOwnPropertyDescriptor(r.state.zones, "__proto__")?.value,
    ).toEqual({ members: ["__proto__"] });
    expect(
      Object.getOwnPropertyDescriptor(r.state.cards, "__proto__")?.value,
    ).toEqual({
      zone: "__proto__",
      orientation: "face_up",
      metadata: { rank: 3 },
    });
    expect(
      structuralProblems(r.state).filter((p) => !p.includes("__proto__")),
    ).toEqual([]);
    expect(stateDigest(proto, r.state)).toMatch(/^[0-9a-f]{64}$/);
    const back = must(
      apply(proto, r.state, [A.move("__proto__", "__proto__", "deck", 1)]),
    );
    const deck = Object.getOwnPropertyDescriptor(back.state.zones, "deck")
      ?.value as { members: string[] } | undefined;
    expect(deck?.members).toEqual(["c2", "__proto__"]);
  });
});
