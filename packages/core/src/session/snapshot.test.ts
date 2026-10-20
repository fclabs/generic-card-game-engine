import { describe, expect, it } from "vitest";
import { buildDefinition } from "../definition/definition.testing.js";
import { createSession } from "./create.js";
import { deepFreeze } from "./snapshot.js";
import type { Snapshot } from "./snapshot.js";
import { isDeepFrozen } from "./snapshot.testing.js";
import type {
  CardId,
  CounterId,
  Seq,
  SeatId,
  SessionId,
  TeamId,
  ZoneId,
} from "./ids.js";
import type { SessionState } from "./state.js";
import { cloneData } from "./state.testing.js";

/** Real initial `SessionState` (iteration 4 re-points the iteration-1 sample here). */
function initial(): Snapshot<SessionState> {
  const r = createSession(buildDefinition(), "sess" as SessionId, [
    { seat: "s1" as SeatId, team: "t1" as TeamId },
    { seat: "s2" as SeatId, team: "t2" as TeamId },
  ]);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

describe("VC-012 writes through Snapshot<SessionState> do not compile", () => {
  it("rejects writes to members[0], counters[c], control.phase", () => {
    const snap = initial();
    const z = "deck" as ZoneId;
    const c = "pot" as CounterId;
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
    expect(() => {
      // @ts-expect-error seq is readonly
      snap.seq = 1 as Seq;
    }).toThrow(TypeError);
  });
});

/** An unfrozen deep copy, for exercising `deepFreeze`. */
function sample(): SessionState {
  return cloneData(initial());
}

describe("VC-013 (helper part) deepFreeze / isDeepFrozen", () => {
  it("freezes a nested object/array graph and leaves bigint untouched", () => {
    const s = sample();
    expect(isDeepFrozen(s)).toBe(false);
    const frozen = deepFreeze(s);
    expect(frozen).toBe(s);
    expect(isDeepFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(s.zones["deck" as ZoneId]!.members)).toBe(true);
    expect(s.counters["bank" as CounterId]).toBe(100n);
    expect(s.cards["c1" as CardId]?.zone).toBe("deck");
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
