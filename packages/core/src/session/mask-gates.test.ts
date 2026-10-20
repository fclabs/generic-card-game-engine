import { describe, expect, expectTypeOf, it } from "vitest";
import { buildDefinition } from "../definition/definition.testing.js";
import { createSession } from "./create.js";
import { maskGates } from "./mask-gates.js";
import { gateId, seatId, sessionId } from "./ids.js";
import type { SeatId } from "./ids.js";
import { variant } from "./state.testing.js";
import { isDeepFrozen } from "./snapshot.testing.js";
import type { GateMaskedSnapshot, MaskedGate, SealedBySeat } from "./state.js";

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const s1 = must(seatId("s1"));
const s2 = must(seatId("s2"));
const g = (v: string) => must(gateId(v));

const base = must(
  createSession(buildDefinition(), must(sessionId("m")), [
    { seat: s1 },
    { seat: s2 },
  ]),
);
const state = variant(base, (d) => {
  d.gates.open[g("g1")] = {
    schemaId: "bid",
    expectedSeats: [s2, s1],
    submissions: { [s1]: { bid: 5 } },
  };
  d.gates.open[g("g2")] = {
    schemaId: "vote",
    expectedSeats: [s1, s2],
    submissions: { [s1]: "a", [s2]: "b" },
  };
  d.gates.resolved[g("g0")] = {
    schemaId: "old",
    expectedSeats: [s1],
    submissions: { [s1]: { secret: true } },
  };
});

describe("VC-082 maskGates", () => {
  const masked = maskGates(state);

  it("replaces open gates with {schemaId, expectedSeats, submitted} and no payload", () => {
    expect(masked.gates.open[g("g1")]).toEqual({
      schemaId: "bid",
      expectedSeats: [s2, s1],
      submitted: [s1],
    });
    expect(masked.gates.open[g("g2")]).toEqual({
      schemaId: "vote",
      expectedSeats: [s1, s2],
      submitted: [s1, s2],
    });
    expect(JSON.stringify(masked.gates.open)).not.toContain('bid":5');
    expect(JSON.stringify(masked.gates.open)).not.toContain("submissions");
  });
  it("keeps resolved gates and everything else by reference", () => {
    expect(masked.gates.resolved).toBe(state.gates.resolved);
    expect(masked.cards).toBe(state.cards);
    expect(masked.zones).toBe(state.zones);
    expect(masked.counters).toBe(state.counters);
    expect(masked.roster).toBe(state.roster);
    expect(masked.control).toBe(state.control);
    expect(masked.meta).toBe(state.meta);
    expect(masked.id).toBe(state.id);
    expect(masked.seq).toBe(state.seq);
    expect(masked.gates.open[g("g1")]?.expectedSeats).toBe(
      state.gates.open[g("g1")]?.expectedSeats,
    );
  });
  it("is deep-frozen and does not touch the input", () => {
    expect(isDeepFrozen(masked)).toBe(true);
    expect(state.gates.open[g("g1")]?.submissions[s1]).toEqual({ bid: 5 });
  });
  it("handles a state without gates", () => {
    const m = maskGates(base);
    expect(m.gates.open).toEqual({});
    expect(m.gates.resolved).toBe(base.gates.resolved);
  });
  it("has the GateMaskedSnapshot shape (type test)", () => {
    expectTypeOf(masked).toEqualTypeOf<GateMaskedSnapshot>();
    expectTypeOf(masked.gates.open[g("g1")]).toEqualTypeOf<
      Readonly<MaskedGate> | undefined
    >();
    expectTypeOf<MaskedGate["submitted"]>().toEqualTypeOf<SealedBySeat>();
    expectTypeOf<SealedBySeat>().toEqualTypeOf<readonly SeatId[]>();
    // @ts-expect-error masked open gates carry no submissions
    void masked.gates.open[g("g1")]?.submissions;
  });
});
