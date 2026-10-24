import { describe, expect, it } from "vitest";
import type {
  CompiledGameDefinition,
  CounterDecl,
  VisibilityRules,
} from "../definition/types.js";
import { errorOf, must } from "../session/apply/apply.testing.js";
import { A } from "../session/actions.testing.js";
import { apply } from "../session/apply/index.js";
import { counterId, zoneId } from "../session/ids.js";
import { isDeepFrozen } from "../session/snapshot.testing.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { stateDigest } from "../replay/canonical/index.js";
import { buildDefinition } from "../definition/definition.testing.js";
import { createSession } from "../session/create.js";
import { seatId, sessionId } from "../session/ids.js";
import {
  buildTrickTakingDefinition,
  TRICK_SEATS,
  trickTakingState,
} from "./fixtures.testing.js";
import { VIEW_SECTION_ORDER } from "./make-view.js";
import { projectView } from "./project-view.js";
import type { View } from "./types.js";
import { seat } from "./visibility.testing.js";

const def = buildTrickTakingDefinition();
const state = trickTakingState(def);

function viewOf(
  role: string,
  subject?: string,
  d: CompiledGameDefinition = def,
  s: Snapshot<SessionState> = state,
): View {
  return must(
    projectView(d, s, {
      role,
      ...(subject !== undefined ? { subject: seat(subject) } : {}),
    }),
  );
}
const ids = (v: View, zone: string) =>
  (v.zones[must(zoneId(zone))]?.members ?? []).map((m) => m.id as string);
const zoneKeys = (v: View) => Object.keys(v.zones);

/** Same definition with `auditor` entitled on every hand (registers the role). */
function withAuditor(): CompiledGameDefinition {
  return buildTrickTakingDefinition({
    zones: def.zones.map((z) =>
      z.id.startsWith("hand-")
        ? { ...z, visibility: { ...z.visibility, auditor: "public" } }
        : z,
    ),
  });
}

describe("VC-310 four-seat trick-taking projection", () => {
  const v = viewOf("player", "north");
  it("shows own hand ids with faces, no other hand, no stock", () => {
    expect(zoneKeys(v)).toEqual(["discard", "hand-north", "trick"]);
    expect(ids(v, "hand-north")).toEqual(["north-1", "north-2"]);
    for (const m of v.zones[must(zoneId("hand-north"))]!.members!) {
      expect(m.face?.type).toBe("playing");
    }
  });
  it("shows trick and discard faces only for face-up cards", () => {
    const trick = v.zones[must(zoneId("trick"))]!.members!;
    expect(
      trick.map((m) => [m.id, m.orientation, m.face !== undefined]),
    ).toEqual([
      ["t1", "face_up", true],
      ["t2", "face_down", false],
    ]);
    expect(v.zones[must(zoneId("discard"))]!.members![0]!.face).toBeDefined();
  });
  it("shows the public derived stock_size over the hidden stock", () => {
    expect(v.counters[must(counterId("stock_size"))]).toBe("3");
  });
});

describe("VC-311 orientation and faces", () => {
  it("lists a face-down public card by id and orientation only; flipping reveals the face", () => {
    const before = viewOf("render");
    const t2 = before.zones[must(zoneId("trick"))]!.members![1]!;
    expect(t2).toEqual({ id: "t2", orientation: "face_down" });
    const flipped = must(apply(def, state, [A.flip("t2", "face_up")])).state;
    const after = viewOf("render", undefined, def, flipped);
    expect(after.zones[must(zoneId("trick"))]!.members![1]!.face).toBeDefined();
  });
  it("shows a face-down card in an owner zone to the owner only", () => {
    const own = viewOf("player", "north").zones[must(zoneId("hand-north"))]!;
    expect(own.members![0]!.orientation).toBe("face_down");
    expect(own.members![0]!.face).toBeDefined();
    for (const other of ["east", "south", "west"]) {
      expect(viewOf("player", other).zones[must(zoneId("hand-north"))]).toBe(
        undefined,
      );
    }
  });
});

describe("VC-312 order (grant-free parts)", () => {
  it("lists an ordered public zone in zone order, an unordered one sorted by id", () => {
    const moved = must(
      apply(def, state, [A.move("d1", "discard", "trick", 0)]),
    ).state;
    expect(ids(viewOf("render", undefined, def, moved), "trick")).toEqual([
      "d1",
      "t1",
      "t2",
    ]);
    // unordered public zone: members given out of id order are sorted
    const unordered = buildTrickTakingDefinition({
      zones: def.zones.map((z) =>
        z.id === "trick" ? { ...z, ordered: false } : z,
      ),
    });
    const s = trickTakingState(unordered, [A.move("d1", "discard", "trick")]);
    expect(s.zones[must(zoneId("trick"))]!.members).toEqual(["t1", "t2", "d1"]);
    const v = viewOf("render", undefined, unordered, s);
    expect(ids(v, "trick")).toEqual(["d1", "t1", "t2"]);
    expect(v.zones[must(zoneId("trick"))]!.ordered).toBe(false);
  });
  it("marks entitled zones order-known and carries count and owner", () => {
    const v = viewOf("player", "north");
    expect(v.zones[must(zoneId("hand-north"))]).toMatchObject({
      ordered: false,
      owner: "north",
      count: 2,
      orderKnown: true,
    });
    expect(v.zones[must(zoneId("trick"))]).toMatchObject({
      ordered: true,
      count: 2,
      orderKnown: true,
    });
  });
});

describe("VC-313 metadata fields", () => {
  const face = (v: View, zone: string, i = 0) =>
    v.zones[must(zoneId(zone))]!.members![i]!.face;
  it("shows public always, subject with a subject, never secret or undeclared", () => {
    expect(face(viewOf("player", "north"), "hand-north")!.metadata).toEqual({
      own: 7,
      suit: "hearts",
    });
    expect(face(viewOf("render"), "discard")!.metadata).toEqual({
      suit: "hearts",
    });
    expect(face(viewOf("render", "east"), "discard")!.metadata).toEqual({
      own: 7,
      suit: "hearts",
    });
  });
  it("shows no metadata when no face is visible", () => {
    expect(face(viewOf("render"), "trick", 1)).toBeUndefined();
  });
  it("shows secret only to a registered auditor viewing a face", () => {
    const d = withAuditor();
    const s = trickTakingState(d, [A.flip("north-1", "face_up")]);
    const f = face(viewOf("auditor", undefined, d, s), "hand-north");
    expect(f!.metadata).toEqual({ key: "k-secret", suit: "hearts" });
    expect("extra" in f!.metadata).toBe(false);
    expect(JSON.stringify(viewOf("player", "north", d, s))).not.toContain(
      "k-secret",
    );
  });
});

describe("VC-314 stored counters", () => {
  it("shows public pot to every role, owner chips to the owner only", () => {
    for (const role of ["player", "render"]) {
      const v = viewOf(role, "east");
      expect(v.counters[must(counterId("pot"))]).toBe("0");
    }
    const north = viewOf("player", "north").counters;
    expect(north[must(counterId("chips-north"))]).toBe("100");
    expect(must(counterId("chips-east")) in north).toBe(false);
    expect(must(counterId("chips-north")) in viewOf("render").counters).toBe(
      false,
    );
    expect(Object.keys(viewOf("player", "east").counters)).toEqual([
      "chips-east",
      "pot",
      "stock_size",
    ]);
  });
  it("renders 10^30 exactly and hides a counter without visibility", () => {
    const big: CounterDecl[] = [
      {
        id: must(counterId("big")),
        owner: "table",
        visibility: { default: "public" },
        min: 0n,
        initial: 10n ** 30n,
      },
      {
        id: must(counterId("quiet")),
        owner: "table",
        visibility: {},
        min: 0n,
        initial: 1n,
      },
    ];
    const d = buildTrickTakingDefinition({ counters: big });
    const v = viewOf("render", undefined, d, trickTakingState(d));
    expect(v.counters).toEqual({ big: "1000000000000000000000000000000" });
  });
});

describe("VC-315 derived counters", () => {
  const derived = (
    zone: string,
    visibility: VisibilityRules,
    zoneVisibility?: VisibilityRules,
  ) => {
    const zid = must(zoneId(zone));
    const d = buildTrickTakingDefinition({
      zones:
        zoneVisibility === undefined
          ? def.zones
          : def.zones.map((z) =>
              z.id === zone ? { ...z, visibility: zoneVisibility } : z,
            ),
      counters: [
        {
          id: must(counterId("size")),
          owner: "table",
          visibility,
          min: 0n,
          initial: 0n,
          derived: (s) => BigInt(s.zones[zid]?.members.length ?? 0),
          derivedSpec: { kind: "zone_size", zone: zid },
        },
      ],
    });
    return { d, s: trickTakingState(d) };
  };
  const has = (
    d: CompiledGameDefinition,
    s: Snapshot<SessionState>,
    role: string,
    subject?: string,
  ) => "size" in viewOf(role, subject, d, s).counters;

  it("an explicit public declaration wins over a hidden stock", () => {
    const { d, s } = derived("stock", { default: "public" });
    expect(viewOf("player", "east", d, s).counters).toEqual({ size: "3" });
  });
  it("without a declaration inherits zone_count: public yes, hidden no", () => {
    const pub = derived("trick", {});
    expect(has(pub.d, pub.s, "render")).toBe(true);
    const hid = derived("stock", {});
    expect(has(hid.d, hid.s, "player", "north")).toBe(false);
  });
  it("without a declaration over an owner zone is visible only to the owner", () => {
    const { d, s } = derived("hand-north", {});
    expect(has(d, s, "player", "north")).toBe(true);
    expect(has(d, s, "player", "east")).toBe(false);
    expect(has(d, s, "render")).toBe(false);
  });
});

describe("VC-316 engine sections", () => {
  it("are present for render and player; delegations and session id never appear", () => {
    for (const v of [viewOf("render"), viewOf("player", "south")]) {
      expect(v.seq).toBe(1);
      expect(v.lifecycle).toBe("active");
      expect(v.control.phase).toBe("play");
      expect(v.control.activeSeats).toEqual(["north"]);
      expect(Object.keys(v.roster)).toEqual(["east", "north", "south", "west"]);
      expect(v.roster[seat("north")]).toEqual({
        status: "seated",
        team: "ns",
        player: "pn",
      });
      const text = JSON.stringify(v);
      expect(text).not.toContain("delegations");
      expect(text).not.toContain("sess-1");
    }
  });
  it("carries the outcome once the session ended", () => {
    const ended = must(
      apply(def, state, [
        { kind: "lifecycle", to_state: "completed", outcome: { winner: "ns" } },
      ]),
    ).state;
    const v = viewOf("render", undefined, def, ended);
    expect(v.lifecycle).toBe("completed");
    expect(v.outcome).toEqual({ winner: "ns" });
    expect("outcome" in viewOf("render")).toBe(false);
  });
});

describe("VC-321 plain, deterministic, pure", () => {
  const viewers: [string, string?][] = [
    ["player", "north"],
    ["player", "east"],
    ["render"],
    ["render", "south"],
  ];
  it("round-trips through JSON, keeps counters as strings and the section order", () => {
    for (const [role, subject] of viewers) {
      const v = viewOf(role, subject);
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      for (const c of Object.values(v.counters))
        expect(typeof c).toBe("string");
      expect(Object.keys(v)).toEqual(
        VIEW_SECTION_ORDER.filter((k) => k !== "outcome"),
      );
      expect(viewOf(role, subject)).toEqual(v);
    }
  });
  it("does not mutate or alias the input state", () => {
    const digest = stateDigest(def, state);
    const v = viewOf("player", "north");
    expect(isDeepFrozen(state)).toBe(true);
    expect(stateDigest(def, state)).toBe(digest);
    expect(isDeepFrozen(v)).toBe(false);
  });
  it("returns the PFR-002..005 errors and no value for an invalid viewer", () => {
    expect(errorOf(projectView(def, state, { role: "wizard" })).code).toBe(
      "UNKNOWN_ROLE",
    );
    expect(errorOf(projectView(def, state, { role: "dealer" })).code).toBe(
      "VIEW_DENIED",
    );
  });
});

describe("VC-322 empty fixture", () => {
  it("projects empty zones, counters, meta and grants", () => {
    const d = buildDefinition({
      cards: [],
      zones: [],
      zoneTemplates: [],
      counters: [],
      conservationGroups: [],
      metaSchemas: [],
      seats: [{ id: must(seatId("only")) }],
      teams: [],
      control: {
        ...buildDefinition().control,
        turnOrder: [must(seatId("only"))],
        initialActiveSeats: [must(seatId("only"))],
      },
    });
    const s = must(
      createSession(d, must(sessionId("sess-e")), [
        { seat: must(seatId("only")) },
      ]),
    );
    const v = must(projectView(d, s, { role: "render" }));
    expect(v.zones).toEqual({});
    expect(v.counters).toEqual({});
    expect(v.meta).toEqual({});
    expect(v.grants).toEqual({});
    expect(v.gates).toEqual({ open: {}, resolved: {} });
  });
});

describe("VC-377 (first sentence) no id aliasing", () => {
  it("entitled viewers see the real card ids of every zone they may list", () => {
    for (const s of TRICK_SEATS) {
      const v = viewOf("player", s);
      expect(ids(v, `hand-${s}`)).toEqual([`${s}-1`, `${s}-2`]);
      expect(ids(v, "trick")).toEqual(["t1", "t2"]);
      expect(ids(v, "discard")).toEqual(["d1"]);
    }
    expect(ids(viewOf("render"), "trick")).toEqual(["t1", "t2"]);
  });
});
