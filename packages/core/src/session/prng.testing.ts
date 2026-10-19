import type { Uint32Stream } from "./prng.js";

/**
 * A scripted stream that yields `values` in order and records how many draws were consumed
 * (by any stream derived from it). Drawing past the script throws.
 */
export function scriptedStream(values: readonly number[]): {
  readonly stream: Uint32Stream;
  readonly consumed: () => number;
} {
  let max = 0;
  const at = (i: number): Uint32Stream => ({
    nextUint32: () => {
      const value = values[i];
      if (value === undefined) throw new Error("scripted stream exhausted");
      max = Math.max(max, i + 1);
      return { value, next: at(i + 1) };
    },
  });
  return { stream: at(0), consumed: () => max };
}
