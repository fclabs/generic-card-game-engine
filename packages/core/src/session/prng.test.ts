import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrng, seedWords, shufflePermutation, uniform } from "./prng.js";
import type { Uint32Stream } from "./prng.js";
import { cardId } from "./ids.js";
import {
  buildPrngVectors,
  PRNG_SEEDS,
} from "./generate-prng-vectors.testing.js";
import type { PrngVector } from "./generate-prng-vectors.testing.js";
import { scriptedStream } from "./prng.testing.js";

const FILE = new URL("./prng-vectors.json", import.meta.url);
if (process.env["UPDATE_GOLDEN"] === "1") {
  writeFileSync(FILE, JSON.stringify(buildPrngVectors(), null, 2) + "\n");
}
const vectors = JSON.parse(readFileSync(FILE, "utf8")) as PrngVector[];

function prng(seed: string) {
  const r = createPrng(seed);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
function draw(stream: Uint32Stream, n: number): number[] {
  const out: number[] = [];
  let s = stream;
  for (let i = 0; i < n; i++) {
    const d = s.nextUint32();
    out.push(d.value);
    s = d.next;
  }
  return out;
}

// Reference values from an independent Python implementation of spec section 6.3.
const SEED_A_WORDS = [0xfd7182bf, 0x7e3c64bf, 0x6f4ff2d8, 0x5a35548e];
const SEED_A_VALUES = [
  635193496, 1739813106, 760759261, 3031290481, 188717168, 3567165512,
  2212325844, 695670279, 3854472863, 634496969,
];

describe("VC-070 createPrng", () => {
  it("seed-a: committed seed words and first 10 values", () => {
    const w = seedWords("seed-a");
    expect(w.ok && w.value).toEqual(SEED_A_WORDS);
    expect(draw(prng("seed-a"), 10)).toEqual(SEED_A_VALUES);
  });

  it("empty seed words are the FNV offset basis (hand computed)", () => {
    const w = seedWords("");
    expect(w.ok && w.value).toEqual([
      0x6c62272e, 0x07bb0142, 0x62b82175, 0x6295c58d,
    ]);
  });

  it("same seed twice gives identical streams; seed-b differs", () => {
    expect(draw(prng("seed-a"), 20)).toEqual(draw(prng("seed-a"), 20));
    expect(draw(prng("seed-b"), 10)).not.toEqual(SEED_A_VALUES);
  });

  it("is immutable: drawing twice from one stream gives the same value and stream", () => {
    const p = prng("seed-a");
    const x = p.nextUint32();
    const y = p.nextUint32();
    expect(x.value).toBe(y.value);
    expect(draw(x.next, 3)).toEqual(draw(y.next, 3));
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("outputs are uint32", () => {
    for (const v of draw(prng("seed-a"), 200)) {
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    }
  });

  it("empty and 256-byte seeds work; three-byte characters stop at 256 bytes", () => {
    expect(createPrng("").ok).toBe(true);
    expect(createPrng("x".repeat(256)).ok).toBe(true);
    expect(createPrng("€".repeat(85)).ok).toBe(true); // 255 bytes
    expect(createPrng("€".repeat(86)).ok).toBe(false); // 258 bytes
  });

  it("257-byte seed and lone surrogates are MALFORMED_ACTION", () => {
    for (const seed of ["x".repeat(257), "a\ud800b", "\udc00", "end\ud83d"]) {
      const r = createPrng(seed);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("MALFORMED_ACTION");
        expect(r.error).not.toHaveProperty("actionIndex");
      }
      expect(seedWords(seed).ok).toBe(false);
    }
  });

  it("a valid surrogate pair is accepted", () => {
    expect(createPrng("🂡").ok).toBe(true);
  });
});

describe("golden vectors (prng-vectors.json)", () => {
  it("covers short ASCII, empty, 256-byte and non-ASCII seeds with 10 values each", () => {
    expect(vectors.map((v) => v.name)).toEqual(PRNG_SEEDS.map((s) => s.name));
    for (const v of vectors) {
      expect(v.values).toHaveLength(10);
      expect(v.words).toHaveLength(4);
    }
    expect(vectors.find((v) => v.name === "bytes-256")?.seedBytes).toBe(256);
  });

  it("committed file equals the independent generator output", () => {
    expect(vectors).toEqual(JSON.parse(JSON.stringify(buildPrngVectors())));
  });

  it("seed-a entry equals the hand-committed reference", () => {
    const a = vectors.find((v) => v.name === "seed-a");
    expect(a?.words).toEqual(SEED_A_WORDS);
    expect(a?.values).toEqual(SEED_A_VALUES);
  });

  for (const v of vectors) {
    it(`${v.name}: implementation matches words and values`, () => {
      const w = seedWords(v.seed);
      expect(w.ok && w.value).toEqual(v.words);
      expect(draw(prng(v.seed), 10)).toEqual(v.values);
    });
  }
});

describe("VC-071 uniform", () => {
  it("rejection sampling: [0xFFFFFFFF, 7, 9] with n = 3", () => {
    const { stream, consumed } = scriptedStream([0xffffffff, 7, 9]);
    const r = uniform(stream, 3);
    expect(r.value).toBe(1);
    expect(consumed()).toBe(2);
    expect(r.next.nextUint32().value).toBe(9);
  });

  it("throws for 0, negatives, non-integers, NaN and 2**32 + 1", () => {
    const { stream } = scriptedStream([1, 2, 3]);
    for (const n of [0, -1, 2 ** 32 + 1, 1.5, Number.NaN, Infinity]) {
      expect(() => uniform(stream, n)).toThrow(RangeError);
    }
  });

  it("accepts the bounds 1 and 2**32", () => {
    expect(uniform(scriptedStream([123]).stream, 1).value).toBe(0);
    const top = uniform(scriptedStream([0xffffffff]).stream, 2 ** 32);
    expect(top.value).toBe(0xffffffff);
  });

  it("consumes exactly one draw when the first is accepted", () => {
    const { stream, consumed } = scriptedStream([10, 20]);
    expect(uniform(stream, 4).value).toBe(2);
    expect(consumed()).toBe(1);
  });
});

describe("VC-071 shufflePermutation", () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const r = cardId(`c${String(i)}`);
      if (!r.ok) throw new Error("bad id");
      return r.value;
    });

  for (const n of [0, 1, 2, 52]) {
    it(`over ${String(n)} ids is a rearrangement, deterministic, input untouched`, () => {
      const input = ids(n);
      const copy = input.slice();
      const a = shufflePermutation(prng("shuffle"), input);
      const b = shufflePermutation(prng("shuffle"), input);
      expect([...a.permutation].sort()).toEqual([...input].sort());
      expect(a.permutation).toEqual(b.permutation);
      expect(input).toEqual(copy);
      expect(draw(a.next, 3)).toEqual(draw(b.next, 3));
    });
  }

  it("0 and 1 ids consume no draws; n ids consume at least n-1", () => {
    const s0 = scriptedStream([]);
    expect(shufflePermutation(s0.stream, ids(1)).permutation).toEqual(ids(1));
    expect(s0.consumed()).toBe(0);
    const s52 = scriptedStream(Array.from({ length: 200 }, () => 5));
    shufflePermutation(s52.stream, ids(52));
    expect(s52.consumed()).toBe(51);
  });

  it("52 ids actually change order for some seed", () => {
    const input = ids(52);
    expect(shufflePermutation(prng("x"), input).permutation).not.toEqual(input);
  });

  it("follows Fisher-Yates with the scripted draws", () => {
    // len 3: i=2 -> uniform(3) with 4 -> j=1; i=1 -> uniform(2) with 5 -> j=1.
    const { stream } = scriptedStream([4, 5]);
    expect(shufflePermutation(stream, ["a", "b", "c"]).permutation).toEqual([
      "a",
      "c",
      "b",
    ]);
    // swap(2,1): [a,c,b]; swap(1,1): unchanged
  });

  it("10 000 shuffles of 3 ids hit each arrangement 1667 +/- 150 times", () => {
    const input = ["a", "b", "c"];
    const counts = new Map<string, number>();
    for (let i = 0; i < 10000; i++) {
      const key = shufflePermutation(
        prng(`dist-${String(i)}`),
        input,
      ).permutation.join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) {
      expect(Math.abs(c - 1667)).toBeLessThanOrEqual(150);
    }
  });
});
