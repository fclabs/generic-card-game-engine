/**
 * Independent generator of the PRNG golden vectors (spec §6.3, VC-070).
 *
 * It deliberately shares no code with `prng.ts`: FNV-1a 128 is done on eight 16-bit limbs (no
 * bigint), sfc32 uses unsigned modular arithmetic instead of `| 0`, UTF-8 comes from the
 * caller's expected bytes. `prng.test.ts` also compares both against a Python reference run
 * by hand (see the iteration 5 record).
 *
 * Regenerate: UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/session/prng.test.ts
 * then `pnpm exec prettier --write packages/core/src/session/prng-vectors.json` and review.
 *
 * Hand-checked FNV step for the empty seed: no bytes are mixed, so h is the offset basis
 * 0x6c62272e07bb014262b821756295c58d and the words are 6c62272e 07bb0142 62b82175 6295c58d.
 * Hand-checked step for the one-byte seed "a" (0x61):
 *   h  = offset ^ 0x61                      = 0x6c62272e07bb014262b821756295c5ec
 *   prime = 2^88 + 0x13b, so h * prime mod 2^128 = ((h << 88) + h * 0x13b) mod 2^128
 *   h << 88 mod 2^128                       = 0x756295c5ec0000000000000000000000
 *   h * 0x13b mod 2^128                     = 0x5cc635a3831a8caf78912b704e4a8964
 *   sum                                     = 0xd228cb696f1a8caf78912b704e4a8964
 */

export interface PrngVector {
  readonly name: string;
  readonly description: string;
  /** The seed as code units; see `seedLength` for its UTF-8 size. */
  readonly seed: string;
  readonly seedBytes: number;
  /** Seed words a, b, c, d after the FNV mix, as unsigned integers. */
  readonly words: readonly number[];
  /** Outputs 13..22 of sfc32 (the first 10 after the 12 discarded ones). */
  readonly values: readonly number[];
}

export const PRNG_SEEDS: readonly {
  readonly name: string;
  readonly description: string;
  readonly seed: string;
  readonly seedBytes: number;
}[] = [
  { name: "seed-a", description: "short ASCII", seed: "seed-a", seedBytes: 6 },
  {
    name: "seed-b",
    description: "short ASCII, differs in last byte",
    seed: "seed-b",
    seedBytes: 6,
  },
  {
    name: "empty",
    description: "empty seed (words are the FNV offset basis)",
    seed: "",
    seedBytes: 0,
  },
  {
    name: "bytes-256",
    description: "256-byte ASCII seed (the maximum)",
    seed: "0123456789abcdef".repeat(16),
    seedBytes: 256,
  },
  {
    name: "non-ascii",
    description: "2-, 3- and 4-byte UTF-8 sequences",
    seed: "héllo wörld ✓ \u{1f0a1}",
    seedBytes: 22,
  },
];

const LIMBS = 8;
const OFFSET_LIMBS = [
  0xc58d, 0x6295, 0x2175, 0x62b8, 0x0142, 0x07bb, 0x272e, 0x6c62,
];
const PRIME_LIMBS = [0x013b, 0, 0, 0, 0, 0x0100, 0, 0];

/** UTF-8 bytes of a seed made only of well-formed code points (independent of core's encoder). */
function utf8(seed: string): number[] {
  const out: number[] = [];
  for (const ch of seed) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return out;
}

function fnvWords(bytes: readonly number[]): number[] {
  let h = OFFSET_LIMBS.slice();
  for (const byte of bytes) {
    h[0] = (h[0] as number) ^ byte; // limbs are 16 bit, so the byte only touches limb 0
    const acc = new Array<number>(LIMBS).fill(0);
    for (let i = 0; i < LIMBS; i++) {
      for (let j = 0; i + j < LIMBS; j++) {
        acc[i + j] =
          (acc[i + j] as number) +
          (h[i] as number) * (PRIME_LIMBS[j] as number);
      }
    }
    let carry = 0;
    h = acc.map((v) => {
      const total = v + carry;
      carry = Math.floor(total / 65536);
      return total % 65536;
    });
  }
  const word = (hi: number): number =>
    (h[hi] as number) * 65536 + (h[hi - 1] as number);
  return [word(7), word(5), word(3), word(1)];
}

const M = 4294967296;

function sfc32(words: readonly number[], count: number): number[] {
  let [a, b, c, d] = words as [number, number, number, number];
  const out: number[] = [];
  for (let i = 0; i < 12 + count; i++) {
    let t = (a + b) % M;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + ((c << 3) >>> 0)) % M;
    c = (((c << 21) >>> 0) | (c >>> 11)) >>> 0;
    d = (d + 1) % M;
    t = (t + d) % M;
    c = (c + t) % M;
    out.push(t);
  }
  return out.slice(12);
}

export function buildPrngVectors(): PrngVector[] {
  return PRNG_SEEDS.map((s) => {
    const bytes = utf8(s.seed);
    if (bytes.length !== s.seedBytes) {
      throw new Error(
        `${s.name}: expected ${String(s.seedBytes)} UTF-8 bytes, got ${String(bytes.length)}`,
      );
    }
    const words = fnvWords(bytes);
    return { ...s, words, values: sfc32(words, 10) };
  });
}
