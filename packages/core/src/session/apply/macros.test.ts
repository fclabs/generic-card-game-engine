import { describe, expect, it } from "vitest";
import { buildDefinition } from "../../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import { stateDigest } from "../../replay/canonical/index.js";
import { A, actionsText } from "../actions.testing.js";
import type { Action, Macro } from "../actions.js";
import { MACRO_KINDS } from "../actions.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";
import { nextZoneId } from "../zone-ids.js";
import { apply } from "./index.js";
import { errorOf, must, startState } from "./apply.testing.js";

const def = buildDefinition();
const start = startState(def);

function run(
  state: Snapshot<SessionState>,
  batch: (Action | Macro)[],
  d: CompiledGameDefinition = def,
) {
  return apply(d, state, batch);
}
const next = (state: Snapshot<SessionState>, ...batch: (Action | Macro)[]) =>
  must(run(state, batch)).state;
const members = (state: Snapshot<SessionState>, zone: string) =>
  state.zones[zone as never]?.members;
const malformed = (
  state: Snapshot<SessionState>,
  macro: Macro,
  path?: string,
) => {
  const e = errorOf(run(state, [macro]));
  expect(e.code).toBe("MALFORMED_ACTION");
  expect(e.actionIndex).toBe(0);
  if (path !== undefined) expect(e.path).toBe(path);
  return e;
};

/** deck c1..c4, discard [c6, c5]. */
const withDiscard = next(
  start,
  A.move("c6", "deck", "discard", 0),
  A.move("c5", "deck", "discard", 1),
);

describe("VC-046 draw (KFR-045)", () => {
  it("appends to an ordered to_zone with explicit positions", () => {
    const r = must(run(withDiscard, [A.draw("deck", 3, "discard")]));
    expect(r.committed).toEqual([
      A.move("c1", "deck", "discard", 2),
      A.move("c2", "deck", "discard", 3),
      A.move("c3", "deck", "discard", 4),
    ]);
    expect(members(r.state, "discard")).toEqual(["c6", "c5", "c1", "c2", "c3"]);
    expect(members(r.state, "deck")).toEqual(["c4"]);
  });

  it("uses to_position + i when the macro gives one", () => {
    const r = must(run(withDiscard, [A.draw("deck", 3, "discard", 0)]));
    expect(r.committed).toEqual([
      A.move("c1", "deck", "discard", 0),
      A.move("c2", "deck", "discard", 1),
      A.move("c3", "deck", "discard", 2),
    ]);
    expect(members(r.state, "discard")).toEqual(["c1", "c2", "c3", "c6", "c5"]);
  });

  it("gives no position for an unordered to_zone", () => {
    const r = must(run(start, [A.draw("deck", 2, "table")]));
    expect(r.committed).toEqual([
      A.move("c1", "deck", "table"),
      A.move("c2", "deck", "table"),
    ]);
    expect(members(r.state, "table")).toEqual(["c1", "c2"]);
  });

  it("EMPTY_ZONE when the zone holds fewer cards, nothing committed", () => {
    const e = errorOf(run(withDiscard, [A.draw("deck", 5, "discard")]));
    expect(e.code).toBe("EMPTY_ZONE");
    expect(e.actionIndex).toBe(0);
    expect(e.detail).toContain("deck");
  });

  it("count 0 expands to nothing; same zone, unordered source and unknown zones are MALFORMED_ACTION", () => {
    expect(must(run(start, [A.draw("deck", 0, "table")])).committed).toEqual(
      [],
    );
    malformed(start, A.draw("deck", 1, "deck"), "$[0].to_zone");
    malformed(start, A.draw("table", 1, "deck"), "$[0].from_zone");
    malformed(start, A.draw("ghost", 1, "deck"), "$[0].from_zone");
    malformed(start, A.draw("deck", 1, "ghost"), "$[0].to_zone");
    malformed(start, A.draw("deck", 1, "discard", 5), "$[0].to_position");
  });

  it("a macro's primitives all carry the macro's input index", () => {
    const e = errorOf(
      run(start, [
        A.move("c1", "deck", "table"),
        A.draw("deck", 2, "discard", 9),
      ]),
    );
    expect(e.actionIndex).toBe(1);
    expect(e.code).toBe("MALFORMED_ACTION");
  });
});

describe("VC-024 / VC-026 macros and the committed list", () => {
  it("[draw count 0] is ok, state === input, nothing committed, seq unchanged", () => {
    const r = must(run(start, [A.draw("deck", 0, "table")]));
    expect(r.state).toBe(start);
    expect(r.committed).toEqual([]);
    expect(r.state.seq).toBe(start.seq);
  });

  it("[draw count 0] on a completed session is SESSION_ENDED (VC-040)", () => {
    const done = next(start, A.lifecycle("completed"));
    const e = errorOf(run(done, [A.draw("deck", 0, "table")]));
    expect(e.code).toBe("SESSION_ENDED");
  });

  it("committed holds primitives only for draw, zone_merge and reset_to_zone", () => {
    const s = next(start, A.zoneCreate("pile"), A.zoneCreate("pile"));
    const r = must(
      run(s, [
        A.draw("deck", 2, "pile/_/1"),
        A.zoneMerge("pile/_/1", "pile/_/2"),
        A.reset(["table", "discard"], "deck"),
      ]),
    );
    expect(r.committed.length).toBeGreaterThan(0);
    for (const action of r.committed) {
      expect(MACRO_KINDS as readonly string[]).not.toContain(action.kind);
    }
    expect(r.committed.map((a) => a.kind)).toEqual([
      "move",
      "move",
      "move",
      "move",
      "zone_destroy",
    ]);
    expect(r.state.seq).toBe(s.seq + 1);
  });
});

describe("VC-047 zone_merge (KFR-046)", () => {
  const s = next(
    start,
    A.zoneCreate("pile"),
    A.zoneCreate("pile"),
    A.draw("deck", 2, "pile/_/1"),
    A.draw("deck", 1, "pile/_/2"),
  );

  it("moves every src card, appended with explicit positions, then destroys src", () => {
    const r = must(run(s, [A.zoneMerge("pile/_/1", "pile/_/2")]));
    expect(r.committed).toEqual([
      A.move("c1", "pile/_/1", "pile/_/2", 1),
      A.move("c2", "pile/_/1", "pile/_/2", 2),
      A.zoneDestroy("pile/_/1"),
    ]);
    expect(members(r.state, "pile/_/2")).toEqual(["c3", "c1", "c2"]);
    expect(r.state.zones["pile/_/1" as never]).toBeUndefined();
  });

  it("an empty src yields just the zone_destroy", () => {
    const e = next(start, A.zoneCreate("pile"), A.zoneCreate("pile"));
    const r = must(run(e, [A.zoneMerge("pile/_/1", "pile/_/2")]));
    expect(r.committed).toEqual([A.zoneDestroy("pile/_/1")]);
  });

  it("a non-template zone or src = dst is MALFORMED_ACTION", () => {
    malformed(s, A.zoneMerge("deck", "pile/_/2"), "$[0].src_zone");
    malformed(s, A.zoneMerge("pile/_/1", "deck"), "$[0].dst_zone");
    malformed(s, A.zoneMerge("pile/_/1", "pile/_/1"), "$[0].dst_zone");
    malformed(s, A.zoneMerge("pile/_/9", "pile/_/1"), "$[0].src_zone");
  });

  it("an unordered dst gets no positions", () => {
    const d = buildDefinition({
      zoneTemplates: [
        {
          name: "bag",
          ownerRule: "none",
          ordered: false,
          maxInstances: 3,
          visibility: {},
        },
      ],
    });
    const b = startState(d);
    const made = must(
      run(
        b,
        [
          A.zoneCreate("bag"),
          A.zoneCreate("bag"),
          A.draw("deck", 2, "bag/_/1"),
          A.zoneMerge("bag/_/1", "bag/_/2"),
        ],
        d,
      ),
    );
    expect(made.committed.slice(-3)).toEqual([
      A.move("c1", "bag/_/1", "bag/_/2"),
      A.move("c2", "bag/_/1", "bag/_/2"),
      A.zoneDestroy("bag/_/1"),
    ]);
  });
});

describe("VC-048 reset_to_zone (KFR-047)", () => {
  // deck c1..c4 (c2, c3 face-up), discard empty, table [c6] (c6 face-up), pile/_/1 [c5] (face-up).
  const base = next(
    start,
    A.zoneCreate("pile"),
    A.move("c5", "deck", "pile/_/1", 0),
    A.move("c6", "deck", "table"),
    A.flip("c2", "face_up"),
    A.flip("c3", "face_up"),
    A.flip("c5", "face_up"),
    A.flip("c6", "face_up"),
  );

  it("moves zone by zone in membership order (appended), then flips the moved face-up cards", () => {
    const r = must(
      run(base, [A.reset(["deck", "discard", "table"], "pile/_/1")]),
    );
    expect(r.committed).toEqual([
      A.move("c1", "deck", "pile/_/1", 1),
      A.move("c2", "deck", "pile/_/1", 2),
      A.move("c3", "deck", "pile/_/1", 3),
      A.move("c4", "deck", "pile/_/1", 4),
      A.move("c6", "table", "pile/_/1", 5),
      A.flip("c2", "face_down"),
      A.flip("c3", "face_down"),
      A.flip("c6", "face_down"),
    ]);
    expect(members(r.state, "pile/_/1")).toEqual([
      "c5",
      "c1",
      "c2",
      "c3",
      "c4",
      "c6",
    ]);
    // c5 was already in to_zone: not moved, not flipped.
    expect(r.state.cards["c5" as never]?.orientation).toBe("face_up");
    expect(r.state.cards["c2" as never]?.orientation).toBe("face_down");
  });

  it("an unordered to_zone gets no positions", () => {
    const r = must(run(base, [A.reset(["deck"], "table")]));
    expect(r.committed.slice(0, 4)).toEqual(
      ["c1", "c2", "c3", "c4"].map((c) => A.move(c, "deck", "table")),
    );
  });

  it("to_zone listed in zones, a duplicate zone and unknown zones are MALFORMED_ACTION", () => {
    malformed(base, A.reset(["deck", "pile/_/1"], "pile/_/1"), "$[0].zones[1]");
    malformed(base, A.reset(["deck", "deck"], "table"), "$[0].zones[1]");
    malformed(base, A.reset(["ghost"], "table"), "$[0].zones[0]");
    malformed(base, A.reset(["deck"], "ghost"), "$[0].to_zone");
  });

  it("an empty zones list is ok and commits nothing", () => {
    const r = must(run(base, [A.reset([], "table")]));
    expect(r.state).toBe(base);
    expect(r.committed).toEqual([]);
  });
});

describe("VC-049 sequential expansion (KFR-048)", () => {
  it("a draw after a shuffle uses the shuffled order", () => {
    const order = ["c4", "c2", "c6", "c1", "c5", "c3"];
    const r = must(
      run(start, [A.shuffle("deck", order), A.draw("deck", 2, "table")]),
    );
    expect(r.committed.slice(1)).toEqual([
      A.move("c4", "deck", "table"),
      A.move("c2", "deck", "table"),
    ]);
    expect(members(r.state, "table")).toEqual(["c4", "c2"]);
  });

  it("draw 5 from a 3-card zone succeeds after a preceding move of 2 more into it", () => {
    const three = next(
      start,
      A.move("c1", "deck", "discard", 0),
      A.move("c2", "deck", "discard", 1),
      A.move("c3", "deck", "discard", 2),
    );
    expect(errorOf(run(three, [A.draw("discard", 5, "table")])).code).toBe(
      "EMPTY_ZONE",
    );
    const r = must(
      run(three, [
        A.move("c4", "deck", "discard", 3),
        A.move("c5", "deck", "discard", 4),
        A.draw("discard", 5, "table"),
      ]),
    );
    expect(members(r.state, "table")).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(members(r.state, "discard")).toEqual([]);
  });

  it("macros see earlier macros: draw then reset", () => {
    const r = must(
      run(start, [A.draw("deck", 2, "table"), A.reset(["table"], "discard")]),
    );
    expect(members(r.state, "discard")).toEqual(["c1", "c2"]);
    expect(r.committed.map((a) => a.kind)).toEqual([
      "move",
      "move",
      "move",
      "move",
    ]);
  });
});

describe("VC-050 zone_create, nextZoneId and a macro in one batch", () => {
  it("a macro may target a zone created earlier in the same batch", () => {
    const id = nextZoneId(start, "pile");
    const r = must(run(start, [A.zoneCreate("pile"), A.draw("deck", 2, id)]));
    expect(members(r.state, id)).toEqual(["c1", "c2"]);
    expect(r.committed[1]).toEqual(A.move("c1", "deck", id, 0));
    const second = nextZoneId(start, "pile", undefined, 1);
    const r2 = must(
      run(start, [
        A.zoneCreate("pile"),
        A.zoneCreate("pile"),
        A.draw("deck", 1, second),
        A.zoneMerge(id, second),
      ]),
    );
    expect(members(r2.state, second)).toEqual(["c1"]);
    expect(r2.state.zones[id as never]).toBeUndefined();
  });
});

describe("VC-004 macro failure indices", () => {
  it("[draw 2, move(card not in zone)] -> index 1", () => {
    const e = errorOf(
      run(start, [A.draw("deck", 2, "table"), A.move("c1", "deck", "table")]),
    );
    expect(e.code).toBe("CARD_NOT_IN_ZONE");
    expect(e.actionIndex).toBe(1);
    expect(e.detail).toContain("c1");
  });

  it("a draw failing with EMPTY_ZONE at input index 2 -> index 2, input untouched", () => {
    const before = stateDigest(def, start);
    const e = errorOf(
      run(start, [
        A.move("c1", "deck", "table"),
        A.draw("deck", 1, "discard"),
        A.draw("deck", 9, "discard"),
      ]),
    );
    expect(e.code).toBe("EMPTY_ZONE");
    expect(e.actionIndex).toBe(2);
    expect(stateDigest(def, start)).toBe(before);
  });
});

describe("VC-043 literal macro form", () => {
  const target = { kind: "card", card_id: "c1" } as const;
  it("[draw 2, grant_view, grant_view] at seq n gives grant/<n+1>/2 and /3; replay gives the same ids", () => {
    const s = next(start, A.move("c6", "deck", "table")); // seq 1
    const batch = [
      A.draw("deck", 2, "discard"),
      A.grant(target, ["hand"], "s1"),
      A.grant({ kind: "zone", zone_id: "deck" }, ["public"], "s2"),
    ];
    const live = must(run(s, batch));
    expect(Object.keys(live.state.grants)).toEqual(["grant/2/2", "grant/2/3"]);
    const replay = must(run(s, [...live.committed]));
    expect(Object.keys(replay.state.grants)).toEqual(
      Object.keys(live.state.grants),
    );
    expect(actionsText(replay.committed)).toBe(actionsText(live.committed));
    expect(stateDigest(def, replay.state)).toBe(stateDigest(def, live.state));
  });
});
