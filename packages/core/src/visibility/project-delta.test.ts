import { describe, expect, it } from "vitest";
import type { CompiledGameDefinition } from "../definition/types.js";
import type { Transaction } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import {
  defaultRosterReducer,
  engine,
  mergeReducer,
} from "../session/apply/reducers.testing.js";
import { gateId, zoneId } from "../session/ids.js";
import type { Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import {
  buildTrickTakingDefinition,
  trickTakingState,
} from "./fixtures.testing.js";
import { projectDelta, projectLogEntry } from "./project-delta.js";
import { sealBatch } from "./privileged-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import type { Delta, ViewerIdentity } from "./types.js";
import { seat } from "./visibility.testing.js";

const VIEW_KEYS = ["card_face", "zone_membership", "zone_count", "zone_order"];

function build(
  overrides: Partial<CompiledGameDefinition> = {},
): CompiledGameDefinition {
  return buildTrickTakingDefinition({
    viewKeys: VIEW_KEYS,
    rosterReducer: defaultRosterReducer,
    metaSchemas: [
      {
        id: "scores",
        fields: { pub: "json", sec: "json" },
        reducerRef: "merge",
        fieldVisibility: { pub: "public", sec: "secret" },
        reducer: mergeReducer,
      },
    ],
    zoneTemplates: [
      {
        name: "pile",
        ownerRule: "none",
        ordered: false,
        maxInstances: 3,
        visibility: { default: "public" },
      },
      {
        name: "vault",
        ownerRule: "none",
        ordered: false,
        maxInstances: 3,
        visibility: { default: "hidden" },
      },
    ],
    ...overrides,
  });
}

/** Auditor and dealer registered with public access to hands, stock and trick. */
function withPrivileged(d: CompiledGameDefinition): CompiledGameDefinition {
  return {
    ...d,
    zones: d.zones.map((z) =>
      z.id.startsWith("hand-") || z.id === "stock" || z.id === "trick"
        ? {
            ...z,
            visibility: {
              ...z.visibility,
              auditor: "public",
              dealer: "public",
            },
          }
        : z,
    ),
  };
}

interface Step {
  readonly pre: Snapshot<SessionState>;
  readonly post: Snapshot<SessionState>;
  readonly batch: PrivilegedBatch;
  readonly tx: Transaction;
}

let counter = 0;
function step(
  def: CompiledGameDefinition,
  pre: Snapshot<SessionState>,
  actions: readonly Action[],
): Step {
  const out = must(apply(def, pre, actions));
  counter += 1;
  const tx = {
    seq: out.state.seq,
    eventId: `EVENT-ID-${String(counter)}-zq`,
    principal: `PRINCIPAL-${String(counter)}-zq`,
    actions: out.committed,
  } as Transaction;
  return { pre, post: out.state, batch: sealBatch(tx), tx };
}

const viewer = (role: string, subject?: string): ViewerIdentity =>
  subject === undefined ? { role } : { role, subject: seat(subject) };

function delta(def: CompiledGameDefinition, s: Step, v: ViewerIdentity): Delta {
  return must(projectDelta(def, s.pre, s.post, s.batch, v));
}

const zid = (v: string) => must(zoneId(v));
const gid = (v: string) => must(gateId(v));
const json = (d: Delta): string => JSON.stringify(d);

describe("VC-325 move from a hidden zone into an owner hand", () => {
  const def = build();
  const s = step(def, trickTakingState(def), [
    A.move("k1", "stock", "hand-north"),
  ]);

  it("the owner sees card, destination and face but not the hidden source", () => {
    const d = delta(def, s, viewer("player", "north"));
    expect(d.seq).toBe(s.post.seq);
    expect(d.entries).toHaveLength(1);
    const e = d.entries[0]!;
    expect(e).toMatchObject({
      i: 0,
      kind: "move",
      card_id: "k1",
      to_zone: "hand-north",
    });
    expect("from_zone" in e).toBe(false);
    expect(e.kind === "move" && e.face?.metadata).toEqual({
      own: 7,
      suit: "hearts",
    });
    expect(d.zoneCounts).toEqual({ [zid("hand-north")]: 3 });
    expect(d.counters).toEqual({ stock_size: "2" });
  });

  it("another seat and render get no entry and no counts of the hidden zones", () => {
    for (const v of [
      viewer("player", "east"),
      viewer("render"),
      viewer("render", "east"),
    ]) {
      const d = delta(def, s, v);
      expect(d.entries).toEqual([]);
      expect(d.zoneCounts).toEqual({});
      expect(d.counters).toEqual({ stock_size: "2" });
    }
  });
});

describe("VC-326 move from a hand to the public discard", () => {
  const def = build();
  const s = step(def, trickTakingState(def), [
    A.flip("north-1", "face_up"),
    A.move("north-1", "hand-north", "discard", 0),
  ]);

  it("a non-owner sees destination, card and face; no source", () => {
    const d = delta(def, s, viewer("player", "east"));
    const move = d.entries.find((e) => e.kind === "move")!;
    expect(move).toMatchObject({
      i: 1,
      kind: "move",
      card_id: "north-1",
      to_zone: "discard",
      to_position: 0,
    });
    expect("from_zone" in move).toBe(false);
    expect("from_position" in move).toBe(false);
    expect(move.kind === "move" && move.face?.type).toBe("playing");
    expect(d.zoneCounts).toEqual({ [zid("discard")]: 2 });
  });

  it("the owner sees both endpoints; position only for the ordered zone", () => {
    const d = delta(def, s, viewer("player", "north"));
    const move = d.entries.find((e) => e.kind === "move")!;
    expect(move).toMatchObject({
      from_zone: "hand-north",
      to_zone: "discard",
      to_position: 0,
    });
    expect("from_position" in move).toBe(false); // hand is unordered
    expect(d.zoneCounts).toEqual({
      [zid("hand-north")]: 1,
      [zid("discard")]: 2,
    });
  });

  it("from_position appears when the ordered source is order-entitled", () => {
    const s2 = step(def, trickTakingState(def), [
      A.move("t2", "trick", "discard", 1),
    ]);
    const d = delta(def, s2, viewer("player", "south"));
    expect(d.entries[0]).toMatchObject({
      from_zone: "trick",
      to_zone: "discard",
      from_position: 1,
      to_position: 1,
    });
  });
});

describe("VC-327 flip, set_metadata, zone_create/zone_destroy", () => {
  const def = withPrivileged(build());
  const base = trickTakingState(def);

  it("flip: membership-entitled viewers get it, others do not; face per PFR-013", () => {
    const up = step(def, base, [A.flip("north-1", "face_up")]);
    expect(delta(def, up, viewer("player", "east")).entries).toEqual([]);
    const own = delta(def, up, viewer("player", "north")).entries[0]!;
    expect(own).toMatchObject({
      kind: "flip",
      card_id: "north-1",
      orientation: "face_up",
    });
    expect(own.kind === "flip" && own.face !== undefined).toBe(true);

    const pub = step(def, base, [A.flip("t2", "face_up")]);
    const seen = delta(def, pub, viewer("player", "east")).entries[0]!;
    expect(seen.kind === "flip" && seen.face?.metadata).toEqual({
      own: 7,
      suit: "hearts",
    });

    const down = step(def, base, [A.flip("t1", "face_down")]);
    const hidden = delta(def, down, viewer("render")).entries[0]!;
    expect(hidden).toMatchObject({
      kind: "flip",
      card_id: "t1",
      orientation: "face_down",
    });
    expect("face" in hidden).toBe(false);
  });

  it("set_metadata: only visible fields; a secret-only change never reaches a player", () => {
    const secretOnly = step(def, base, [
      A.setMetadata("t1", { key: "NEW-SECRET" }),
    ]);
    for (const v of [
      viewer("player", "east"),
      viewer("render"),
      viewer("player", "north"),
    ]) {
      const d = delta(def, secretOnly, v);
      expect(d.entries).toEqual([]);
      expect(json(d)).not.toContain("NEW-SECRET");
    }
    const mixed = step(def, base, [
      A.setMetadata("t1", { suit: "spades", key: "S2", extra: "e" }),
    ]);
    expect(delta(def, mixed, viewer("player", "east")).entries[0]).toEqual({
      i: 0,
      kind: "set_metadata",
      card_id: "t1",
      fields: { suit: "spades" },
    });
    const aud = delta(def, mixed, viewer("auditor")).entries[0]!;
    expect(aud.kind === "set_metadata" && aud.fields).toEqual({
      suit: "spades",
      key: "S2",
    });
    // hidden card: no entry for another seat even with a public field
    const hand = step(def, base, [A.setMetadata("north-1", { suit: "clubs" })]);
    expect(delta(def, hand, viewer("player", "east")).entries).toEqual([]);
    expect(delta(def, hand, viewer("player", "north")).entries).toHaveLength(1);
  });

  it("zone_create and zone_destroy follow the template rule", () => {
    const created = step(def, base, [
      A.zoneCreate("pile"),
      A.zoneCreate("vault"),
    ]);
    const east = delta(def, created, viewer("player", "east"));
    expect(east.entries).toEqual([
      { i: 0, kind: "zone_create", zone_id: "pile/_/1" },
    ]);
    expect(east.zoneCounts).toEqual({ "pile/_/1": 0 });
    expect(delta(def, created, viewer("render")).entries).toHaveLength(1);
    const destroyed = step(def, created.post, [
      A.zoneDestroy("pile/_/1"),
      A.zoneDestroy("vault/_/1"),
    ]);
    expect(delta(def, destroyed, viewer("player", "east")).entries).toEqual([
      { i: 0, kind: "zone_destroy", zone_id: "pile/_/1" },
    ]);
  });
});

describe("VC-328 redacted shuffle", () => {
  const def = withPrivileged(build());
  const base = trickTakingState(def);

  it("a hidden stock yields no entry for a player and a permutation for a registered auditor", () => {
    const s = step(def, base, [A.shuffle("stock", ["k3", "k1", "k2"])]);
    expect(delta(def, s, viewer("player", "north")).entries).toEqual([]);
    expect(json(delta(def, s, viewer("player", "north")))).not.toContain("k3");
    expect(delta(def, s, viewer("auditor")).entries).toEqual([
      { i: 0, kind: "shuffle", zone: "stock", permutation: ["k3", "k1", "k2"] },
    ]);
  });

  it("a public ordered zone shows the permutation", () => {
    const s = step(def, base, [A.shuffle("trick", ["t2", "t1"])]);
    expect(delta(def, s, viewer("render")).entries).toEqual([
      { i: 0, kind: "shuffle", zone: "trick", permutation: ["t2", "t1"] },
    ]);
  });

  it("a membership-only grant shows the zone without the permutation", () => {
    const granted = trickTakingState(def, [
      A.grant({ kind: "zone", zone_id: "stock" }, ["zone_membership"], "east"),
    ]);
    const s = step(def, granted, [A.shuffle("stock", ["k2", "k3", "k1"])]);
    expect(delta(def, s, viewer("player", "east")).entries).toEqual([
      { i: 0, kind: "shuffle", zone: "stock" },
    ]);
    expect(delta(def, s, viewer("player", "south")).entries).toEqual([]);
  });
});

describe("VC-329 counters and control", () => {
  const def = build();
  const base = trickTakingState(def);

  it("a transfer from public pot to hidden chips shows only the pot value", () => {
    const s = step(def, base, [A.transfer("pot", "chips-north", 0n)]);
    const noop = delta(def, s, viewer("player", "east"));
    expect(noop.counters).toEqual({});
    const funded = step(def, base, [A.adjust("pot", 50n)]);
    const withPot = step(def, funded.post, [
      A.transfer("pot", "chips-north", 20n),
    ]);
    const east = delta(def, withPot, viewer("player", "east"));
    expect(east.counters).toEqual({ pot: "30" });
    expect(json(east)).not.toContain("20");
    expect(json(east)).not.toContain("120");
    const north = delta(def, withPot, viewer("player", "north"));
    expect(north.counters).toEqual({ "chips-north": "120", pot: "30" });
    expect(json(north)).not.toContain("amount");
  });

  it("a control-only batch sets control and has no entries", () => {
    const s = step(def, base, [A.controlSet({ phase: "end" })]);
    const d = delta(def, s, viewer("player", "east"));
    expect(d.entries).toEqual([]);
    expect(d.control?.phase).toBe("end");
    expect(d.roster).toBeUndefined();
    const adv = step(def, base, [A.advance(1)]);
    expect(delta(def, adv, viewer("render")).control).toBeDefined();
  });

  it("lifecycle and outcome appear when changed; roster for changed seats", () => {
    const end = step(def, base, [A.lifecycle("completed", { winner: "ns" })]);
    const d = delta(def, end, viewer("render"));
    expect(d.lifecycle).toBe("completed");
    expect(d.outcome).toEqual({ winner: "ns" });
    const quiet = delta(
      def,
      step(def, base, [A.flip("north-1", "face_up")]),
      viewer("render"),
    );
    expect(quiet.lifecycle).toBeUndefined();
    expect(quiet.outcome).toBeUndefined();
    const sit = step(def, base, [
      {
        kind: "roster",
        op: "set_status",
        seat_id: seat("east"),
        status: "sitting_out",
      },
    ]);
    expect(delta(def, sit, viewer("player", "north")).roster).toEqual({
      east: { status: "sitting_out", team: "ew", player: "pe" },
    });
  });

  it("meta: changed partitions as projected; a secret-only change is invisible", () => {
    const pub = step(def, base, [
      { kind: "meta", schema_id: "scores", payload: { pub: 1 } },
    ]);
    expect(delta(def, pub, viewer("player", "east")).meta).toEqual({
      scores: { pub: 1 },
    });
    const sec = step(def, pub.post, [
      { kind: "meta", schema_id: "scores", payload: { sec: "SEC" } },
    ]);
    const d = delta(def, sec, viewer("player", "east"));
    expect(d.meta).toBeUndefined();
    expect(json(d)).not.toContain("SEC");
  });
});

describe("VC-330 grants and gates", () => {
  const def = withPrivileged(build());
  const base = trickTakingState(def);

  it("a grant-only batch: non-grantees get an empty delta, the grantee sees the grant", () => {
    const s = step(def, base, [
      A.grant({ kind: "card", card_id: "north-1" }, ["card_face"], "east"),
    ]);
    const south = delta(def, s, viewer("player", "south"));
    expect(south.entries).toEqual([]);
    expect(south.grants).toBeUndefined();
    expect(Object.keys(south)).toEqual([
      "seq",
      "entries",
      "zoneCounts",
      "counters",
    ]);
    const east = delta(def, s, viewer("player", "east"));
    expect(Object.keys(east.grants ?? {})).toHaveLength(1);
    expect(Object.values(east.grants!)[0]).toMatchObject({
      grantee: "east",
      keys: ["card_face"],
    });
  });

  it("a revoked grant is null for those who saw it", () => {
    const s0 = step(def, base, [
      A.grant({ kind: "card", card_id: "north-1" }, ["card_face"], "east"),
    ]);
    const id = Object.keys(s0.post.grants)[0]!;
    const s = step(def, s0.post, [A.revoke(id)]);
    expect(delta(def, s, viewer("player", "east")).grants).toEqual({
      [id]: null,
    });
    expect(delta(def, s, viewer("player", "south")).grants).toBeUndefined();
  });

  it("gate submit: no payload for non-entitled viewers; own and auditor see theirs", () => {
    const opened = step(def, base, [
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "pass3",
        expected_seats: ["north", "east"],
      }),
    ]);
    expect(delta(def, opened, viewer("player", "south")).gates).toEqual({
      g1: {
        schemaId: "pass3",
        expectedSeats: ["north", "east"],
        submitted: [],
      },
    });
    const sub = step(def, opened.post, [
      engine("gate_submit", {
        gate_id: "g1",
        seat: "north",
        payload: { pick: "CANARY-PAYLOAD" },
      }),
    ]);
    const east = delta(def, sub, viewer("player", "east"));
    expect(east.entries).toEqual([]);
    expect(east.gates).toEqual({
      g1: {
        schemaId: "pass3",
        expectedSeats: ["north", "east"],
        submitted: ["north"],
      },
    });
    for (const v of [
      viewer("player", "east"),
      viewer("render"),
      viewer("player", "south"),
    ]) {
      expect(json(delta(def, sub, v))).not.toContain("CANARY-PAYLOAD");
    }
    expect(
      delta(def, sub, viewer("player", "north")).gates![gid("g1")]!.submissions,
    ).toEqual({
      north: { pick: "CANARY-PAYLOAD" },
    });
    expect(
      delta(def, sub, viewer("auditor")).gates![gid("g1")]!.submissions,
    ).toEqual({
      north: { pick: "CANARY-PAYLOAD" },
    });
  });
});

describe("union of grants (PFR-023)", () => {
  const def = build();
  it("a once grant consumed by the batch still applies to its delta", () => {
    const pre = trickTakingState(def, [
      A.grant({ kind: "card", card_id: "north-1" }, ["card_face"], "east", {
        kind: "once",
      }),
    ]);
    const id = Object.keys(pre.grants)[0]!;
    const s = step(def, pre, [
      A.move("north-1", "hand-north", "stock", 0),
      engine("grant_consume", { grant_id: id }),
    ]);
    const d = delta(def, s, viewer("player", "east"));
    const e = d.entries[0]!;
    expect(e).toMatchObject({
      kind: "move",
      card_id: "north-1",
      from_zone: "hand-north",
    });
    expect(e.kind === "move" && e.face?.metadata).toEqual({
      own: 7,
      suit: "hearts",
    });
    expect(d.grants).toEqual({ [id]: null });
    // the grant is gone afterwards: a later view shows nothing of it
    expect(
      delta(
        def,
        step(def, s.post, [A.flip("t2", "face_up")]),
        viewer("player", "south"),
      ).entries,
    ).toHaveLength(1);
  });
});

describe("VC-331 projectLogEntry equals projectDelta", () => {
  const def = withPrivileged(build());
  it("for 30 random transactions and every viewer; never leaks ids", () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const viewers = [
      viewer("player", "north"),
      viewer("player", "east"),
      viewer("player", "south"),
      viewer("player", "west"),
      viewer("render"),
      viewer("render", "east"),
      viewer("auditor"),
      viewer("dealer"),
    ];
    const zones = [
      "hand-north",
      "hand-east",
      "hand-south",
      "hand-west",
      "trick",
      "discard",
      "stock",
    ];
    const orderedZone = new Set(["trick", "discard", "stock"]);
    let state = trickTakingState(def);
    for (let n = 0; n < 30; n++) {
      const cards = Object.keys(state.cards);
      const c = cards[rand(cards.length)]!;
      const from = state.cards[c as never]!.zone as string;
      const to = zones.filter((z) => z !== from)[rand(zones.length - 1)]!;
      const actions: Action[] = [
        A.move(c, from, to, orderedZone.has(to) ? 0 : undefined),
        ...(rand(2) === 0
          ? [A.flip(c, rand(2) === 0 ? "face_up" : "face_down")]
          : []),
        ...(rand(3) === 0 ? [A.adjust("pot", BigInt(1 + rand(5)))] : []),
      ];
      const s = step(def, state, actions);
      for (const v of viewers) {
        const a = projectDelta(def, s.pre, s.post, s.batch, v);
        const b = projectLogEntry(def, s.pre, s.post, s.batch, v);
        expect(b).toEqual(a);
        const text = JSON.stringify(a);
        expect(text).not.toContain(s.tx.eventId);
        expect(text).not.toContain(s.tx.principal);
        expect(text).not.toContain("EVENT-ID");
        expect(text).not.toContain("PRINCIPAL");
      }
      state = s.post;
    }
  });
});

describe("VC-334 invalid viewer, mismatched batch", () => {
  const def = build();
  const base = trickTakingState(def);
  const s = step(def, base, [A.flip("north-1", "face_up")]);

  it("returns the viewer errors and no value", () => {
    const cases: [ViewerIdentity, string][] = [
      [{ role: "wizard" }, "UNKNOWN_ROLE"],
      [{ role: "" }, "UNKNOWN_ROLE"],
      [{ role: "player" }, "UNKNOWN_SUBJECT"],
      [{ role: "player", subject: seat("ghost") }, "UNKNOWN_SUBJECT"],
      [{ role: "dealer", subject: seat("north") }, "SUBJECT_NOT_ALLOWED"],
      [{ role: "dealer" }, "VIEW_DENIED"],
      [{ role: "auditor" }, "VIEW_DENIED"],
    ];
    for (const [v, code] of cases) {
      for (const fn of [projectDelta, projectLogEntry]) {
        const r = fn(def, s.pre, s.post, s.batch, v);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe(code);
      }
    }
  });

  it("rejects a batch that does not match pre/post", () => {
    const wrongSeq = sealBatch({ ...s.tx, seq: 9 as Seq });
    const emptyBatch = sealBatch({ ...s.tx, seq: null, actions: [] });
    const bad: [
      Snapshot<SessionState>,
      Snapshot<SessionState>,
      PrivilegedBatch,
    ][] = [
      [s.pre, s.post, wrongSeq],
      [s.pre, s.post, emptyBatch],
      [s.post, s.post, s.batch],
      [s.post, s.pre, s.batch],
    ];
    for (const [pre, post, batch] of bad) {
      const r = projectDelta(def, pre, post, batch, viewer("render"));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("REPLAY_INVALID");
        expect(r.error.detail).toBe("batch does not match pre/post");
      }
    }
  });

  it("is deterministic, plain JSON and does not mutate its inputs", () => {
    const a = delta(def, s, viewer("player", "north"));
    const b = delta(def, s, viewer("player", "north"));
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(Object.keys(a)).toEqual([
      "seq",
      "entries",
      "zoneCounts",
      "counters",
    ]);
  });
});
