import { describe, expect, it } from "vitest";
import type { CompiledGameDefinition } from "../definition/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import {
  defaultRosterReducer,
  engine,
  mergeReducer,
  rosterOp,
} from "../session/apply/reducers.testing.js";
import { gateId, grantId, zoneId } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import {
  buildTrickTakingDefinition,
  trickTakingState,
} from "./fixtures.testing.js";
import { projectView } from "./project-view.js";
import type { View } from "./types.js";
import { seat } from "./visibility.testing.js";

const VIEW_KEYS = ["card_face", "zone_membership", "zone_count", "zone_order"];

function build(
  overrides: Partial<CompiledGameDefinition> = {},
): CompiledGameDefinition {
  const base = buildTrickTakingDefinition();
  return buildTrickTakingDefinition({
    viewKeys: VIEW_KEYS,
    rosterReducer: defaultRosterReducer,
    metaSchemas: [
      {
        id: "scores",
        fields: { pub: "json", mine: "json", sec: "json", odd: "json" },
        reducerRef: "merge",
        fieldVisibility: {
          pub: "public",
          mine: "subject",
          sec: "secret",
          odd: "subject",
        },
        reducer: mergeReducer,
      },
      {
        id: "hiddenonly",
        fields: { sec: "json" },
        reducerRef: "merge",
        fieldVisibility: { sec: "secret" },
        reducer: mergeReducer,
      },
      ...base.metaSchemas.filter((m) => m.id === "notes"),
    ],
    ...overrides,
  });
}

const zid = (v: string) => must(zoneId(v));
const hand = (s: string) => ({ kind: "zone", zone_id: `hand-${s}` });
const card = (c: string) => ({ kind: "card", card_id: c });
const sit = (def: CompiledGameDefinition, extra: readonly Action[] = []) =>
  trickTakingState(def, extra);

function viewOf(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  role: string,
  subject?: string,
): View {
  return must(
    projectView(def, state, {
      role,
      ...(subject !== undefined ? { subject: seat(subject) } : {}),
    }),
  );
}
const members = (v: View, zone: string) =>
  v.zones[zid(zone)]?.members?.map((m) => String(m.id));

function withAuditor(d: CompiledGameDefinition): CompiledGameDefinition {
  return {
    ...d,
    zones: d.zones.map((z) =>
      z.id.startsWith("hand-")
        ? { ...z, visibility: { ...z.visibility, auditor: "public" } }
        : z,
    ),
  };
}

describe("VC-312 grant parts", () => {
  const def = build();
  it("a zone_membership grant on a hidden ordered zone lists members sorted, orderKnown false", () => {
    const s = sit(def, [
      A.grant({ kind: "zone", zone_id: "stock" }, ["zone_membership"], "east"),
    ]);
    const z = viewOf(def, s, "player", "east").zones[zid("stock")]!;
    expect(z.ordered).toBe(true);
    expect(z.members!.map((m) => m.id)).toEqual(["k1", "k2", "k3"]);
    expect(z.orderKnown).toBe(false);
    expect(z.count).toBeUndefined();
    expect(z.members!.every((m) => m.face === undefined)).toBe(true);
    expect(viewOf(def, s, "player", "south").zones[zid("stock")]).toBe(
      undefined,
    );
  });
  it("a zone card_face grant alone lists no member (found by VC-340/341, Iteration 7)", () => {
    const s = sit(def, [
      A.grant({ kind: "zone", zone_id: "stock" }, ["card_face"], "east"),
    ]);
    const east = viewOf(def, s, "player", "east");
    expect(east.zones[zid("stock")]).toBe(undefined);
    expect(JSON.stringify(east)).not.toContain('"k1"');
    // With membership too, the faces arrive.
    const both = sit(def, [
      A.grant(
        { kind: "zone", zone_id: "stock" },
        ["card_face", "zone_membership"],
        "east",
      ),
    ]);
    const z = viewOf(def, both, "player", "east").zones[zid("stock")]!;
    expect(z.members!.every((m) => m.face !== undefined)).toBe(true);
  });
  it("a zone_count grant alone gives count only", () => {
    const s = sit(def, [
      A.grant({ kind: "zone", zone_id: "stock" }, ["zone_count"], "east"),
    ]);
    const z = viewOf(def, s, "player", "east").zones[zid("stock")]!;
    expect(z).toEqual({ ordered: true, count: 3 });
  });
  it("zone_order adds order only together with membership; alone it has no effect", () => {
    const only = sit(def, [
      A.grant({ kind: "zone", zone_id: "stock" }, ["zone_order"], "east"),
    ]);
    expect(viewOf(def, only, "player", "east").zones[zid("stock")]).toBe(
      undefined,
    );
    const both = sit(def, [
      A.grant(
        { kind: "zone", zone_id: "stock" },
        ["zone_membership", "zone_order"],
        "east",
      ),
    ]);
    const z = viewOf(def, both, "player", "east").zones[zid("stock")]!;
    expect(z.orderKnown).toBe(true);
    expect(z.members!.map((m) => m.id)).toEqual(["k1", "k2", "k3"]);
  });
});

describe("VC-319 grants", () => {
  const def = build();
  it("a card_face grant shows that card's face, not the rest of the hand", () => {
    const s = sit(def, [A.grant(card("north-1"), ["card_face"], "east")]);
    const v = viewOf(def, s, "player", "east");
    const z = v.zones[zid("hand-north")]!;
    expect(z.members).toHaveLength(1);
    expect(z.members![0]!.id).toBe("north-1");
    expect(z.members![0]!.face?.type).toBe("playing");
    expect(z.count).toBeUndefined();
    expect(z.orderKnown).toBe(false);
    expect(viewOf(def, s, "player", "south").zones[zid("hand-north")]).toBe(
      undefined,
    );
    expect(members(viewOf(def, s, "render"), "hand-north")).toBe(undefined);
  });
  it("a grant adds to a public zone: face-down card gains its face", () => {
    const s = sit(def, [A.grant(card("t2"), ["card_face"], "east")]);
    const t = viewOf(def, s, "player", "east").zones[zid("trick")]!;
    expect(t.members![1]!.face).toBeDefined();
    expect(t.members![0]!.face).toBeDefined();
    const other = viewOf(def, s, "player", "south").zones[zid("trick")]!;
    expect(other.members![1]!.face).toBeUndefined();
  });
  it("a zone grant covers all four keys of the zone", () => {
    const s = sit(def, [A.grant(hand("north"), VIEW_KEYS, "east")]);
    const z = viewOf(def, s, "player", "east").zones[zid("hand-north")]!;
    expect(z.count).toBe(2);
    expect(z.orderKnown).toBe(true);
    expect(z.members!.every((m) => m.face !== undefined)).toBe(true);
  });
  it("all_seated expands to seated seats only", () => {
    const s = sit(def, [
      rosterOp("set_status", { seat_id: "west", status: "sitting_out" }),
      A.grant(card("north-1"), ["card_face"], "all_seated"),
    ]);
    for (const who of ["north", "east", "south"]) {
      expect(
        members(viewOf(def, s, "player", who), "hand-north")?.includes(
          "north-1",
        ),
      ).toBe(true);
    }
    expect(viewOf(def, s, "player", "west").zones[zid("hand-north")]).toBe(
      undefined,
    );
    expect(viewOf(def, s, "player", "west").grants).toEqual({});
  });
  it("team:ns reaches north and south, not east", () => {
    const s = sit(def, [A.grant(card("north-1"), ["card_face"], "team:ns")]);
    expect(members(viewOf(def, s, "player", "south"), "hand-north")).toEqual([
      "north-1",
    ]);
    expect(
      viewOf(def, s, "player", "east").zones[zid("hand-north")],
    ).toBeUndefined();
  });
  it("until_seq(n) applies while state.seq < n", () => {
    const grantAction = A.grant(card("north-1"), ["card_face"], "east", {
      kind: "until_seq",
      n: 5,
    });
    const s1 = sit(def, [grantAction]); // seq 1
    const at = (seq: number): Snapshot<SessionState> => {
      let s = s1;
      while (s.seq < seq) {
        s = must(apply(def, s, [A.adjust("pot", 1n)])).state;
      }
      return s;
    };
    const shown = (s: Snapshot<SessionState>) =>
      viewOf(def, s, "player", "east").zones[zid("hand-north")] !== undefined;
    expect(at(4).seq).toBe(4);
    expect(shown(at(4))).toBe(true);
    expect(at(5).seq).toBe(5);
    expect(shown(at(5))).toBe(false);
  });
  it("revoke_view removes the grant", () => {
    const s = sit(def, [A.grant(card("north-1"), ["card_face"], "east")]);
    const id = Object.keys(s.grants)[0]!;
    expect(
      viewOf(def, s, "player", "east").zones[zid("hand-north")],
    ).toBeDefined();
    const r = must(apply(def, s, [A.revoke(id)])).state;
    expect(viewOf(def, r, "player", "east").zones[zid("hand-north")]).toBe(
      undefined,
    );
  });
  it("top target follows the card at position 0; an empty zone has no effect", () => {
    const grant = A.grant(
      { kind: "top", zone_id: "stock" },
      ["card_face"],
      "east",
    );
    const s = sit(def, [grant]);
    const top = viewOf(def, s, "player", "east").zones[zid("stock")]!;
    expect(top.members!.map((m) => m.id)).toEqual(["k1"]);
    expect(top.members![0]!.face).toBeDefined();
    const moved = must(
      apply(def, s, [A.move("k1", "stock", "discard", 0)]),
    ).state;
    const next = viewOf(def, moved, "player", "east").zones[zid("stock")]!;
    expect(next.members!.map((m) => m.id)).toEqual(["k2"]);
    let empty = moved;
    for (const c of ["k2", "k3"]) {
      empty = must(apply(def, empty, [A.move(c, "stock", "discard", 0)])).state;
    }
    expect(viewOf(def, empty, "player", "east").zones[zid("stock")]).toBe(
      undefined,
    );
  });
  it("a grant to a dealer/auditor/subject-less viewer never applies", () => {
    const d = withAuditor(build());
    const reg = {
      ...d,
      zones: d.zones.map((z) =>
        z.id === "stock"
          ? { ...z, visibility: { ...z.visibility, dealer: "hidden" } }
          : z,
      ),
    } as CompiledGameDefinition;
    const grants = [
      A.grant(card("north-1"), ["card_face"], "all_seated"),
      A.grant({ kind: "zone", zone_id: "stock" }, VIEW_KEYS, "all_seated"),
    ];
    const withG = sit(reg, grants);
    const without = sit(reg);
    // dealer: identical view with and without grants (grants omitted from both)
    const dv = viewOf(reg, withG, "dealer");
    const dw = viewOf(reg, without, "dealer");
    expect({ ...dv, grants: {} }).toEqual(dw);
    expect(dv.zones[zid("stock")]).toBeUndefined();
    // subject-less render never gets a grant
    expect(viewOf(reg, withG, "render").zones[zid("stock")]).toBeUndefined();
    expect(viewOf(reg, withG, "render").grants).toEqual({});
  });
  it("a grantee name in grants of dealer is never visible to dealer", () => {
    const d = build();
    const reg = {
      ...d,
      zones: d.zones.map((z) =>
        z.id === "trick"
          ? { ...z, visibility: { ...z.visibility, dealer: "public" } }
          : z,
      ),
    } as CompiledGameDefinition;
    const s = sit(reg, [A.grant(card("north-1"), ["card_face"], "north")]);
    expect(viewOf(reg, s, "dealer").grants).toEqual({});
    expect(viewOf(reg, s, "dealer").zones[zid("hand-north")]).toBeUndefined();
  });
  it("zone_order on a card target changes nothing", () => {
    const base = sit(def);
    const s = sit(def, [A.grant(card("north-1"), ["zone_order"], "east")]);
    const a = viewOf(def, base, "player", "east");
    const b = viewOf(def, s, "player", "east");
    expect({ ...b, grants: {}, seq: 0 }).toEqual({ ...a, grants: {}, seq: 0 });
  });
  it("grants never subtract: a statically visible zone stays fully visible", () => {
    const s = sit(def, [A.grant(card("north-1"), ["card_face"], "north")]);
    const v = viewOf(def, s, "player", "north").zones[zid("hand-north")]!;
    expect(v.count).toBe(2);
    expect(v.members).toHaveLength(2);
  });
});

describe("VC-320 grant visibility", () => {
  it("lists a grant for its grantee and a statically entitled role, not for others", () => {
    const def = withAuditor(build());
    const s = sit(def, [
      A.flip("north-1", "face_up"),
      A.grant(card("north-1"), ["card_face"], "east"),
    ]);
    const id = must(grantId(Object.keys(s.grants)[0]!));
    const east = viewOf(def, s, "player", "east").grants[id]!;
    expect(east).toEqual({
      target: { kind: "card", card_id: "north-1" },
      keys: ["card_face"],
      grantee: "east",
      scope: { kind: "until_revoked" },
    });
    expect(viewOf(def, s, "auditor").grants[id]).toBeDefined();
    expect(viewOf(def, s, "player", "north").grants[id]).toBeDefined(); // owner of the hand
    expect(viewOf(def, s, "player", "south").grants[id]).toBeUndefined();
    expect(viewOf(def, s, "render").grants[id]).toBeUndefined();
  });
  it("a face-down card in an auditor-public hand is not statically face-entitled", () => {
    const def = withAuditor(build());
    const s = sit(def, [A.grant(card("north-1"), ["card_face"], "east")]);
    const id = must(grantId(Object.keys(s.grants)[0]!));
    expect(viewOf(def, s, "auditor").grants[id]).toBeUndefined();
  });
  it("a team grantee sees the grant; a key without meaning is listed only to grantees", () => {
    const def = build();
    const s = sit(def, [A.grant(card("north-1"), ["zone_order"], "team:ew")]);
    const id = must(grantId(Object.keys(s.grants)[0]!));
    expect(viewOf(def, s, "player", "west").grants[id]).toBeDefined();
    expect(viewOf(def, s, "player", "north").grants[id]).toBeUndefined();
  });
});

describe("VC-317 meta partitions", () => {
  const def = build();
  const withMeta = (d: CompiledGameDefinition) =>
    sit(d, [
      {
        kind: "meta",
        schema_id: "scores",
        payload: {
          pub: "open",
          mine: { north: 3, east: 5 },
          sec: "top",
          odd: 42,
        },
      },
      { kind: "meta", schema_id: "hiddenonly", payload: { sec: "z" } },
    ]);
  it("player sees public and its own subject entry", () => {
    const v = viewOf(def, withMeta(def), "player", "north");
    expect(v.meta).toEqual({ scores: { mine: { north: 3 }, pub: "open" } });
    expect(Object.keys(v.meta)).toEqual(["scores"]);
  });
  it("a viewer without an entry gets no subject field; render sees public only", () => {
    const s = withMeta(def);
    expect(viewOf(def, s, "player", "south").meta).toEqual({
      scores: { pub: "open" },
    });
    expect(viewOf(def, s, "render").meta).toEqual({ scores: { pub: "open" } });
  });
  it("a registered auditor sees all entries and the secret; wrongly shaped subject fields are omitted", () => {
    const d = withAuditor(def);
    const v = viewOf(d, withMeta(d), "auditor");
    expect(v.meta).toEqual({
      hiddenonly: { sec: "z" },
      scores: { mine: { east: 5, north: 3 }, pub: "open", sec: "top" },
    });
  });
  it("a partition with no visible field is absent", () => {
    const s = withMeta(def);
    expect(viewOf(def, s, "player", "north").meta.hiddenonly).toBeUndefined();
    expect(viewOf(def, sit(def), "player", "north").meta).toEqual({});
  });
});

describe("VC-318 gates", () => {
  const def = withAuditor(build());
  const open = engine("gate_open", {
    gate_id: "g1",
    schema_id: "pass3",
    expected_seats: ["north", "east"],
  });
  const submit = (who: string, payload: string) =>
    engine("gate_submit", { gate_id: "g1", seat: who, payload });
  const g1 = must(gateId("g1"));
  it("masks open gates and shows the own submission; the auditor sees all", () => {
    const s = sit(def, [open, submit("north", "N-secret")]);
    const east = viewOf(def, s, "player", "east").gates.open[g1]!;
    expect(east).toEqual({
      schemaId: "pass3",
      expectedSeats: ["north", "east"],
      submitted: ["north"],
    });
    expect(JSON.stringify(viewOf(def, s, "player", "east"))).not.toContain(
      "N-secret",
    );
    expect(viewOf(def, s, "player", "north").gates.open[g1]).toEqual({
      schemaId: "pass3",
      expectedSeats: ["north", "east"],
      submitted: ["north"],
      submissions: { north: "N-secret" },
    });
    expect(viewOf(def, s, "auditor").gates.open[g1]!.submissions).toEqual({
      north: "N-secret",
    });
    expect(JSON.stringify(viewOf(def, s, "render"))).not.toContain("N-secret");
  });
  it("a resolved gate has no submitted list; own/auditor submissions only", () => {
    const s = sit(def, [
      open,
      submit("north", "N-secret"),
      submit("east", "E-secret"),
      engine("gate_resolve", { gate_id: "g1" }),
    ]);
    expect(viewOf(def, s, "player", "east").gates.open).toEqual({});
    expect(viewOf(def, s, "player", "east").gates.resolved[g1]).toEqual({
      schemaId: "pass3",
      expectedSeats: ["north", "east"],
      submissions: { east: "E-secret" },
    });
    expect(viewOf(def, s, "player", "south").gates.resolved[g1]).toEqual({
      schemaId: "pass3",
      expectedSeats: ["north", "east"],
    });
    expect(viewOf(def, s, "auditor").gates.resolved[g1]!.submissions).toEqual({
      east: "E-secret",
      north: "N-secret",
    });
    expect(JSON.stringify(viewOf(def, s, "render"))).not.toContain("secret");
  });
});

describe("VC-305 spectator projection", () => {
  const def = buildTrickTakingDefinition({
    roles: [{ id: "spectator", subject: "forbidden" }],
    zones: buildTrickTakingDefinition().zones.map((z) =>
      z.id === "discard" ? { ...z, visibility: { spectator: "public" } } : z,
    ),
  });
  const s = sit(def);
  it("shows the discard with face-up faces and no hand", () => {
    const v = viewOf(def, s, "spectator");
    expect(Object.keys(v.zones).filter((z) => z.startsWith("hand-"))).toEqual(
      [],
    );
    expect(Object.keys(v.zones)).toContain("discard");
    expect(v.zones[zid("discard")]!.members![0]!.face).toBeDefined();
  });
  it("rejects a subject", () => {
    const r = projectView(def, s, {
      role: "spectator",
      subject: seat("north"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SUBJECT_NOT_ALLOWED");
  });
});

describe("VC-321 with grants, meta and gates", () => {
  it("is plain JSON, deterministic and leaves the state untouched", () => {
    const def = build();
    const s = sit(def, [
      A.grant(card("north-1"), ["card_face"], "east"),
      engine("gate_open", {
        gate_id: "g1",
        schema_id: "p",
        expected_seats: ["north"],
      }),
      { kind: "meta", schema_id: "scores", payload: { pub: 1 } },
    ]);
    const v = viewOf(def, s, "player", "east");
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    expect(viewOf(def, s, "player", "east")).toEqual(v);
  });
});
