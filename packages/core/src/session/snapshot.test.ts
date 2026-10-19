import { describe, expect, it } from "vitest";
import { deepFreeze } from "./snapshot.js";
import type { Snapshot } from "./snapshot.js";
import { isDeepFrozen } from "./snapshot.testing.js";
import type { CardId, CounterId, SeatId, ZoneId } from "./ids.js";

/** Local sample shaped like spec §6.4 (iteration 4 re-points this at `SessionState`). */
interface SampleState {
  seq: number;
  cards: Record<
    CardId,
    { zone: ZoneId; metadata: Record<string, { tags: string[] }> }
  >;
  zones: Record<ZoneId, { members: CardId[] }>;
  counters: Record<CounterId, bigint>;
  control: {
    phase: string;
    turnOrder: SeatId[];
    pointers: Record<string, SeatId>;
  };
}

function sample(): SampleState {
  return {
    seq: 0,
    cards: {
      ["c1" as CardId]: {
        zone: "z1" as ZoneId,
        metadata: { m: { tags: ["a", "b"] } },
      },
    },
    zones: { ["z1" as ZoneId]: { members: ["c1" as CardId] } },
    counters: { ["chips" as CounterId]: 10n },
    control: {
      phase: "play",
      turnOrder: ["s1" as SeatId],
      pointers: { dealer: "s1" as SeatId },
    },
  };
}

describe("VC-012 (type part) writes through Snapshot do not compile", () => {
  it("rejects writes to members[0], counters[c], control.phase", () => {
    const snap: Snapshot<SampleState> = deepFreeze(sample());
    const z = "z1" as ZoneId;
    const c = "chips" as CounterId;
    expect(() => {
      // @ts-expect-error members is readonly
      snap.zones[z]!.members[0] = "c2" as CardId;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error counters are readonly
      snap.counters[c] = 1n;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error control.phase is readonly
      snap.control.phase = "x";
    }).toThrow(TypeError);
  });
});

describe("VC-013 (helper part) deepFreeze / isDeepFrozen", () => {
  it("freezes a nested object/array graph and leaves bigint untouched", () => {
    const s = sample();
    expect(isDeepFrozen(s)).toBe(false);
    const frozen = deepFreeze(s);
    expect(frozen).toBe(s);
    expect(isDeepFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(s.cards["c1" as CardId]!.metadata.m!.tags)).toBe(
      true,
    );
    expect(s.counters["chips" as CounterId]).toBe(10n);
  });
  it("isDeepFrozen detects an unfrozen nested leaf under a frozen shell", () => {
    const inner = { a: [1] };
    const shell = Object.freeze({ inner });
    expect(isDeepFrozen(shell)).toBe(false);
    deepFreeze(shell);
    expect(isDeepFrozen(shell)).toBe(true);
  });
  it("handles primitives, cycles and very deep graphs", () => {
    expect(deepFreeze(5n)).toBe(5n);
    expect(deepFreeze(null)).toBeNull();
    const a: { self?: unknown } = {};
    a.self = a;
    expect(isDeepFrozen(deepFreeze(a))).toBe(true);
    let deep: { next?: unknown } = {};
    const root = deep;
    for (let i = 0; i < 100_000; i += 1) {
      const n: { next?: unknown } = {};
      deep.next = n;
      deep = n;
    }
    expect(isDeepFrozen(deepFreeze(root))).toBe(true);
  });
});
