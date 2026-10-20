import { describe, expect, it } from "vitest";
import { buildDefinition } from "../../definition/definition.testing.js";
import { stateDigest } from "../../replay/canonical/index.js";
import { A } from "../actions.testing.js";
import type { Action, Macro } from "../actions.js";
import type { Snapshot } from "../snapshot.js";
import { isDeepFrozen } from "../snapshot.testing.js";
import type { SessionState } from "../state.js";
import { apply } from "./index.js";
import { errorOf, must, startState } from "./apply.testing.js";
import { structuralProblems } from "./invariants.testing.js";

const def = buildDefinition();
const start = startState(def);

function run(state: Snapshot<SessionState>, ...batch: (Action | Macro)[]) {
  return apply(def, state, batch);
}
const next = (state: Snapshot<SessionState>, ...batch: Action[]) =>
  must(run(state, ...batch)).state;
const members = (s: Snapshot<SessionState>, zone: string) =>
  s.zones[zone as never]?.members ?? [];

/** deck [c1..c6], discard [] (ordered), table [] (unordered). */
describe("VC-030 move", () => {
  it("into position 0, middle, end of an ordered zone", () => {
    let s = next(start, A.move("c1", "deck", "discard", 0));
    s = next(s, A.move("c2", "deck", "discard", 0)); // top
    expect(members(s, "discard")).toEqual(["c2", "c1"]);
    s = next(s, A.move("c3", "deck", "discard", 1)); // middle
    expect(members(s, "discard")).toEqual(["c2", "c3", "c1"]);
    s = next(s, A.move("c4", "deck", "discard", 3)); // end
    expect(members(s, "discard")).toEqual(["c2", "c3", "c1", "c4"]);
    expect(members(s, "deck")).toEqual(["c5", "c6"]);
    for (const id of ["c1", "c2", "c3", "c4"])
      expect(s.cards[id as never]?.zone).toBe("discard");
    expect(structuralProblems(s)).toEqual([]);
  });

  it("into an unordered zone appends, and keeps insertion order", () => {
    let s = next(start, A.move("c3", "deck", "table"));
    s = next(s, A.move("c1", "deck", "table"));
    expect(members(s, "table")).toEqual(["c3", "c1"]);
    expect(members(s, "deck")).toEqual(["c2", "c4", "c5", "c6"]);
    expect(s.cards["c3" as never]?.zone).toBe("table");
  });

  it("keeps the card's identity data (orientation, metadata)", () => {
    let s = next(
      start,
      A.flip("c1", "face_up"),
      A.setMetadata("c1", { rank: 7 }),
    );
    s = next(s, A.move("c1", "deck", "table"));
    expect(s.cards["c1" as never]).toEqual({
      zone: "table",
      orientation: "face_up",
      metadata: { rank: 7 },
    });
  });

  it("is committed as given and the input is untouched", () => {
    const batch = [A.move("c1", "deck", "discard", 0)];
    const before = stateDigest(def, start);
    const r = must(apply(def, start, batch));
    expect(r.committed).toEqual(batch);
    expect(r.committed[0]).not.toBe(batch[0]);
    expect(stateDigest(def, start)).toBe(before);
    expect(members(start, "deck")).toHaveLength(6);
  });
});

describe("VC-031 move errors and same-zone positions", () => {
  it("card in another zone -> CARD_NOT_IN_ZONE naming the card (and zone)", () => {
    const e = errorOf(run(start, A.move("c1", "discard", "table")));
    expect(e.code).toBe("CARD_NOT_IN_ZONE");
    expect(e.detail).toContain("c1");
    expect(e.actionIndex).toBe(0);
    // an unknown from_zone is the same code
    expect(errorOf(run(start, A.move("c1", "nowhere", "table"))).code).toBe(
      "CARD_NOT_IN_ZONE",
    );
  });

  it("position len+1, negative, missing on ordered, present on unordered, unknown to_zone, unknown card", () => {
    const tooBig = errorOf(run(start, A.move("c1", "deck", "discard", 1)));
    expect(tooBig.code).toBe("MALFORMED_ACTION");
    expect(tooBig.path).toBe("$[0].to_position");
    const negative = errorOf(
      apply(def, start, [
        {
          kind: "move",
          card_id: "c1",
          from_zone: "deck",
          to_zone: "discard",
          to_position: -1,
        } as never,
      ]),
    );
    expect(negative.code).toBe("MALFORMED_ACTION");
    expect(errorOf(run(start, A.move("c1", "deck", "discard"))).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(errorOf(run(start, A.move("c1", "deck", "table", 0))).code).toBe(
      "MALFORMED_ACTION",
    );
    const zone = errorOf(run(start, A.move("c1", "deck", "ghost")));
    expect(zone.code).toBe("MALFORMED_ACTION");
    expect(zone.detail).toContain("ghost");
    const card = errorOf(run(start, A.move("ghost", "deck", "table")));
    expect(card.code).toBe("MALFORMED_ACTION");
    expect(card.detail).toContain("ghost");
  });

  it("same-zone vectors on [A,B,C,D]", () => {
    const four = next(
      start,
      A.move("c5", "deck", "discard", 0),
      A.move("c6", "deck", "discard", 0),
    );
    expect(
      members(next(four, A.move("c4", "deck", "deck", 1)), "deck"),
    ).toEqual(["c1", "c4", "c2", "c3"]);
    expect(
      members(next(four, A.move("c1", "deck", "deck", 3)), "deck"),
    ).toEqual(["c2", "c3", "c4", "c1"]);
    const e = errorOf(run(four, A.move("c1", "deck", "deck", 4)));
    expect(e.code).toBe("MALFORMED_ACTION");
    // moving to the same index is a no-op that still commits
    const same = must(run(four, A.move("c2", "deck", "deck", 1)));
    expect(members(same.state, "deck")).toEqual(["c1", "c2", "c3", "c4"]);
    expect(same.state.seq).toBe(four.seq + 1);
  });

  it("same-zone move in an unordered zone moves the card to the end", () => {
    const s = next(
      start,
      A.move("c1", "deck", "table"),
      A.move("c2", "deck", "table"),
      A.move("c1", "table", "table"),
    );
    expect(members(s, "table")).toEqual(["c2", "c1"]);
    expect(structuralProblems(s)).toEqual([]);
  });

  it("failing move leaves the working batch uncommitted (atomic)", () => {
    const before = stateDigest(def, start);
    const e = errorOf(
      run(start, A.move("c1", "deck", "table"), A.move("c1", "deck", "table")),
    );
    expect(e.code).toBe("CARD_NOT_IN_ZONE");
    expect(e.actionIndex).toBe(1);
    expect(stateDigest(def, start)).toBe(before);
  });
});

describe("VC-032 flip", () => {
  it("flips to each orientation; flipping to the current one still advances seq", () => {
    const up = must(run(start, A.flip("c1", "face_up")));
    expect(up.state.cards["c1" as never]?.orientation).toBe("face_up");
    const down = must(run(up.state, A.flip("c1", "face_down")));
    expect(down.state.cards["c1" as never]?.orientation).toBe("face_down");
    const same = must(run(start, A.flip("c1", "face_down")));
    expect(same.state.seq).toBe(1);
    expect(same.committed).toHaveLength(1);
    expect(stateDigest(def, same.state)).not.toBe(stateDigest(def, start)); // seq is in the digest
    expect(same.state.cards["c1" as never]).toBe(start.cards["c1" as never]);
  });

  it("unknown card -> MALFORMED_ACTION naming the id", () => {
    const e = errorOf(run(start, A.flip("ghost", "face_up")));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("ghost");
  });
});

describe("VC-033 shuffle", () => {
  it("valid permutation sets the order exactly", () => {
    const s = next(
      start,
      A.shuffle("deck", ["c6", "c5", "c4", "c3", "c2", "c1"]),
    );
    expect(members(s, "deck")).toEqual(["c6", "c5", "c4", "c3", "c2", "c1"]);
    expect(structuralProblems(s)).toEqual([]);
  });

  it("missing id, duplicate id, extra id, different length, unordered zone -> MALFORMED_ACTION", () => {
    const ids = ["c1", "c2", "c3", "c4", "c5", "c6"];
    const cases: Action[] = [
      A.shuffle("deck", ids.slice(1)), // missing
      A.shuffle("deck", ["c1", "c1", "c3", "c4", "c5", "c6"]), // duplicate (same length)
      A.shuffle("deck", ["c1", "c2", "c3", "c4", "c5", "c7"]), // foreign card, same length
      A.shuffle("deck", [...ids, "c1"]), // longer
      A.shuffle("deck", [...ids, "c7"]), // extra
      A.shuffle("table", []), // unordered
      A.shuffle("ghost", []), // unknown zone
    ];
    for (const action of cases) {
      const e = errorOf(run(start, action));
      expect(e.code).toBe("MALFORMED_ACTION");
      expect(e.actionIndex).toBe(0);
    }
  });

  it("zero- and one-card zones accept the identity", () => {
    expect(members(next(start, A.shuffle("discard", [])), "discard")).toEqual(
      [],
    );
    const one = next(start, A.move("c1", "deck", "discard", 0));
    expect(members(next(one, A.shuffle("discard", ["c1"])), "discard")).toEqual(
      ["c1"],
    );
  });
});

describe("VC-034 set_metadata", () => {
  it("changes only the named fields", () => {
    const a = next(start, A.setMetadata("c1", { rank: 5 }));
    expect(a.cards["c1" as never]?.metadata).toEqual({ rank: 5 });
    const b = next(a, A.setMetadata("c1", { suit: "h" }));
    expect(b.cards["c1" as never]?.metadata).toEqual({ rank: 5, suit: "h" });
    const c = next(b, A.setMetadata("c1", { rank: 6 }));
    expect(c.cards["c1" as never]?.metadata).toEqual({ rank: 6, suit: "h" });
    expect(c.cards["c2" as never]).toBe(start.cards["c2" as never]);
    expect(c.cards["c1" as never]?.zone).toBe("deck");
  });

  it("undeclared field, wrong type and unknown card -> MALFORMED_ACTION with path", () => {
    const undeclared = errorOf(
      run(start, A.setMetadata("c1", { color: "red" })),
    );
    expect(undeclared.code).toBe("MALFORMED_ACTION");
    expect(undeclared.path).toBe("$[0].fields.color");
    expect(undeclared.detail).toContain("color");
    const wrong = errorOf(run(start, A.setMetadata("c1", { rank: "x" })));
    expect(wrong.code).toBe("MALFORMED_ACTION");
    expect(wrong.path).toBe("$[0].fields.rank");
    expect(errorOf(run(start, A.setMetadata("c1", { suit: 3 }))).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(errorOf(run(start, A.setMetadata("ghost", {}))).detail).toContain(
      "ghost",
    );
  });

  it("json and bool field types", () => {
    const rich = buildDefinition({
      cards: buildDefinition().cards.map((c) => ({
        ...c,
        metadataSchema: { flag: "bool", blob: "json" },
      })),
    });
    const s0 = startState(rich);
    const s1 = must(
      apply(rich, s0, [A.setMetadata("c1", { flag: true, blob: { a: [1] } })]),
    ).state;
    expect(s1.cards["c1" as never]?.metadata).toEqual({
      flag: true,
      blob: { a: [1] },
    });
    expect(apply(rich, s0, [A.setMetadata("c1", { flag: 1 })]).ok).toBe(false);
    expect(isDeepFrozen(s1)).toBe(true);
  });

  it("an empty fields object is a committed no-op", () => {
    const r = must(run(start, A.setMetadata("c1", {})));
    expect(r.state.seq).toBe(1);
    expect(r.state.cards["c1" as never]).toBe(start.cards["c1" as never]);
  });
});

describe("VC-039 lifecycle", () => {
  it("legal transitions from active", () => {
    expect(next(start, A.lifecycle("completed")).lifecycle).toBe("completed");
    expect(next(start, A.lifecycle("terminated")).lifecycle).toBe("terminated");
  });

  it("active -> active is MALFORMED_ACTION", () => {
    const e = errorOf(run(start, A.lifecycle("active")));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.path).toBe("$[0].to_state");
  });

  it("a lifecycle action followed by another action is MALFORMED_ACTION", () => {
    const e = errorOf(
      run(start, A.lifecycle("completed"), A.move("c1", "deck", "table")),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(0);
    // as the last action it is fine, after other actions
    const ok = must(
      run(start, A.move("c1", "deck", "table"), A.lifecycle("completed")),
    );
    expect(ok.state.lifecycle).toBe("completed");
    expect(ok.state.zones["table" as never]?.members).toEqual(["c1"]);
  });

  it("stores the outcome; completed -> terminated keeps it unless overwritten (D-016)", () => {
    const done = next(start, A.lifecycle("completed", { winner: "s1" }));
    expect(done.outcome).toEqual({ winner: "s1" });
    const kept = next(done, A.lifecycle("terminated"));
    expect(kept.outcome).toEqual({ winner: "s1" });
    expect(kept.lifecycle).toBe("terminated");
    const overwritten = next(done, A.lifecycle("terminated", { winner: "s2" }));
    expect(overwritten.outcome).toEqual({ winner: "s2" });
    expect("outcome" in next(start, A.lifecycle("completed"))).toBe(false);
    // a JSON null outcome is a real outcome
    expect(next(start, A.lifecycle("completed", null)).outcome).toBeNull();
  });
});
