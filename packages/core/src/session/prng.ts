import { err, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";
import { encodeUtf8 } from "../util/utf8.js";

/** An immutable source of unsigned 32-bit integers; every draw returns the next stream. */
export interface Uint32Stream {
  readonly nextUint32: () => {
    readonly value: number;
    readonly next: Uint32Stream;
  };
}

/** The seeded sfc32 generator of spec §6.3. Immutable: drawing never changes it. */
export type Prng = Uint32Stream;

const MAX_SEED_BYTES = 256;
const MASK_128 = (1n << 128n) - 1n;
const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const DISCARD = 12;
const TWO_32 = 4294967296;

type Words = readonly [number, number, number, number];

/** §6.3 step 1: 128-bit FNV-1a over the bytes, split big-endian into four uint32 words. */
function mixSeed(bytes: Uint8Array): Words {
  let h = FNV_OFFSET;
  for (const byte of bytes) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK_128;
  }
  const word = (shift: bigint): number =>
    Number((h >> shift) & 0xffffffffn) | 0;
  return [word(96n), word(64n), word(32n), word(0n)];
}

/** §6.3 step 2: one sfc32 step. Words are held as int32 values. */
function step(w: Words): { readonly output: number; readonly words: Words } {
  let [a, b, c, d] = w;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  return { output: t >>> 0, words: [a, b, c, d] };
}

class Sfc32 implements Uint32Stream {
  private readonly words: Words;
  constructor(words: Words) {
    this.words = words;
    Object.freeze(this);
  }
  readonly nextUint32 = (): {
    readonly value: number;
    readonly next: Uint32Stream;
  } => {
    const { output, words } = step(this.words);
    return { value: output, next: new Sfc32(words) };
  };
}

/** UTF-8 encode and length-check a seed; shared by {@link createPrng} and {@link seedWords}. */
function seedBytes(seed: string): Result<Uint8Array> {
  const enc = encodeUtf8(seed);
  if (!enc.ok) {
    return err({
      code: "MALFORMED_ACTION",
      detail: `seed contains a lone surrogate at index ${String(enc.error.index)}`,
    });
  }
  if (enc.value.length > MAX_SEED_BYTES) {
    return err({
      code: "MALFORMED_ACTION",
      detail: `seed is ${String(enc.value.length)} UTF-8 bytes, over the ${String(MAX_SEED_BYTES)} byte limit`,
    });
  }
  return ok(enc.value);
}

/**
 * The four uint32 words `a, b, c, d` (as unsigned numbers) produced by the FNV-1a seed mix
 * of `seed`, before any sfc32 step. Exposed for golden vectors; not exported from the index.
 */
export function seedWords(seed: string): Result<readonly number[]> {
  const bytes = seedBytes(seed);
  if (!bytes.ok) return bytes;
  return ok(mixSeed(bytes.value).map((x) => x >>> 0));
}

/** Create a seeded stream (spec §6.3 steps 1-2, first 12 outputs discarded). */
export function createPrng(seed: string): Result<Prng> {
  const bytes = seedBytes(seed);
  if (!bytes.ok) return bytes;
  let words = mixSeed(bytes.value);
  for (let i = 0; i < DISCARD; i++) words = step(words).words;
  return ok(new Sfc32(words));
}

/**
 * Unbiased draw in `[0, n)` by rejection sampling (spec §6.3 step 3). Rejected draws are
 * consumed. Throws (programmer error) unless `n` is an integer in `[1, 2^32]`.
 */
export function uniform(
  stream: Uint32Stream,
  n: number,
): { readonly value: number; readonly next: Uint32Stream } {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
    throw new RangeError(
      `uniform: n must be an integer in [1, 2^32], got ${String(n)}`,
    );
  }
  const limit = Math.floor(TWO_32 / n) * n;
  let s = stream;
  for (;;) {
    const draw = s.nextUint32();
    s = draw.next;
    if (draw.value < limit) return { value: draw.value % n, next: s };
  }
}

/** Fisher-Yates over the input order (spec §6.3 step 4); `ids` is never modified. */
export function shufflePermutation<T>(
  stream: Uint32Stream,
  ids: readonly T[],
): { readonly permutation: readonly T[]; readonly next: Uint32Stream } {
  const out = ids.slice();
  let s = stream;
  for (let i = out.length - 1; i >= 1; i--) {
    const draw = uniform(s, i + 1);
    s = draw.next;
    const a = out[i] as T;
    out[i] = out[draw.value] as T;
    out[draw.value] = a;
  }
  return { permutation: out, next: s };
}
