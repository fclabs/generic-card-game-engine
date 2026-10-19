import type { CompiledGameDefinition } from "../definition/types.js";
import { A } from "./actions.testing.js";
import type { Action, Macro } from "./actions.js";
import type { ApplyOptions } from "./apply/types.js";
import { engine, meta, rosterOp } from "./apply/reducers.testing.js";
import {
  buildPropertyDefinition,
  propertyRoster,
} from "./generators.testing.js";
import type { RosterEntry } from "./state.js";
import { seatId } from "./ids.js";

/**
 * The committed golden stream (VC-067): 30 non-empty batches applied from `createSession`
 * over the property definition (`buildPropertyDefinition()`), so batch `n` commits `seq n`.
 * Together the batches use every primitive kind (every roster op), the three macros and the
 * six `engine.*` actions, include proposals of the three admitted origins, end the session
 * (`completed` at 29, `terminated` at 30) and leave housekeeping actions in the middle of
 * ordinary batches (as the P6 pipeline would).
 *
 * The expected digests at seq 0, 10, 20 and 30 are committed in `golden-stream.json`. The
 * stream is data: changing a single action, or the definition it runs on, changes the
 * digests and is a deliberate act (regenerate with `UPDATE_GOLDEN=1`, review by hand).
 */

export interface GoldenStep {
  readonly batch: readonly (Action | Macro)[];
  readonly opts?: ApplyOptions;
}

export function goldenDefinition(): CompiledGameDefinition {
  return buildPropertyDefinition();
}

export function goldenRoster(): RosterEntry[] {
  return propertyRoster();
}

const seat = (id: string) => {
  const r = seatId(id);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};
const asPlayer = (kind: string, actingSeat: string): ApplyOptions => ({
  proposal: { origin: "player", kind, actingSeat: seat(actingSeat) },
});
const asOrigin = (
  origin: "dealer" | "control" | "system",
  kind: string,
): ApplyOptions => ({ proposal: { origin, kind } });

export const GOLDEN_STEPS: readonly GoldenStep[] = [
  // 1: draws (macros) from the ordered deck into an unordered and an ordered zone
  {
    batch: [A.draw("deck", 2, "hold"), A.draw("deck", 3, "discard")],
    opts: asOrigin("dealer", "deal"),
  },
  // 2: flips and card metadata
  {
    batch: [
      A.flip("c1", "face_up"),
      A.flip("c2", "face_up"),
      A.setMetadata("c1", { rank: 12, suit: "h" }),
      A.setMetadata("c2", { rank: 1 }),
    ],
  },
  // 3: shuffle with a literal permutation, then an ordered insert
  {
    batch: [
      A.shuffle("discard", ["c5", "c3", "c4"]),
      A.move("c6", "deck", "discard", 1),
    ],
  },
  // 4: counters: adjust, transfers with ratio and remainder, ratio adjusts
  {
    batch: [
      A.adjust("bank", 50n),
      A.transfer("bank", "pot", 40n),
      A.transfer("bank", "reserve", 25n, {
        ratio: [1n, 3n],
        remainderTo: "pot",
      }),
      A.adjust("tally", 30n),
      A.adjust("tally", 7n, [1n, 2n]),
    ],
  },
  // 5: control state: set, advance along turn order, advance a named pointer
  {
    batch: [
      A.controlSet({
        phase: "play",
        activeSeats: ["s1", "s2"],
        direction: 1,
        pointer: { name: "dealer", seat: "s2" },
      }),
      A.advance(1),
      A.advance(2, "dealer"),
    ],
    opts: asOrigin("control", "turn"),
  },
  // 6: grants (card, zone and top targets; three scopes)
  {
    batch: [
      A.grant({ kind: "card", card_id: "c1" }, ["hand"], "s1"),
      A.grant({ kind: "zone", zone_id: "discard" }, ["public"], "all_seated", {
        kind: "once",
      }),
      A.grant({ kind: "top", zone_id: "deck" }, ["hand", "public"], "team:t2", {
        kind: "until_seq",
        n: 20,
      }),
    ],
  },
  // 7: revoke a grant, housekeeping expiry, delegations
  {
    batch: [
      A.revoke("grant/6/1"),
      engine("grant_expire", { grant_id: "grant/6/2" }),
      A.delegate("s1", "alice"),
      A.delegate("s2", "bob", { scope: { kind: "seat" }, boundary: "table" }),
    ],
  },
  // 8: template zones for a seat, no owner and a team; then moves into them
  {
    batch: [
      A.zoneCreate("hand", "s1"),
      A.zoneCreate("pile"),
      A.zoneCreate("stack", "t1"),
      A.draw("deck", 1, "hand/s1/1"),
      A.move("c8", "deck", "pile/_/1", 0),
    ],
  },
  // 9: meta partitions through their reducers
  {
    batch: [
      meta("notes", { text: "hello" }),
      meta("score", { points: 7 }),
      meta("blob", { data: [1, { k: true }] }),
      meta("notes", { text: "world" }),
    ],
  },
  // 10: gates: open two, sealed submissions
  {
    batch: [
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "bid",
        expected_seats: ["s1", "s2"],
      }),
      engine("gate_open", {
        gate_id: "g2",
        schema_id: "vote",
        expected_seats: ["s1", "s2", "s3"],
      }),
      engine("gate_submit", { gate_id: "g1", seat: "s1", payload: { bid: 5 } }),
      engine("gate_submit", { gate_id: "g1", seat: "s2", payload: { bid: 9 } }),
      engine("gate_submit", {
        gate_id: "g2",
        seat: "s3",
        payload: { vote: "yes" },
      }),
    ],
  },
  // 11: replace a submission, retract one, submit, resolve a gate
  {
    batch: [
      engine("gate_submit", { gate_id: "g1", seat: "s1", payload: { bid: 6 } }),
      engine("gate_retract", { gate_id: "g2", seat: "s3" }),
      engine("gate_submit", {
        gate_id: "g2",
        seat: "s1",
        payload: { vote: "no" },
      }),
      engine("gate_resolve", { gate_id: "g1" }),
    ],
  },
  // 12: a second pile, moves into it, then merge it into the first (macro + destroy)
  {
    batch: [
      A.zoneCreate("pile"),
      A.move("c1", "hold", "pile/_/2", 0),
      A.move("c2", "hold", "pile/_/2", 1),
      A.zoneMerge("pile/_/2", "pile/_/1"),
    ],
  },
  // 13: reset_to_zone flips the face-up cards it moved back to face_down
  { batch: [A.reset(["discard", "pile/_/1"], "deck")] },
  // 14: shuffle then draw in one batch (sequential expansion)
  {
    batch: [
      A.shuffle("deck", ["c2", "c1", "c8", "c4", "c3", "c6", "c5"]),
      A.draw("deck", 2, "table"),
    ],
  },
  // 15: roster operations through the roster reducer
  {
    batch: [
      A.substitute("s2", "p2"),
      rosterOp("set_status", { seat_id: "s3", status: "sitting_out" }),
    ],
  },
  // 16: advancing skips the sitting-out seat, then reverse direction
  {
    batch: [
      A.controlSet({ activeSeats: ["s2"] }),
      A.advance(1),
      A.controlSet({ direction: -1 }),
      A.advance(1),
    ],
    opts: asPlayer("chat", "s2"),
  },
  // 17: ratio transfer with a floor source, negative adjusts within bounds
  {
    batch: [
      A.transfer("reserve", "bank", 21n, {
        ratio: [1n, 2n],
        remainderTo: "pot",
      }),
      A.adjust("bank", -30n),
      A.adjust("tally", -50n),
    ],
  },
  // 18: zone lifecycle: create, destroy, create again (ordinals are never reused)
  {
    batch: [
      A.zoneCreate("stack", "t2"),
      A.zoneDestroy("stack/t1/1"),
      A.zoneCreate("stack", "t1"),
    ],
  },
  // 19: more grants, keyed to template zones
  {
    batch: [
      A.grant({ kind: "zone", zone_id: "hand/s1/1" }, ["hand"], "s1", {
        kind: "once",
      }),
      A.grant({ kind: "card", card_id: "c8" }, ["public"], "team:t1"),
    ],
  },
  // 20: flip back, metadata, a one-seat gate opened, submitted and resolved
  {
    batch: [
      A.flip("c2", "face_down"),
      A.setMetadata("c8", { rank: 8, suit: "s" }),
      engine("gate_open", {
        gate_id: "g3",
        schema_id: "ack",
        expected_seats: ["s2"],
      }),
      engine("gate_submit", { gate_id: "g3", seat: "s2", payload: { n: 1 } }),
      engine("gate_resolve", { gate_id: "g3" }),
    ],
  },
  // 21: meta overwrite, revoke a delegation, plain moves
  {
    batch: [
      meta("score", { points: 99 }),
      A.revokeDelegation("s1", "alice"),
      A.move("c7", "hand/s1/1", "discard", 0),
      A.move("c4", "deck", "hold"),
    ],
  },
  // 22: housekeeping in the middle of an ordinary batch, applied in order
  {
    batch: [
      engine("grant_consume", { grant_id: "grant/6/0" }),
      A.revoke("grant/19/1"),
      A.move("c4", "hold", "table"),
    ],
  },
  // 23: draw into an ordered zone at a fixed position
  { batch: [A.draw("deck", 2, "discard", 0)] },
  // 24: a rounding half_even transfer and a half_up adjust
  {
    batch: [
      A.transfer("bank", "pot", 15n, {
        ratio: [1n, 2n],
        remainderTo: "reserve",
      }),
      A.adjust("tally", 5n, [1n, 2n]),
    ],
  },
  // 25: pointer moves and phase change
  {
    batch: [
      A.controlSet({
        phase: "end",
        pointer: { name: "dealer", seat: "s1" },
      }),
      A.advance(1, "dealer"),
    ],
    opts: asOrigin("system", "tick"),
  },
  // 26: a third pile (ordinal 3), moves into it and a shuffle of that ordered template zone
  {
    batch: [
      A.zoneCreate("pile"),
      A.move("c3", "discard", "pile/_/3", 0),
      A.move("c6", "deck", "pile/_/3", 1),
      A.shuffle("pile/_/3", ["c6", "c3"]),
    ],
  },
  // 27: more roster/delegation changes
  {
    batch: [
      A.delegate("s3", "carol"),
      rosterOp("set_status", { seat_id: "s3", status: "seated" }),
      A.revokeDelegation("s2", "bob"),
    ],
  },
  // 28: moves across every zone kind
  {
    batch: [
      A.move("c3", "pile/_/3", "table"),
      A.move("c6", "pile/_/3", "hold"),
      A.zoneDestroy("pile/_/3"),
      A.draw("deck", 1, "discard"),
    ],
  },
  // 29: the game completes with an outcome (last action of its batch)
  {
    batch: [
      A.flip("c1", "face_up"),
      A.lifecycle("completed", { winner: "s1", scores: { s1: 10, s2: 3 } }),
    ],
  },
  // 30: completed -> terminated is the only admitted batch
  { batch: [A.lifecycle("terminated")] },
];
