import { describe, expect, it } from "vitest";
import {
  buildDefinition,
  buildFloorDefinition,
} from "../../definition/definition.testing.js";
import { definitionData } from "../../definition/data.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import { createSession } from "../../session/create.js";
import {
  cardId,
  counterId,
  gateId,
  grantId,
  seatId,
  sessionId,
  zoneId,
} from "../../session/ids.js";
import type { CardId, ZoneId } from "../../session/ids.js";
import { cloneData, variant } from "../../session/state.testing.js";
import type { Snapshot } from "../../session/snapshot.js";
import type { SessionState } from "../../session/state.js";
import { canonicalize } from "./canonicalize.js";
import { definitionIdentitySchema } from "./definition-schema.js";
import { canonicalStateBytes, stateDigest } from "./state-schema.js";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const s1 = must(seatId("s1"));
const s2 = must(seatId("s2"));
const z = (v: string): ZoneId => must(zoneId(v));
const c = (v: string): CardId => must(cardId(v));
const roster = [{ seat: s1 }, { seat: s2 }];

/** Derived counter `total` = number of cards face up (reads card orientation). */
const faceUp = (s: Snapshot<SessionState>): bigint =>
  BigInt(
    Object.values(s.cards).filter((x) => x.orientation === "face_up").length,
  );

const def: CompiledGameDefinition = (() => {
  const base = buildDefinition();
  return buildDefinition({
    counters: base.counters.map((k) =>
      k.derived === undefined ? k : { ...k, derived: faceUp },
    ),
  });
})();
const initial = must(createSession(def, must(sessionId("d1")), roster));

describe("VC-058 derived counters", () => {
  it("are recomputed, absent from counters, and serialised right after counters", () => {
    const flipped = variant(initial, (d) => {
      d.cards[c("c1")]!.orientation = "face_up";
      d.cards[c("c2")]!.orientation = "face_up";
    });
    expect(Object.keys(initial.counters)).toEqual(["pot", "bank"]);
    expect("total" in flipped.counters).toBe(false);
    const before = text(canonicalStateBytes(def, initial));
    const after = text(canonicalStateBytes(def, flipped));
    expect(before).toContain('"derivedCounters":[["total","0"]]');
    expect(after).toContain('"derivedCounters":[["total","2"]]');
    const counters = after.indexOf('"counters":');
    const derived = after.indexOf('"derivedCounters":');
    const meta = after.indexOf('"meta":');
    expect(counters).toBeGreaterThan(-1);
    expect(derived).toBeGreaterThan(counters);
    expect(meta).toBeGreaterThan(derived);
    expect(after.slice(counters, derived)).toBe(
      '"counters":[["bank","100"],["pot","0"]],',
    );
    expect(stateDigest(def, flipped)).not.toBe(stateDigest(def, initial));
  });
  it("a misbehaving evaluator is a plain Error", () => {
    const bad = buildDefinition({
      counters: [
        {
          id: must(counterId("d")),
          owner: "table",
          visibility: {},
          min: 0n,
          initial: 0n,
          derived: () => 1 as unknown as bigint,
        },
      ],
      conservationGroups: [],
    });
    const s = must(createSession(bad, must(sessionId("x")), roster));
    expect(() => stateDigest(bad, s)).toThrow(/non-bigint/);
    const throwing = buildDefinition({
      counters: [
        {
          id: must(counterId("d")),
          owner: "table",
          visibility: {},
          min: 0n,
          initial: 0n,
          derived: () => {
            throw new RangeError("boom");
          },
        },
      ],
      conservationGroups: [],
    });
    expect(() => stateDigest(throwing, s)).toThrow(/evaluator threw/);
  });
});

describe("digest basics", () => {
  it("is 64 lower-case hex chars, deterministic and excludes the id", () => {
    const d = stateDigest(def, initial);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(stateDigest(def, initial)).toBe(d);
    const rekeyed = must(createSession(def, must(sessionId("other")), roster));
    expect(stateDigest(def, rekeyed)).toBe(d);
  });
  it("does not serialise the id", () => {
    expect(text(canonicalStateBytes(def, initial))).not.toContain("d1");
  });
  it("VC-084 floor definition: createSession ok and digest computed", () => {
    const floor = buildFloorDefinition();
    const r = createSession(
      floor,
      must(sessionId("floor")),
      floor.seats.map((s) => ({
        seat: s.id,
        ...(s.team ? { team: s.team } : {}),
      })),
    );
    const s = must(r);
    expect(Object.keys(s.cards)).toHaveLength(700);
    expect(Object.keys(s.zones)).toHaveLength(64);
    expect(stateDigest(floor, s)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("VC-062 insertion order does not matter", () => {
  it("different key insertion orders give identical bytes and digest", () => {
    const a = variant(initial, (d) => {
      d.counters[must(counterId("zeta"))] = 1n;
      d.counters[must(counterId("alpha"))] = 2n;
    });
    const rev = cloneData(a) as {
      counters: Record<string, bigint>;
      cards: Record<string, unknown>;
    };
    const counters = Object.entries(rev.counters).reverse();
    rev.counters = Object.fromEntries(counters);
    rev.cards = Object.fromEntries(Object.entries(rev.cards).reverse());
    const b = Object.freeze(rev) as unknown as Snapshot<SessionState>;
    // the definition does not declare alpha/zeta; they are plain idMap keys
    expect(Object.keys(b.counters)).not.toEqual(Object.keys(a.counters));
    expect(text(canonicalStateBytes(def, a))).toBe(
      text(canonicalStateBytes(def, b)),
    );
    expect(stateDigest(def, a)).toBe(stateDigest(def, b));
  });
});

describe("VC-063 digest changes with each field", () => {
  const base = stateDigest(def, initial);
  const gate = (d: { gates: SessionState["gates"] }) => d;
  void gate;
  const withGate = variant(initial, (d) => {
    d.gates.open[must(gateId("g1"))] = {
      schemaId: "bid",
      expectedSeats: [s1, s2],
      submissions: {},
    };
    d.gates.resolved[must(gateId("g0"))] = {
      schemaId: "old",
      expectedSeats: [s1],
      submissions: { [s1]: 1 },
    };
  });
  const withDeck = variant(initial, (d) => {
    d.zones[z("deck")]!.members = [c("c1"), c("c2"), c("c3")];
  });

  const cases: [string, Snapshot<SessionState>, CompiledGameDefinition?][] = [
    [
      "lifecycle",
      variant(initial, (d) => {
        d.lifecycle = "completed";
      }),
    ],
    [
      "seq",
      variant(initial, (d) => {
        d.seq = 1 as SessionState["seq"];
      }),
    ],
    [
      "card orientation",
      variant(initial, (d) => {
        d.cards[c("c1")]!.orientation = "face_up";
      }),
    ],
    [
      "card metadata",
      variant(initial, (d) => {
        d.cards[c("c1")]!.metadata = { rank: 3 };
      }),
    ],
    [
      "zone order",
      variant(withDeck, (d) => {
        d.zones[z("deck")]!.members = [c("c3"), c("c2"), c("c1")];
      }),
    ],
    [
      "zone membership",
      variant(initial, (d) => {
        d.zones[z("deck")]!.members.pop();
      }),
    ],
    [
      "zone ordinal",
      variant(initial, (d) => {
        d.zoneOrdinals["hand/s1"] = 1;
      }),
    ],
    [
      "stored counter",
      variant(initial, (d) => {
        d.counters[must(counterId("pot"))] = 5n;
      }),
    ],
    [
      "meta",
      variant(initial, (d) => {
        d.meta["notes"] = { text: "hi" };
      }),
    ],
    [
      "roster",
      variant(initial, (d) => {
        d.roster.seats[s1]!.status = "sitting_out";
      }),
    ],
    [
      "control",
      variant(initial, (d) => {
        d.control.phase = "end";
      }),
    ],
    ["open gate", withGate],
    [
      "sealed submission",
      variant(withGate, (d) => {
        d.gates.open[must(gateId("g1"))]!.submissions[s1] = { bid: 1 };
      }),
    ],
    [
      "resolved gate",
      variant(withGate, (d) => {
        d.gates.resolved[must(gateId("g0"))]!.submissions[s1] = 2;
      }),
    ],
    [
      "delegation",
      variant(initial, (d) => {
        d.delegations.push({ seat: s1, principal: "p" });
      }),
    ],
    [
      "grant",
      variant(initial, (d) => {
        d.grants[must(grantId("grant/1/0"))] = {
          target: { kind: "card", card_id: "c1" },
          keys: ["hand"],
          grantee: "s1",
          scope: { kind: "once" },
        };
      }),
    ],
    [
      "outcome",
      variant(initial, (d) => {
        d.outcome = { winner: "s1" };
      }),
    ],
  ];
  for (const [name, state] of cases) {
    it(`changes when ${name} changes`, () => {
      expect(stateDigest(def, state)).not.toBe(base);
    });
  }

  it("changes when a derived counter's input changes (and nothing else)", () => {
    // `total` counts face-up cards: compare against a definition whose evaluator is constant.
    const flipped = variant(initial, (d) => {
      d.cards[c("c1")]!.orientation = "face_up";
    });
    const constDef = buildDefinition();
    // same state change, evaluator ignores orientation -> derivedCounters stay equal
    const a = text(canonicalStateBytes(constDef, flipped)).replace(
      /"face_up"/,
      '"face_down"',
    );
    expect(a).toBe(text(canonicalStateBytes(constDef, initial)));
    expect(text(canonicalStateBytes(def, flipped))).toContain(
      '"derivedCounters":[["total","1"]]',
    );
    expect(stateDigest(def, flipped)).not.toBe(base);
  });

  it("outcome is omitted when absent and emitted last when present", () => {
    expect(text(canonicalStateBytes(def, initial))).not.toContain("outcome");
    const t = text(
      canonicalStateBytes(
        def,
        variant(initial, (d) => {
          d.outcome = 7;
        }),
      ),
    );
    expect(t.endsWith(',"outcome":7}')).toBe(true);
  });
});

describe("VC-089 canonicalize of the definition's data portion", () => {
  it("succeeds and serialises no function member", () => {
    const d = buildDefinition();
    const t = text(canonicalize(definitionIdentitySchema, definitionData(d)));
    expect(t).toContain('"derivedSpec"');
    expect(t).toContain('"reducerRef":"identity"');
    expect(t).toContain('"rosterReducerRef":"identity"');
    expect(t).not.toContain('"hasReducer"');
    expect(t).not.toContain('"hasRosterReducer"');
    expect(t).toContain('["on-move"]');
    expect(t).not.toContain("=>");
    expect(t).not.toContain("function");
  });
  it("also fits the floor definition", () => {
    expect(() =>
      canonicalize(
        definitionIdentitySchema,
        definitionData(buildFloorDefinition()),
      ),
    ).not.toThrow();
  });
});

describe("state schema strictness", () => {
  it("rejects an undeclared metadata field", () => {
    const bad = variant(initial, (d) => {
      d.cards[c("c1")]!.metadata = { nope: 1 };
    });
    expect(() => stateDigest(def, bad)).toThrow(/nope/);
  });
});
