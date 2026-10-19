import { describe, expect, it } from "vitest";
import { ratioRound } from "./ratio.js";

const r = (num: bigint, den: bigint) => ({ num, den });

describe("ratioRound (KFR-061)", () => {
  const cases: [bigint, [bigint, bigint], bigint, bigint, bigint][] = [
    // x, [num, den], floor, half_up, half_even
    [5n, [1n, 3n], 1n, 2n, 2n],
    [5n, [1n, 2n], 2n, 3n, 2n],
    [-5n, [1n, 2n], -3n, -3n, -2n],
    [7n, [1n, 2n], 3n, 4n, 4n],
    [3n, [3n, 2n], 4n, 5n, 4n],
    [100n, [5n, 100n], 5n, 5n, 5n],
    [-7n, [1n, 3n], -3n, -2n, -2n],
    [0n, [7n, 3n], 0n, 0n, 0n],
    [-3n, [3n, 2n], -5n, -5n, -4n],
  ];
  it.each(cases)("x=%s ratio=%s", (x, [num, den], fl, hu, he) => {
    expect(ratioRound(x, r(num, den), "floor")).toBe(fl);
    expect(ratioRound(x, r(num, den), "half_up")).toBe(hu);
    expect(ratioRound(x, r(num, den), "half_even")).toBe(he);
  });

  it("is exact beyond 2^64", () => {
    const big = 2n ** 200n + 1n;
    expect(ratioRound(big, r(1n, 2n), "floor")).toBe(2n ** 199n);
    expect(ratioRound(big, r(1n, 2n), "half_up")).toBe(2n ** 199n + 1n);
    expect(ratioRound(big, r(1n, 2n), "half_even")).toBe(2n ** 199n);
  });

  it("rejects a non-positive denominator as a programmer error", () => {
    expect(() => ratioRound(1n, r(1n, 0n), "floor")).toThrow(RangeError);
    expect(() => ratioRound(1n, r(1n, -1n), "floor")).toThrow(RangeError);
  });
});
