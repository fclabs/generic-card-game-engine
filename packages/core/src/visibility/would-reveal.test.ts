import { describe, expect, it } from "vitest";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { Transaction } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import { engine } from "../session/apply/reducers.testing.js";
import type { GrantId } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import {
  buildTrickTakingDefinition,
  trickTakingState,
} from "./fixtures.testing.js";
import { sealBatch } from "./privileged-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import { projectDelta } from "./project-delta.js";
import { projectView } from "./project-view.js";
import { wouldReveal } from "./would-reveal.js";
import { seat } from "./visibility.testing.js";

const VIEW_KEYS = ["card_face", "zone_membership", "zone_count", "zone_order"];
const def: CompiledGameDefinition = buildTrickTakingDefinition({
  viewKeys: VIEW_KEYS,
});
const ONCE = { kind: "once" };
const hand = (s: string) => ({ kind: "zone", zone_id: `hand-${s}` });
const KEYS = ["zone_membership", "card_face"];

interface Step {
  readonly pre: Snapshot<SessionState>;
  readonly post: Snapshot<SessionState>;
  readonly batch: PrivilegedBatch;
}

let counter = 0;
function step(pre: Snapshot<SessionState>, actions: readonly Action[]): Step {
  const out = must(apply(def, pre, actions));
  counter += 1;
  const tx = {
    seq: out.state.seq,
    eventId: `ev-${String(counter)}`,
    principal: `pr-${String(counter)}`,
    actions: out.committed,
  } as Transaction;
  return { pre, post: out.state, batch: sealBatch(tx) };
}

const reveal = (s: Step, grantee?: string): readonly GrantId[] =>
  wouldReveal(
    def,
    s.pre,
    s.post,
    s.batch,
    grantee === undefined ? undefined : seat(grantee),
  );

/** `once` grant of north's hand to east, in `pre`. */
function withOnce(): { pre: Snapshot<SessionState>; g: GrantId } {
  const pre = trickTakingState(def, [
    A.grant(hand("north"), KEYS, "east", ONCE),
  ]);
  return { pre, g: Object.keys(pre.grants)[0] as GrantId };
}

describe("VC-332 wouldReveal", () => {
  it("a batch moving a granted-hand card out reveals the grant", () => {
    const { pre, g } = withOnce();
    expect(
      reveal(step(pre, [A.move("north-1", "hand-north", "stock", 0)])),
    ).toEqual([g]);
  });

  it("a batch touching only the discard reveals nothing", () => {
    const { pre } = withOnce();
    expect(reveal(step(pre, [A.flip("d1", "face_down")]))).toEqual([]);
  });

  it("a revoke_view batch that also moves a hand card still reveals (union of grants)", () => {
    const { pre, g } = withOnce();
    const s = step(pre, [
      A.revoke(g),
      A.move("north-1", "hand-north", "stock", 0),
    ]);
    expect(Object.keys(s.post.grants)).toEqual([]);
    expect(reveal(s)).toEqual([g]);
  });

  it("a once grant created by the batch itself is never returned", () => {
    const pre = trickTakingState(def);
    const s = step(pre, [
      A.grant(hand("north"), KEYS, "east", ONCE),
      A.move("north-1", "hand-north", "stock", 0),
    ]);
    expect(Object.keys(s.post.grants)).toHaveLength(1);
    expect(reveal(s)).toEqual([]);
  });

  it("a non-once grant is never returned", () => {
    const pre = trickTakingState(def, [
      A.grant(hand("north"), KEYS, "east"),
      A.grant(hand("north"), KEYS, "east", { kind: "until_seq", n: 1000 }),
    ]);
    expect(
      reveal(step(pre, [A.move("north-1", "hand-north", "stock", 0)])),
    ).toEqual([]);
  });

  it("two grants come back in ascending id order; the grantee restriction filters by seat", () => {
    const pre = trickTakingState(def, [
      A.grant(hand("north"), KEYS, "west", ONCE),
      A.grant(hand("north"), KEYS, "east", ONCE),
      A.grant(hand("south"), KEYS, "east", ONCE),
    ]);
    const [gWest, gEast] = Object.keys(pre.grants) as GrantId[];
    const s = step(pre, [A.move("north-1", "hand-north", "stock", 0)]);
    expect(reveal(s)).toEqual([gWest, gEast]);
    expect(reveal(s, "east")).toEqual([gEast]);
    expect(reveal(s, "west")).toEqual([gWest]);
    expect(reveal(s, "north")).toEqual([]);
    expect(reveal(s, "south")).toEqual([]);
  });

  it("a team or all_seated grantee reveals when any seat of the set would learn something", () => {
    const pre = trickTakingState(def, [
      A.grant(hand("north"), KEYS, "team:ew", ONCE),
      A.grant(hand("south"), KEYS, "all_seated", ONCE),
    ]);
    const [gTeam, gAll] = Object.keys(pre.grants) as GrantId[];
    const s = step(pre, [A.move("north-1", "hand-north", "stock", 0)]);
    expect(reveal(s)).toEqual([gTeam]);
    expect(reveal(s, "west")).toEqual([gTeam]);
    expect(reveal(s, "north")).toEqual([]);
    const t = step(pre, [A.move("south-1", "hand-south", "stock", 0)]);
    expect(reveal(t)).toEqual([gAll]);
    expect(reveal(t, "east")).toEqual([gAll]);
  });

  it("redundant grants: removing one of two identical grants changes nothing", () => {
    const pre = trickTakingState(def, [
      A.grant(hand("north"), KEYS, "east", ONCE),
      A.grant(hand("north"), KEYS, "east", ONCE),
    ]);
    const s = step(pre, [A.move("north-1", "hand-north", "stock", 0)]);
    expect(reveal(s)).toEqual([]);
  });

  it("a grant whose information the grantee already has reveals nothing", () => {
    // east is statically entitled to the public discard, so a grant on it adds nothing
    const pre = trickTakingState(def, [
      A.grant(
        { kind: "zone", zone_id: "discard" },
        ["zone_membership"],
        "east",
        ONCE,
      ),
    ]);
    expect(reveal(step(pre, [A.flip("d1", "face_down")]))).toEqual([]);
  });

  it("is pure and a mismatched batch yields []", () => {
    const { pre, g } = withOnce();
    const s = step(pre, [A.move("north-1", "hand-north", "stock", 0)]);
    expect(reveal(s)).toEqual([g]);
    expect(reveal(s)).toEqual([g]);
    expect(Object.isFrozen(pre)).toBe(true);
    const other = step(s.post, [A.flip("d1", "face_up")]);
    expect(wouldReveal(def, s.pre, other.post, s.batch)).toEqual([]);
  });
});

describe("VC-333 consumption round trip", () => {
  it("consuming the flagged grant keeps the reveal in the delta and removes it from later views", () => {
    const pre = trickTakingState(def, [
      A.grant(
        { kind: "card", card_id: "north-1" },
        ["card_face"],
        "east",
        ONCE,
      ),
    ]);
    const g = Object.keys(pre.grants)[0] as GrantId;
    const east = { role: "player", subject: seat("east") };
    const probe = step(pre, [A.move("north-1", "hand-north", "stock", 0)]);
    expect(reveal(probe)).toEqual([g]);

    const s = step(pre, [
      A.move("north-1", "hand-north", "stock", 0),
      engine("grant_consume", { grant_id: g }),
    ]);
    expect(s.post.grants[g]).toBeUndefined();
    const d = must(projectDelta(def, s.pre, s.post, s.batch, east));
    const move = d.entries.find((e) => e.kind === "move");
    expect(move).toMatchObject({ card_id: "north-1" });
    expect(move?.kind === "move" && move.face?.metadata).toMatchObject({
      suit: "hearts",
    });
    expect(d.grants).toEqual({ [g]: null });

    const view = must(projectView(def, s.post, east));
    expect(view.grants).toEqual({});
    expect(view.zones["hand-north" as never]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("north-2");
    // nothing left to consume: the next batch reveals nothing
    expect(
      reveal(step(s.post, [A.move("north-2", "hand-north", "stock", 0)])),
    ).toEqual([]);
  });
});
