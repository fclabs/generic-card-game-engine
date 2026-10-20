import type { RoundingMode } from "../definition/types.js";
import type { Ratio } from "./actions.js";

/**
 * `round(x * num / den)` in exact bigint arithmetic (KFR-061). `den` must be positive
 * (a violated precondition throws `RangeError`; `validateAction` already guarantees it).
 * - `floor`: toward negative infinity.
 * - `half_up`: nearest integer, ties away from zero.
 * - `half_even`: nearest integer, ties to the even quotient.
 * The counter's `scale` never enters the arithmetic.
 */
export function ratioRound(
  x: bigint,
  ratio: Ratio,
  mode: RoundingMode,
): bigint {
  const { num, den } = ratio;
  if (den <= 0n) throw new RangeError("ratio.den must be positive");
  const n = x * num;
  // BigInt division truncates toward zero; derive the floor from it.
  let floor = n / den;
  if (n % den !== 0n && n < 0n) floor -= 1n;
  if (mode === "floor") return floor;
  const rem = n - floor * den; // 0 <= rem < den
  const twice = 2n * rem;
  if (twice < den) return floor;
  if (twice > den) return floor + 1n;
  // exact tie between floor and floor + 1
  if (mode === "half_up") return n < 0n ? floor : floor + 1n;
  return floor % 2n === 0n ? floor : floor + 1n;
}
