import { describe, expect, it } from "vitest";
import { stateDigest } from "../../replay/canonical/index.js";
import { seatId } from "../ids.js";
import { A } from "../actions.testing.js";
import type { Action } from "../actions.js";
import type { JsonValue } from "../state.js";
import { isDeepFrozen } from "../snapshot.testing.js";
import { variant } from "../state.testing.js";
import { errorOf, must, startState } from "./apply.testing.js";
import { findInvariantViolation } from "./invariants.js";
import { structuralProblems } from "./invariants.testing.js";
import { apply } from "./index.js";
import { buildReducerDefinition, meta, rosterOp } from "./reducers.testing.js";

/**
 * One failing-path test per business rule (KNFR-006), each name containing its id. The rules
 * with a longer history (KBR-006, KBR-007, KBR-008, KBR-010) have theirs beside their
 * features; this file adds KBR-001..005, KBR-009 and KBR-011 and the reducer/cast corruption
 * path of KBR-001.
 */

const def = buildReducerDefinition();
const start = startState(def);
const digest = (s: typeof start) => stateDigest(def, s);

function unchanged(s: typeof start, before: string): void {
  expect(digest(s)).toBe(before);
  expect(isDeepFrozen(s)).toBe(true);
}

describe("KBR-001 every card is in exactly one zone", () => {
  it("KBR-001: a reducer that corrupts zone membership through a cast is REDUCER_ERROR", () => {
    // The reducer reaches the live state through a captured reference and a cast.
    // States are frozen, so the write throws and the whole batch is rejected.
    const corrupting = buildReducerDefinition({
      notes: (p) => {
        const zones = s0.zones as unknown as Record<
          string,
          { members: string[] }
        >;
        zones.table?.members.push("c1");
        return p;
      },
    });
    const s0 = startState(corrupting);
    const before = stateDigest(corrupting, s0);
    const e = errorOf(apply(corrupting, s0, [meta("notes", {})]));
    expect(e.code).toBe("REDUCER_ERROR");
    expect(e.actionIndex).toBe(0);
    expect(stateDigest(corrupting, s0)).toBe(before);
    expect(structuralProblems(s0)).toEqual([]);
    expect(isDeepFrozen(s0)).toBe(true);
  });

  it("KBR-001: a card record rewritten through a cast is REDUCER_ERROR", () => {
    const corrupting = buildReducerDefinition({
      score: (p) => {
        const cards = s0.cards as unknown as Record<string, { zone: string }>;
        const card = cards.c1;
        if (card) card.zone = "discard";
        return p;
      },
    });
    const s0 = startState(corrupting);
    const before = stateDigest(corrupting, s0);
    const e = errorOf(apply(corrupting, s0, [meta("score", { points: 1 })]));
    expect(e.code).toBe("REDUCER_ERROR");
    expect(stateDigest(corrupting, s0)).toBe(before);
  });

  it("KBR-001: a roster reducer that returns zone or card members is REDUCER_ERROR", () => {
    const smuggling = buildReducerDefinition({
      roster: (roster) =>
        ({
          ...roster,
          zones: { deck: { members: [] } },
        }) as unknown as typeof roster,
    });
    const s0 = startState(smuggling);
    const before = stateDigest(smuggling, s0);
    const e = errorOf(
      apply(smuggling, s0, [
        rosterOp("set_status", { seat_id: "s1", status: "seated" }),
      ]),
    );
    expect(e.code).toBe("REDUCER_ERROR");
    expect(stateDigest(smuggling, s0)).toBe(before);
  });

  it("KBR-001: the whole-state re-check names a duplicated, lost or mislabelled card", () => {
    const duplicated = variant(start, (d) => {
      d.zones["discard" as never]?.members.push("c1" as never);
    });
    expect(findInvariantViolation(def, duplicated)).toContain("KBR-001");
    expect(structuralProblems(duplicated)).not.toEqual([]);
    const lost = variant(start, (d) => {
      const deck = d.zones["deck" as never];
      if (deck) deck.members.length = 0;
    });
    expect(findInvariantViolation(def, lost)).toContain("KBR-001");
    const mislabelled = variant(start, (d) => {
      const card = d.cards["c2" as never];
      if (card) card.zone = "table" as never;
    });
    expect(findInvariantViolation(def, mislabelled)).toContain("KBR-001");
    // and a legal batch never trips it
    const ok = must(apply(def, start, [A.move("c1", "deck", "table")]));
    expect(findInvariantViolation(def, ok.state)).toBeUndefined();
  });
});

describe("KBR-002 a move names a card in from_zone and a position in bounds", () => {
  it("KBR-002: wrong from_zone, out-of-bounds and misplaced positions are rejected", () => {
    const before = digest(start);
    expect(
      errorOf(apply(def, start, [A.move("c1", "table", "discard", 0)])).code,
    ).toBe("CARD_NOT_IN_ZONE");
    for (const position of [-1, 1, 99]) {
      const e = errorOf(
        apply(def, start, [A.move("c1", "deck", "discard", position)]),
      );
      expect(e.code).toBe("MALFORMED_ACTION");
    }
    expect(
      errorOf(apply(def, start, [A.move("c1", "deck", "table", 0)])).code,
    ).toBe("MALFORMED_ACTION");
    expect(
      errorOf(apply(def, start, [A.move("c1", "deck", "discard")])).code,
    ).toBe("MALFORMED_ACTION");
    unchanged(start, before);
  });
});

describe("KBR-003 a shuffle permutation rearranges the zone's membership", () => {
  it("KBR-003: a missing, duplicate, extra or foreign id is rejected", () => {
    const before = digest(start);
    const all = ["c1", "c2", "c3", "c4", "c5", "c6"];
    for (const permutation of [
      all.slice(1),
      [...all.slice(1), "c2"],
      [...all, "c1"],
      [...all.slice(1), "zz"],
      [],
    ]) {
      const e = errorOf(apply(def, start, [A.shuffle("deck", permutation)]));
      expect(e.code).toBe("MALFORMED_ACTION");
    }
    // an unordered zone cannot be shuffled
    expect(errorOf(apply(def, start, [A.shuffle("table", [])])).code).toBe(
      "MALFORMED_ACTION",
    );
    unchanged(start, before);
    // identity on a one-card zone is fine
    const one = must(
      apply(def, start, [A.move("c1", "deck", "discard", 0)]),
    ).state;
    expect(apply(def, one, [A.shuffle("discard", ["c1"])]).ok).toBe(true);
  });
});

describe("KBR-004 lifecycle transitions", () => {
  it("KBR-004: active->active, a non-final lifecycle action and ended-session batches are rejected", () => {
    const before = digest(start);
    expect(errorOf(apply(def, start, [A.lifecycle("active")])).code).toBe(
      "MALFORMED_ACTION",
    );
    const notLast = errorOf(
      apply(def, start, [
        A.lifecycle("completed"),
        A.move("c1", "deck", "table"),
      ]),
    );
    expect(notLast.code).toBe("MALFORMED_ACTION");
    expect(notLast.actionIndex).toBe(0);
    unchanged(start, before);

    const completed = must(apply(def, start, [A.lifecycle("completed")])).state;
    const afterCompleted = digest(completed);
    for (const batch of [
      [] as Action[],
      [A.move("c1", "deck", "table")],
      [A.lifecycle("active")],
      [A.lifecycle("completed")],
      [A.lifecycle("terminated"), A.move("c1", "deck", "table")],
    ]) {
      expect(errorOf(apply(def, completed, batch)).code).toBe("SESSION_ENDED");
    }
    unchanged(completed, afterCompleted);
    // the single admitted batch
    expect(apply(def, completed, [A.lifecycle("terminated")]).ok).toBe(true);
  });
});

describe("KBR-005 turn enforcement", () => {
  it("KBR-005: a player outside active_seats gets NOT_YOUR_TURN, judged on the input state", () => {
    const before = digest(start);
    const s2 = must(seatId("s2"));
    const s1 = must(seatId("s1"));
    const move = [A.move("c1", "deck", "table")];
    const e = errorOf(
      apply(def, start, move, {
        proposal: { origin: "player", kind: "move", actingSeat: s2 },
      }),
    );
    expect(e.code).toBe("NOT_YOUR_TURN");
    expect(e.actionIndex).toBe(0);
    // the acting seat is judged on the input, even when the batch hands the turn over
    const handover = apply(
      def,
      start,
      [A.controlSet({ activeSeats: ["s2"] })],
      {
        proposal: { origin: "player", kind: "move", actingSeat: s1 },
      },
    );
    expect(handover.ok).toBe(true);
    if (handover.ok) {
      expect(
        errorOf(
          apply(def, handover.value.state, move, {
            proposal: { origin: "player", kind: "move", actingSeat: s1 },
          }),
        ).code,
      ).toBe("NOT_YOUR_TURN");
    }
    unchanged(start, before);
  });
});

describe("KBR-009 lifecycle gate", () => {
  it("KBR-009: every batch on a terminated session, including [], is SESSION_ENDED", () => {
    const terminated = must(
      apply(def, start, [A.lifecycle("terminated")]),
    ).state;
    const before = digest(terminated);
    for (const batch of [
      [] as Action[],
      [A.lifecycle("terminated")],
      [A.move("c1", "deck", "table")],
    ]) {
      const e = errorOf(apply(def, terminated, batch));
      expect(e.code).toBe("SESSION_ENDED");
      expect(e.actionIndex).toBe(0);
    }
    unchanged(terminated, before);
    // and an empty batch on a completed session is rejected before the empty-batch rule
    const completed = must(apply(def, start, [A.lifecycle("completed")])).state;
    expect(errorOf(apply(def, completed, [])).code).toBe("SESSION_ENDED");
  });
});

describe("KBR-011 counter bounds and conservation", () => {
  it("KBR-011: out-of-bounds values and unbalanced groups are COUNTER_BOUNDS", () => {
    const before = digest(start);
    // pot has min 0 and starts at 0; bank has max 1000 and starts at 100
    const below = errorOf(apply(def, start, [A.adjust("pot", -1n)]));
    expect(below.code).toBe("COUNTER_BOUNDS");
    expect(below.detail).toContain("pot");
    expect(errorOf(apply(def, start, [A.adjust("bank", 901n)])).code).toBe(
      "COUNTER_BOUNDS",
    );
    // a non-supply member changing the group sum
    const unbalanced = errorOf(
      apply(def, start, [A.adjust("bank", 1n), A.adjust("pot", 5n)]),
    );
    expect(unbalanced.code).toBe("COUNTER_BOUNDS");
    expect(unbalanced.actionIndex).toBe(1);
    // exact arithmetic: a value far beyond 2^64 is held exactly, and still bounded
    expect(errorOf(apply(def, start, [A.adjust("bank", 2n ** 70n)])).code).toBe(
      "COUNTER_BOUNDS",
    );
    unchanged(start, before);
    // a transfer inside the group is fine
    expect(apply(def, start, [A.transfer("bank", "pot", 10n)]).ok).toBe(true);
    // reducer outputs are re-checked too (KBR-010 shares the bounds)
    const payload: JsonValue = { text: "x" };
    expect(apply(def, start, [meta("notes", payload)]).ok).toBe(true);
  });
});
