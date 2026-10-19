import { describe, expect, it } from "vitest";
import { buildDefinition } from "../../definition/definition.testing.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import { stateDigest } from "../../replay/canonical/index.js";
import { A, actionsText } from "../actions.testing.js";
import type { Action } from "../actions.js";
import { seatId, teamId, zoneId } from "../ids.js";
import { nextZoneId } from "../zone-ids.js";
import type { Snapshot } from "../snapshot.js";
import { variant } from "../state.testing.js";
import type { RosterEntry, SessionState } from "../state.js";
import { apply } from "./index.js";
import { errorOf, must, startState } from "./apply.testing.js";

const sid = (v: string) => must(seatId(v));
const def = buildDefinition();
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
const malformed = (state: Snapshot<SessionState>, ...batch: Action[]) => {
  const e = errorOf(run(state, batch));
  expect(e.code).toBe("MALFORMED_ACTION");
  expect(e.actionIndex).toBe(batch.length - 1);
  return e;
};

describe("VC-037 control_set (KBR-008)", () => {
  it("sets a phase inside the set, and changes only the named fields", () => {
    const s = next(start, A.controlSet({ phase: "end" }));
    expect(s.control).toEqual({ ...start.control, phase: "end" });
    expect(s.control.activeSeats).toBe(start.control.activeSeats);
    expect(s.zones).toBe(start.zones);
  });

  it("KBR-008: rejects a phase outside the set, an unknown seat, direction 0", () => {
    expect(malformed(start, A.controlSet({ phase: "nope" })).detail).toContain(
      "nope",
    );
    expect(
      malformed(start, A.controlSet({ activeSeats: ["ghost"] })).detail,
    ).toContain("ghost");
    expect(
      malformed(
        start,
        A.controlSet({ pointer: { name: "dealer", seat: "ghost" } }),
      ).detail,
    ).toContain("ghost");
    expect(
      errorOf(run(start, [{ kind: "control_set", direction: 0 } as never]))
        .code,
    ).toBe("MALFORMED_ACTION");
  });

  it("sets active seats, direction and a pointer independently", () => {
    let s = next(start, A.controlSet({ activeSeats: ["s2", "s1"] }));
    expect(s.control.activeSeats).toEqual([sid("s2"), sid("s1")]);
    expect(s.control.direction).toBe(1);
    s = next(s, A.controlSet({ direction: -1 }));
    expect(s.control.direction).toBe(-1);
    expect(s.control.activeSeats).toEqual([sid("s2"), sid("s1")]);
    s = next(s, A.controlSet({ pointer: { name: "dealer", seat: "s2" } }));
    expect(s.control.pointers).toEqual({ dealer: sid("s2") });
    expect(s.control.direction).toBe(-1);
    s = next(s, A.controlSet({ pointer: { name: "button", seat: "s1" } }));
    expect(s.control.pointers).toEqual({
      dealer: sid("s2"),
      button: sid("s1"),
    });
    expect(
      next(start, A.controlSet({ activeSeats: [] })).control.activeSeats,
    ).toEqual([]);
  });
});

describe("VC-038 control_advance", () => {
  const abc = ["A", "B", "C"].map((id) => ({ id: sid(id) }));
  const d3 = buildDefinition({
    seats: abc,
    teams: [],
    control: {
      ...def.control,
      turnOrder: abc.map((s) => s.id),
      initialActiveSeats: [sid("A")],
    },
  });
  const roster3: RosterEntry[] = abc.map((s) => ({ seat: s.id }));
  const base = startState(d3, roster3);
  const sittingOut = variant(base, (d) => {
    d.roster.seats[sid("B")] = { status: "sitting_out" };
  });
  const adv = (s: Snapshot<SessionState>, ...batch: Action[]) =>
    run(s, batch, d3);
  const active = (s: Snapshot<SessionState>, ...batch: Action[]) =>
    must(adv(s, ...batch)).state.control.activeSeats;

  it("counts only seated seats and wraps", () => {
    expect(active(sittingOut, A.advance(1))).toEqual([sid("C")]);
    expect(active(sittingOut, A.advance(2))).toEqual([sid("A")]); // wraps, start counts after wrap
    expect(active(sittingOut, A.advance(3))).toEqual([sid("C")]);
    expect(active(base, A.advance(1))).toEqual([sid("B")]);
    expect(active(base, A.advance(3))).toEqual([sid("A")]);
  });

  it("honours direction -1", () => {
    const back = variant(sittingOut, (d) => {
      d.control.direction = -1;
    });
    expect(active(back, A.advance(1))).toEqual([sid("C")]);
    expect(active(back, A.advance(2))).toEqual([sid("A")]);
    const backAll = variant(base, (d) => {
      d.control.direction = -1;
    });
    expect(active(backAll, A.advance(1))).toEqual([sid("C")]);
  });

  it("handles huge step counts by lap arithmetic", () => {
    expect(active(base, A.advance(Number.MAX_SAFE_INTEGER))).toHaveLength(1);
    expect(active(base, A.advance(4))).toEqual([sid("B")]);
  });

  it("a named pointer moves only that pointer", () => {
    const withButton = variant(sittingOut, (d) => {
      d.control.pointers = { button: sid("A") };
    });
    const s = must(adv(withButton, A.advance(1, "button"))).state;
    expect(s.control.pointers).toEqual({ button: sid("C") });
    expect(s.control.activeSeats).toBe(withButton.control.activeSeats);
  });

  it("missing pointer, empty active_seats, no seated seat -> MALFORMED_ACTION", () => {
    expect(errorOf(adv(base, A.advance(1, "button"))).code).toBe(
      "MALFORMED_ACTION",
    );
    const empty = variant(base, (d) => {
      d.control.activeSeats = [];
    });
    expect(errorOf(adv(empty, A.advance(1))).code).toBe("MALFORMED_ACTION");
    const none = variant(base, (d) => {
      for (const seat of Object.values(d.roster.seats))
        seat.status = "eliminated";
    });
    expect(errorOf(adv(none, A.advance(1))).code).toBe("MALFORMED_ACTION");
  });

  it("mode until_quiescent and steps 0 -> MALFORMED_ACTION", () => {
    const e = errorOf(
      adv(base, { kind: "control_advance", steps: 1, mode: "until_quiescent" }),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.path).toBe("$[0].mode");
    expect(errorOf(adv(base, A.advance(0))).code).toBe("MALFORMED_ACTION");
  });

  it("a cursor seat missing from the turn order -> MALFORMED_ACTION", () => {
    const odd = variant(base, (d) => {
      d.control.pointers = { button: sid("Z") };
    });
    expect(errorOf(adv(odd, A.advance(1, "button"))).detail).toContain("Z");
  });
});

describe("VC-041 zone_create / zone_destroy ids, ordinals and limits", () => {
  const d2 = buildDefinition({
    zoneTemplates: [
      { name: "hand", ownerRule: "seat", ordered: false, maxInstances: 2 },
      { name: "pile", ownerRule: "none", ordered: true, maxInstances: 2 },
    ],
  });
  const s0 = startState(d2);
  const go = (s: Snapshot<SessionState>, ...b: Action[]) => run(s, b, d2);

  it("derives <template>/<owner>/<ordinal>, enforces max_instances, never reuses ordinals", () => {
    const a = must(go(s0, A.zoneCreate("hand", "s1")));
    expect(a.committed[0]).toMatchObject({
      kind: "zone_create",
      zone_id: "hand/s1/1",
    });
    expect(a.state.zones["hand/s1/1" as never]).toEqual({
      template: "hand",
      owner: sid("s1"),
      members: [],
    });
    expect(a.state.zoneOrdinals).toEqual({ "hand/s1": 1 });
    const b = must(go(a.state, A.zoneCreate("hand", "s1"))).state;
    expect(Object.keys(b.zones)).toContain("hand/s1/2");
    const limit = errorOf(go(b, A.zoneCreate("hand", "s1")));
    expect(limit.code).toBe("ZONE_LIMIT");
    expect(limit.detail).toContain("hand");
    const c = must(go(b, A.zoneDestroy("hand/s1/1"))).state;
    expect(c.zoneOrdinals).toEqual({ "hand/s1": 2 });
    const d = must(go(c, A.zoneCreate("hand", "s1"))).state;
    expect(Object.keys(d.zones)).toContain("hand/s1/3");
    expect(Object.keys(d.zones)).not.toContain("hand/s1/1");
    expect(d.zoneOrdinals).toEqual({ "hand/s1": 3 });
  });

  it("KBR-006: ZONE_LIMIT within one batch leaves the input untouched", () => {
    const before = stateDigest(d2, s0);
    const e = errorOf(
      go(s0, A.zoneCreate("pile"), A.zoneCreate("pile"), A.zoneCreate("pile")),
    );
    expect(e.code).toBe("ZONE_LIMIT");
    expect(e.actionIndex).toBe(2);
    expect(stateDigest(d2, s0)).toBe(before);
  });

  it("KBR-006: destroys template zones only when empty", () => {
    const filled = next(
      must(go(s0, A.zoneCreate("pile"))).state,
      A.move("c1", "deck", "pile/_/1", 0),
    );
    expect(malformed(filled, A.zoneDestroy("pile/_/1")).detail).toContain(
      "pile/_/1",
    );
    const emptied = next(filled, A.move("c1", "pile/_/1", "deck", 0));
    expect(
      Object.keys(next(emptied, A.zoneDestroy("pile/_/1")).zones),
    ).not.toContain("pile/_/1");
  });
});

describe("VC-042 zone_create ids, owners and destroy failures", () => {
  it("zone_id: a different one is rejected, the derived one accepted", () => {
    expect(malformed(start, A.zoneCreate("hand", "s1", "hand/s1/2")).path).toBe(
      "$[0].zone_id",
    );
    expect(
      malformed(start, A.zoneCreate("hand", "s1", "other")).detail,
    ).toContain("other");
    const r = must(run(start, [A.zoneCreate("hand", "s1", "hand/s1/1")]));
    expect(r.committed[0]).toMatchObject({ zone_id: "hand/s1/1" });
  });

  it("KBR-006: a derived id over 128 characters is rejected", () => {
    const longSeat = "x".repeat(126);
    const dl = buildDefinition({
      seats: [{ id: sid(longSeat), team: must(teamId("t1")) }],
      teams: [must(teamId("t1"))],
      control: {
        ...def.control,
        turnOrder: [sid(longSeat)],
        initialActiveSeats: [sid(longSeat)],
      },
    });
    const sl = startState(dl, [
      { seat: sid(longSeat), team: must(teamId("t1")) },
    ]);
    const e = errorOf(run(sl, [A.zoneCreate("hand", longSeat)], dl));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("128");
    // the same template with a short owner is fine; exactly 128 is fine
    const ok128 = "y".repeat(128 - "hand//1".length);
    const d128 = buildDefinition({
      seats: [{ id: sid(ok128), team: must(teamId("t1")) }],
      teams: [must(teamId("t1"))],
      control: {
        ...def.control,
        turnOrder: [sid(ok128)],
        initialActiveSeats: [sid(ok128)],
      },
    });
    const s128 = startState(d128, [
      { seat: sid(ok128), team: must(teamId("t1")) },
    ]);
    expect(run(s128, [A.zoneCreate("hand", ok128)], d128).ok).toBe(true);
  });

  it("KBR-006: a derived id equal to an existing zone id is rejected", () => {
    const dc = buildDefinition({
      zones: [{ id: must(zoneId("pile/_/1")), ordered: true }, ...def.zones],
    });
    const e = errorOf(run(startState(dc), [A.zoneCreate("pile")], dc));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("pile/_/1");
  });

  it("distinct (template, owner) pairs derive distinct ids", () => {
    const dd = buildDefinition({
      zoneTemplates: [
        { name: "a", ownerRule: "seat", ordered: false, maxInstances: 5 },
        { name: "a-b", ownerRule: "seat", ordered: false, maxInstances: 5 },
      ],
    });
    const s = startState(dd);
    const r = must(
      run(
        s,
        [
          A.zoneCreate("a", "s1"),
          A.zoneCreate("a", "s2"),
          A.zoneCreate("a-b", "s1"),
        ],
        dd,
      ),
    );
    expect(new Set(Object.keys(r.state.zones)).size).toBe(
      Object.keys(s.zones).length + 3,
    );
  });

  it("zone_destroy of a non-empty zone, a non-template zone, an unknown zone", () => {
    expect(malformed(start, A.zoneDestroy("deck")).detail).toContain("deck");
    expect(malformed(start, A.zoneDestroy("table")).detail).toContain(
      "template",
    );
    expect(malformed(start, A.zoneDestroy("ghost")).detail).toContain("ghost");
  });

  it("none-rule template: no owner, ownerless zone, `_` token", () => {
    const s = next(start, A.zoneCreate("pile"));
    expect(s.zones["pile/_/1" as never]).toEqual({
      template: "pile",
      members: [],
    });
    expect("owner" in (s.zones["pile/_/1" as never] ?? {})).toBe(false);
    expect(s.zoneOrdinals).toEqual({ "pile/_": 1 });
    expect(malformed(start, A.zoneCreate("pile", "s1")).path).toBe(
      "$[0].owner",
    );
  });

  it("seat-rule template: owner required and must be in the layout; unknown template", () => {
    expect(malformed(start, A.zoneCreate("hand")).path).toBe("$[0].owner");
    expect(malformed(start, A.zoneCreate("hand", "ghost")).detail).toContain(
      "ghost",
    );
    expect(malformed(start, A.zoneCreate("nope", "s1")).detail).toContain(
      "nope",
    );
  });

  it("team- and player-rule owners", () => {
    const dt = buildDefinition({
      zoneTemplates: [
        { name: "tz", ownerRule: "team", ordered: false, maxInstances: 5 },
        { name: "pz", ownerRule: "player", ordered: false, maxInstances: 5 },
      ],
    });
    const s = startState(dt);
    const t = must(
      run(s, [A.zoneCreate("tz", "t1"), A.zoneCreate("pz", "p1")], dt),
    ).state;
    expect(t.zones["tz/t1/1" as never]?.owner).toBe("t1");
    expect(t.zones["pz/p1/1" as never]?.owner).toBe("p1");
    expect(errorOf(run(s, [A.zoneCreate("tz", "ghost")], dt)).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(errorOf(run(s, [A.zoneCreate("pz", "p9")], dt)).code).toBe(
      "MALFORMED_ACTION",
    );
  });
});

describe("VC-050 nextZoneId", () => {
  it("returns the id the following zone_create produces", () => {
    const owner = sid("s1");
    expect(nextZoneId(start, "hand", owner)).toBe("hand/s1/1");
    expect(nextZoneId(start, "hand", owner, 1)).toBe("hand/s1/2");
    expect(nextZoneId(start, "pile")).toBe("pile/_/1");
    const made = must(run(start, [A.zoneCreate("pile")]));
    expect(made.committed[0]).toMatchObject({
      zone_id: nextZoneId(start, "pile"),
    });
    expect(nextZoneId(made.state, "pile")).toBe("pile/_/2");
  });

  it("a later move into a pending id in the same batch succeeds", () => {
    const d = buildDefinition({
      zoneTemplates: [
        { name: "pile", ownerRule: "none", ordered: true, maxInstances: 4 },
      ],
    });
    const s = startState(d);
    const second = nextZoneId(s, "pile", undefined, 1);
    const r = must(
      run(
        s,
        [
          A.zoneCreate("pile"),
          A.zoneCreate("pile"),
          A.move("c1", "deck", second, 0),
        ],
        d,
      ),
    );
    expect(r.state.zones[nextZoneId(s, "pile", undefined, 1)]?.members).toEqual(
      ["c1"],
    );
    expect(r.state.zones[nextZoneId(s, "pile", undefined, 0)]?.members).toEqual(
      [],
    );
    expect(r.state.cards["c1" as never]?.zone).toBe("pile/_/2");
  });
});

const target = { kind: "card", card_id: "c1" } as const;

describe("VC-043 grant_view / revoke_view", () => {
  it("stores each target shape and scope kind as given, under grant/<seq+1>/<i>", () => {
    const r = must(
      run(start, [
        A.grant(target, ["hand"], "s1", { kind: "until_revoked" }),
        A.grant(
          { kind: "zone", zone_id: "deck" },
          ["hand", "public"],
          "all_seated",
          { kind: "once" },
        ),
        A.grant({ kind: "top", zone_id: "deck" }, ["public"], "team:t2", {
          kind: "until_seq",
          n: 1,
        }),
      ]),
    );
    expect(Object.keys(r.state.grants)).toEqual([
      "grant/1/0",
      "grant/1/1",
      "grant/1/2",
    ]);
    expect(r.state.grants["grant/1/0" as never]).toEqual({
      target,
      keys: ["hand"],
      grantee: "s1",
      scope: { kind: "until_revoked" },
    });
    expect(r.state.grants["grant/1/1" as never]?.scope).toEqual({
      kind: "once",
    });
    expect(r.state.grants["grant/1/2" as never]?.target).toEqual({
      kind: "top",
      zone_id: "deck",
    });
    expect(r.state.grants["grant/1/2" as never]?.scope).toEqual({
      kind: "until_seq",
      n: 1,
    });
    expect(
      r.committed.map((a) => (a.kind === "grant_view" ? a.grant_id : "")),
    ).toEqual(["grant/1/0", "grant/1/1", "grant/1/2"]);
  });

  it("the id uses the committed position; replaying the committed batch gives the same ids", () => {
    const s5 = variant(start, (d) => {
      d.seq = 5 as never;
    });
    const batch = [
      A.move("c1", "deck", "table"),
      A.move("c2", "deck", "table"),
      A.grant(target, ["hand"], "s1"),
      A.grant(target, ["public"], "s2"),
    ];
    const live = must(run(s5, batch));
    expect(Object.keys(live.state.grants)).toEqual(["grant/6/2", "grant/6/3"]);
    const replay = must(run(s5, [...live.committed]));
    expect(Object.keys(replay.state.grants)).toEqual([
      "grant/6/2",
      "grant/6/3",
    ]);
    expect(actionsText(replay.committed)).toBe(actionsText(live.committed));
    expect(stateDigest(def, replay.state)).toBe(stateDigest(def, live.state));
  });

  it("a supplied grant_id must equal the derived one", () => {
    expect(
      malformed(start, {
        ...A.grant(target, ["hand"], "s1"),
        grant_id: "grant/9/9" as never,
      }).path,
    ).toBe("$[0].grant_id");
  });

  const bad: readonly [string, Action][] = [
    ["grantee dealer", A.grant(target, ["hand"], "dealer")],
    ["grantee auditor", A.grant(target, ["hand"], "auditor")],
    ["unknown seat", A.grant(target, ["hand"], "ghost")],
    ["unknown team", A.grant(target, ["hand"], "team:ghost")],
    ["key outside viewKeys", A.grant(target, ["secret"], "s1")],
    ["empty keys", A.grant(target, [], "s1")],
    ["duplicate keys", A.grant(target, ["hand", "hand"], "s1")],
    [
      "top on an unordered zone",
      A.grant({ kind: "top", zone_id: "table" }, ["hand"], "s1"),
    ],
    [
      "range target",
      A.grant(
        { kind: "range", zone_id: "deck", from: 0, to: 2 },
        ["hand"],
        "s1",
      ),
    ],
    [
      "filter target",
      A.grant({ kind: "filter", zone_id: "deck" }, ["hand"], "s1"),
    ],
    [
      "target with extra field",
      A.grant({ ...target, extra: 1 }, ["hand"], "s1"),
    ],
    ["target not an object", A.grant("c1", ["hand"], "s1")],
    [
      "unknown card",
      A.grant({ kind: "card", card_id: "ghost" }, ["hand"], "s1"),
    ],
    [
      "unknown zone",
      A.grant({ kind: "zone", zone_id: "ghost" }, ["hand"], "s1"),
    ],
    [
      "until_seq below seq+1",
      A.grant(target, ["hand"], "s1", { kind: "until_seq", n: 0 }),
    ],
    [
      "until_seq with a float-like",
      A.grant(target, ["hand"], "s1", { kind: "until_seq" }),
    ],
    [
      "unknown scope kind",
      A.grant(target, ["hand"], "s1", { kind: "forever" }),
    ],
    [
      "scope with extra field",
      A.grant(target, ["hand"], "s1", { kind: "once", n: 1 }),
    ],
    ["scope not an object", A.grant(target, ["hand"], "s1", "once")],
  ];
  it.each(bad)("rejects %s with MALFORMED_ACTION", (_name, action) => {
    const e = errorOf(run(start, [A.move("c3", "deck", "table"), action]));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.actionIndex).toBe(1);
  });

  it("until_seq n = seq+1 is accepted", () => {
    expect(
      next(start, A.grant(target, ["hand"], "s1", { kind: "until_seq", n: 1 }))
        .grants,
    ).toBeDefined();
  });

  it("revoke_view removes an existing grant and rejects an unknown id", () => {
    const g = next(start, A.grant(target, ["hand"], "s1"));
    const gone = next(g, A.revoke("grant/1/0"));
    expect(Object.keys(gone.grants)).toEqual([]);
    expect(malformed(g, A.revoke("grant/9/9")).detail).toContain("grant/9/9");
    expect(malformed(gone, A.revoke("grant/1/0")).detail).toContain(
      "grant/1/0",
    );
    // grant and revoke in one batch
    const both = must(
      run(start, [A.grant(target, ["hand"], "s1"), A.revoke("grant/1/0")]),
    );
    expect(Object.keys(both.state.grants)).toEqual([]);
  });
});

describe("VC-044 delegations", () => {
  it("delegate then revoke_delegation of (S, P)", () => {
    const d = next(
      start,
      A.delegate("s1", "alice", { scope: { x: 1 }, boundary: "turn" }),
    );
    expect(d.delegations).toEqual([
      { seat: "s1", principal: "alice", scope: { x: 1 }, boundary: "turn" },
    ]);
    expect(next(d, A.revokeDelegation("s1", "alice")).delegations).toEqual([]);
    expect(next(start, A.delegate("s1", "alice")).delegations).toEqual([
      { seat: "s1", principal: "alice" },
    ]);
  });

  it("revoking (S, P1) leaves (S, P2)", () => {
    const d = next(start, A.delegate("s1", "p1"), A.delegate("s1", "p2"));
    expect(d.delegations.map((x) => x.principal)).toEqual(["p1", "p2"]);
    expect(next(d, A.revokeDelegation("s1", "p1")).delegations).toEqual([
      { seat: "s1", principal: "p2" },
    ]);
    // the same principal on another seat is a different delegation
    expect(next(d, A.delegate("s2", "p1")).delegations).toHaveLength(3);
  });

  it("duplicate, absent pair, unknown seat, empty and over-long principals", () => {
    const d = next(start, A.delegate("s1", "alice"));
    expect(malformed(d, A.delegate("s1", "alice")).detail).toContain("alice");
    expect(
      malformed(start, A.revokeDelegation("s1", "alice")).detail,
    ).toContain("alice");
    expect(malformed(start, A.delegate("ghost", "alice")).detail).toContain(
      "ghost",
    );
    expect(
      malformed(start, A.revokeDelegation("ghost", "alice")).detail,
    ).toContain("ghost");
    expect(errorOf(run(start, [A.delegate("s1", "")])).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(errorOf(run(start, [A.delegate("s1", "é".repeat(129))])).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(run(start, [A.delegate("s1", "é".repeat(128))]).ok).toBe(true);
  });

  it("a delegation stays attached to its seat when the player changes", () => {
    const d = next(start, A.delegate("s1", "alice"));
    const swapped = variant(d, (x) => {
      x.roster.seats[sid("s1")] = { status: "seated", player: "p9" as never };
    });
    expect(swapped.delegations).toEqual([{ seat: "s1", principal: "alice" }]);
    expect(
      next(swapped, A.revokeDelegation("s1", "alice")).delegations,
    ).toEqual([]);
  });

  it("untouched partitions keep their references", () => {
    const d = next(start, A.delegate("s1", "alice"));
    expect(d.cards).toBe(start.cards);
    expect(d.roster).toBe(start.roster);
  });
});
