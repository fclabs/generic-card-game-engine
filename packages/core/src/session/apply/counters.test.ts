import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildDefinition } from "../../definition/definition.testing.js";
import type {
  CompiledGameDefinition,
  CounterDecl,
} from "../../definition/types.js";
import { canonicalStateBytes } from "../../replay/canonical/state-schema.js";
import { stateDigest } from "../../replay/canonical/index.js";
import { A } from "../actions.testing.js";
import type { Action } from "../actions.js";
import { counterId, zoneId } from "../ids.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";
import { apply } from "./index.js";
import { errorOf, must, startState } from "./apply.testing.js";

const kid = (v: string) => must(counterId(v));
function counter(id: string, rest: Partial<CounterDecl> = {}): CounterDecl {
  return {
    id: kid(id),
    owner: "table",
    min: -(10n ** 40n),
    max: 10n ** 40n,
    initial: 0n,
    ...rest,
  };
}
function world(
  counters: CounterDecl[],
  groups: Record<string, string[]> = {},
): CompiledGameDefinition {
  return buildDefinition({
    counters,
    conservationGroups: Object.entries(groups).map(([id, ids]) => ({
      id,
      counters: ids.map(kid),
    })),
  });
}
function run(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  ...batch: Action[]
) {
  return apply(def, state, batch);
}
const val = (s: Snapshot<SessionState>, id: string) => s.counters[kid(id)];

describe("VC-035 counter_adjust bounds and exactness", () => {
  const def = world([
    counter("c", { min: 10n, max: 20n, initial: 15n }),
    counter("big", { min: 0n, max: 2n ** 90n, initial: 2n ** 70n }),
    counter("d", { derived: () => 0n }),
  ]);
  const s = startState(def);
  it("accepts exactly min and max, rejects min-1 and max+1", () => {
    expect(val(must(run(def, s, A.adjust("c", -5n))).state, "c")).toBe(10n);
    expect(val(must(run(def, s, A.adjust("c", 5n))).state, "c")).toBe(20n);
    for (const delta of [-6n, 6n]) {
      const e = errorOf(run(def, s, A.adjust("c", delta)));
      expect(e.code).toBe("COUNTER_BOUNDS");
      expect(e.actionIndex).toBe(0);
      expect(e.detail).toContain("c");
    }
  });
  it("is exact above 2^64 and bounds-checks there", () => {
    const up = must(run(def, s, A.adjust("big", 2n ** 65n + 1n))).state;
    expect(val(up, "big")).toBe(2n ** 70n + 2n ** 65n + 1n);
    expect(typeof val(up, "big")).toBe("bigint");
    const top = must(run(def, s, A.adjust("big", 2n ** 90n - 2n ** 70n))).state;
    expect(val(top, "big")).toBe(2n ** 90n);
    expect(
      errorOf(run(def, s, A.adjust("big", 2n ** 90n - 2n ** 70n + 1n))).code,
    ).toBe("COUNTER_BOUNDS");
  });
  it("rejects derived and unknown counters as MALFORMED_ACTION", () => {
    const e = errorOf(run(def, s, A.adjust("d", 1n)));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("d");
    expect(e.path).toBe("$[0].counter_id");
    const u = errorOf(run(def, s, A.adjust("nope", 1n)));
    expect(u.code).toBe("MALFORMED_ACTION");
    expect(u.detail).toContain("nope");
  });
  it("a failure leaves the input untouched and untouched counters shared", () => {
    const before = stateDigest(def, s);
    run(def, s, A.adjust("c", 99n));
    expect(stateDigest(def, s)).toBe(before);
    const ok = must(run(def, s, A.adjust("c", 1n))).state;
    expect(ok.counters).not.toBe(s.counters);
    expect(ok.zones).toBe(s.zones);
  });
});

describe("VC-036 counter_transfer", () => {
  const def = world([
    counter("from", { min: 0n, initial: 100n }),
    counter("to", { min: 0n, max: 50n, initial: 50n }),
    counter("empty", { min: 0n, max: 50n, initial: 0n }),
  ]);
  const s = startState(def);
  it("0 and full balance are ok and conserve the sum", () => {
    const zero = must(run(def, s, A.transfer("from", "empty", 0n))).state;
    expect(val(zero, "from")).toBe(100n);
    const full = must(run(def, s, A.transfer("from", "empty", 50n))).state;
    expect(val(full, "from")).toBe(50n);
    expect(val(full, "empty")).toBe(50n);
    expect(val(full, "from")! + val(full, "empty")!).toBe(100n);
  });
  it("more than the balance, and into a counter at max, are COUNTER_BOUNDS", () => {
    expect(errorOf(run(def, s, A.transfer("empty", "from", 1n))).code).toBe(
      "COUNTER_BOUNDS",
    );
    expect(errorOf(run(def, s, A.transfer("from", "to", 1n))).code).toBe(
      "COUNTER_BOUNDS",
    );
  });
  it("a negative amount is MALFORMED_ACTION", () => {
    const e = errorOf(run(def, s, A.transfer("from", "empty", -1n)));
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.path).toBe("$[0].amount");
  });
  it("derived or unknown endpoints are MALFORMED_ACTION", () => {
    const d = world([counter("a"), counter("d", { derived: () => 0n })]);
    const ds = startState(d);
    expect(errorOf(run(d, ds, A.transfer("a", "d", 0n))).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(errorOf(run(d, ds, A.transfer("zz", "a", 0n))).detail).toContain(
      "zz",
    );
  });
});

describe("VC-055 ratio rounding through apply", () => {
  const def = world([
    counter("f", { rounding: "floor", scale: 0 }),
    counter("f2", { rounding: "floor", scale: 6 }),
    counter("u", { rounding: "half_up" }),
    counter("e", { rounding: "half_even" }),
    counter("n"),
    counter("src", { rounding: "floor", initial: 1000n }),
    counter("srcU", { rounding: "half_up", initial: 1000n }),
    counter("sink"),
    counter("rest"),
  ]);
  const s = startState(def);
  const table: [bigint, [bigint, bigint], bigint, bigint, bigint][] = [
    [5n, [1n, 3n], 1n, 2n, 2n],
    [5n, [1n, 2n], 2n, 3n, 2n],
    [-5n, [1n, 2n], -3n, -3n, -2n],
    [7n, [1n, 2n], 3n, 4n, 4n],
    [3n, [3n, 2n], 4n, 5n, 4n],
    [100n, [5n, 100n], 5n, 5n, 5n],
  ];
  it.each(table)("applied for delta %s ratio %s", (delta, ratio, f, u, e) => {
    expect(val(must(run(def, s, A.adjust("f", delta, ratio))).state, "f")).toBe(
      f,
    );
    expect(val(must(run(def, s, A.adjust("u", delta, ratio))).state, "u")).toBe(
      u,
    );
    expect(val(must(run(def, s, A.adjust("e", delta, ratio))).state, "e")).toBe(
      e,
    );
    // scale is descriptive: same result with a different scale
    expect(
      val(must(run(def, s, A.adjust("f2", delta, ratio))).state, "f2"),
    ).toBe(f);
  });
  it("transfer 7 at 1/3 floor: to += 2, remainder_to += 5, group sum unchanged", () => {
    const out = must(
      run(
        def,
        s,
        A.transfer("src", "sink", 7n, { ratio: [1n, 3n], remainderTo: "rest" }),
      ),
    ).state;
    expect(val(out, "src")).toBe(993n);
    expect(val(out, "sink")).toBe(2n);
    expect(val(out, "rest")).toBe(5n);
    expect(val(out, "src")! + val(out, "sink")! + val(out, "rest")!).toBe(
      1000n,
    );
  });
  it("transfer 7 at 1/2 half_up (mode of the source): to += 4, remainder += 3", () => {
    const out = must(
      run(
        def,
        s,
        A.transfer("srcU", "sink", 7n, {
          ratio: [1n, 2n],
          remainderTo: "rest",
        }),
      ),
    ).state;
    expect(val(out, "sink")).toBe(4n);
    expect(val(out, "rest")).toBe(3n);
  });
  it("the mode comes from the source, not the destination", () => {
    const out = must(
      run(
        def,
        s,
        A.transfer("src", "u", 7n, { ratio: [1n, 2n], remainderTo: "rest" }),
      ),
    ).state;
    expect(val(out, "u")).toBe(3n); // floor of the source, not half_up of u
  });
  it("a non-zero remainder without remainder_to is MALFORMED_ACTION; a zero one is fine", () => {
    const e = errorOf(
      run(def, s, A.transfer("src", "sink", 7n, { ratio: [1n, 3n] })),
    );
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.path).toBe("$[0].remainder_to");
    const exact = must(
      run(def, s, A.transfer("src", "sink", 9n, { ratio: [1n, 1n] })),
    ).state;
    expect(val(exact, "sink")).toBe(9n);
  });
  it("remainder_to equal to from_counter nets first and checks the final value", () => {
    const out = must(
      run(
        def,
        s,
        A.transfer("src", "sink", 7n, { ratio: [1n, 3n], remainderTo: "src" }),
      ),
    ).state;
    expect(val(out, "src")).toBe(1000n - 2n); // -7 + 5
    expect(val(out, "sink")).toBe(2n);
    // transient dip below min is fine when the final value is in bounds
    const tight = world([
      counter("a", { rounding: "floor", min: 0n, initial: 3n }),
      counter("b"),
    ]);
    const ts = startState(tight);
    const ok = must(
      run(
        tight,
        ts,
        A.transfer("a", "b", 7n, { ratio: [1n, 3n], remainderTo: "a" }),
      ),
    ).state;
    expect(val(ok, "a")).toBe(1n); // 3 - 7 + 5; never judged at -4
    expect(val(ok, "b")).toBe(2n);
    const low = world([
      counter("a", { rounding: "floor", min: 0n, initial: 1n }),
      counter("b"),
    ]);
    const e = errorOf(
      run(
        low,
        startState(low),
        A.transfer("a", "b", 7n, { ratio: [1n, 3n], remainderTo: "a" }),
      ),
    );
    expect(e.code).toBe("COUNTER_BOUNDS"); // final -1
  });
  it("ratio den = 0 and ratio on a counter without a mode are MALFORMED_ACTION", () => {
    const zeroDen = errorOf(
      run(def, s, { ...A.adjust("f", 1n), ratio: { num: 1n, den: 0n } }),
    );
    expect(zeroDen.code).toBe("MALFORMED_ACTION");
    const noMode = errorOf(run(def, s, A.adjust("n", 1n, [1n, 2n])));
    expect(noMode.code).toBe("MALFORMED_ACTION");
    expect(noMode.detail).toContain("n");
    const noModeSrc = errorOf(
      run(
        def,
        s,
        A.transfer("n", "sink", 1n, { ratio: [1n, 2n], remainderTo: "rest" }),
      ),
    );
    expect(noModeSrc.code).toBe("MALFORMED_ACTION");
  });
  it("a ratio above 1 gives a negative remainder, applied as-is (bounds on final values)", () => {
    const out = must(
      run(
        def,
        s,
        A.transfer("src", "sink", 7n, { ratio: [3n, 2n], remainderTo: "rest" }),
      ),
    ).state;
    expect(val(out, "sink")).toBe(10n);
    expect(val(out, "rest")).toBe(-3n);
    expect(val(out, "src")).toBe(993n);
    const bounded = world([
      counter("src", { rounding: "floor", initial: 100n }),
      counter("sink"),
      counter("rest", { min: 0n }),
    ]);
    const e = errorOf(
      run(
        bounded,
        startState(bounded),
        A.transfer("src", "sink", 7n, { ratio: [3n, 2n], remainderTo: "rest" }),
      ),
    );
    expect(e.code).toBe("COUNTER_BOUNDS");
    expect(e.detail).toContain("rest");
  });
});

describe("VC-056 conservation (KFR-062)", () => {
  const def = world(
    [
      counter("pot", { min: 0n }),
      counter("a", { min: 0n, initial: 10n }),
      counter("b", { min: 0n, initial: 10n }),
      counter("mint", { min: 0n, initial: 10n, supplyRole: "mint" }),
      counter("out", { min: 0n }),
    ],
    { g: ["pot", "a", "b", "mint"] },
  );
  const s = startState(def);
  it("transfers within the group keep the sum", () => {
    const out = must(
      run(def, s, A.transfer("a", "pot", 4n), A.transfer("b", "a", 2n)),
    ).state;
    expect(val(out, "pot")).toBe(4n);
  });
  it("adjusting a non-supply member is COUNTER_BOUNDS naming the group", () => {
    const e = errorOf(run(def, s, A.adjust("a", 1n)));
    expect(e.code).toBe("COUNTER_BOUNDS");
    expect(e.detail).toContain("g");
    expect(e.actionIndex).toBe(0);
    expect(errorOf(run(def, s, A.transfer("a", "out", 1n))).code).toBe(
      "COUNTER_BOUNDS",
    );
  });
  it("adjusting a supply member is ok (any direction; direction is not enforced)", () => {
    expect(val(must(run(def, s, A.adjust("mint", 5n))).state, "mint")).toBe(
      15n,
    );
    expect(val(must(run(def, s, A.adjust("mint", -5n))).state, "mint")).toBe(
      5n,
    );
  });
  it("a supply adjust with a ratio counts its applied amount", () => {
    const d = world(
      [
        counter("a", { min: 0n, initial: 10n }),
        counter("m", {
          min: 0n,
          initial: 10n,
          supplyRole: "burn",
          rounding: "half_up",
        }),
      ],
      { g: ["a", "m"] },
    );
    const out = must(run(d, startState(d), A.adjust("m", 7n, [1n, 2n]))).state;
    expect(val(out, "m")).toBe(14n);
  });
  it("transient imbalance inside the batch is legal", () => {
    // VC-056 reducer step (meta no-op between the adjusts) arrives with iteration 9.
    const out = must(
      run(def, s, A.adjust("mint", -1n), A.adjust("mint", 1n)),
    ).state;
    expect(val(out, "mint")).toBe(10n);
    const t = must(
      run(def, s, A.transfer("a", "out", 1n), A.transfer("out", "b", 1n)),
    ).state;
    expect(val(t, "b")).toBe(11n);
  });
  it("only the group's counters are checked; other counters move freely", () => {
    const out = must(run(def, s, A.adjust("out", 5n))).state;
    expect(val(out, "out")).toBe(5n);
  });
});

describe("VC-004 conservation actionIndex", () => {
  it("is the last input action that changed a member of the violated group", () => {
    const def = world(
      [
        counter("pot", { min: 0n }),
        counter("bank", { min: 0n, initial: 10n }),
        counter("x"),
      ],
      { chips: ["pot", "bank"] },
    );
    const s = startState(def);
    const e = errorOf(
      run(
        def,
        s,
        A.adjust("pot", 1n),
        A.move("c1", "deck", "table"),
        A.adjust("pot", 1n),
      ),
    );
    expect(e.code).toBe("COUNTER_BOUNDS");
    expect(e.actionIndex).toBe(2);
    // an adjust of a non-member afterwards does not move the index
    const e2 = errorOf(
      run(
        def,
        s,
        A.adjust("pot", 1n),
        A.adjust("x", 1n),
        A.move("c1", "deck", "table"),
      ),
    );
    expect(e2.actionIndex).toBe(0);
    // input state untouched
    expect(val(s, "pot")).toBe(0n);
  });
});

describe("VC-058 derived counters through apply", () => {
  const def = world([
    counter("pot", { min: 0n }),
    counter("hand_size", {
      min: 0n,
      derived: (snap) =>
        BigInt(snap.zones[must(zoneId("table"))]?.members.length ?? 0),
    }),
  ]);
  it("is recomputed after a move, never stored, and serialised after counters", () => {
    const s = startState(def);
    const moved = must(
      apply(def, s, [
        A.move("c1", "deck", "table"),
        A.move("c2", "deck", "table"),
      ]),
    ).state;
    expect("hand_size" in moved.counters).toBe(false);
    const text = (st: Snapshot<SessionState>) =>
      new TextDecoder().decode(canonicalStateBytes(def, st));
    expect(text(s)).toContain('"derivedCounters":[["hand_size","0"]]');
    expect(text(moved)).toContain('"derivedCounters":[["hand_size","2"]]');
    expect(text(moved).indexOf("derivedCounters")).toBeGreaterThan(
      text(moved).indexOf('"counters"'),
    );
  });
});

describe("VC-057 conservation property", () => {
  const def = world(
    [
      counter("a", { min: 0n, max: 1000n, initial: 100n }),
      counter("b", { min: 0n, max: 1000n, initial: 100n }),
      counter("m", { min: 0n, max: 5000n, initial: 100n, supplyRole: "mint" }),
      counter("x", { min: 0n, max: 1000n, initial: 0n }),
    ],
    { g: ["a", "b", "m"] },
  );
  const ids = ["a", "b", "m", "x"] as const;
  const id = fc.constantFrom(...ids);
  const amount = fc.bigInt({ min: -300n, max: 300n });
  const action = fc.oneof(
    fc.tuple(id, amount).map(([c, d]) => A.adjust(c, d)),
    fc
      .tuple(id, id, fc.bigInt({ min: -5n, max: 400n }))
      .map(([f, t, n]) => A.transfer(f, t, n)),
  );
  const batch = fc.array(action, { minLength: 0, maxLength: 4 });

  it("holds at every step over random legal and illegal batches (>= 1000 runs)", () => {
    fc.assert(
      fc.property(
        fc.array(batch, { minLength: 1, maxLength: 6 }),
        (batches) => {
          let state = startState(def);
          let expected = 300n;
          for (const b of batches) {
            const before = stateDigest(def, state);
            const result = apply(def, state, b);
            if (!result.ok) {
              // atomic: nothing changed
              expect(stateDigest(def, state)).toBe(before);
              continue;
            }
            for (const c of result.value.committed) {
              if (c.kind === "counter_adjust" && c.counter_id === kid("m")) {
                expected += c.delta;
              }
            }
            state = result.value.state;
            const sum = ["a", "b", "m"].reduce(
              (acc, k) => acc + val(state, k)!,
              0n,
            );
            expect(sum).toBe(expected);
            for (const k of ids) {
              expect(val(state, k)! >= 0n).toBe(true);
            }
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("a failing batch leaves the digest unchanged", () => {
    fc.assert(
      fc.property(batch, (b) => {
        const s = startState(def);
        const before = stateDigest(def, s);
        apply(def, s, b);
        expect(stateDigest(def, s)).toBe(before);
      }),
      { numRuns: 300 },
    );
  });
});
