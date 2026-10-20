import { err, ok } from "../errors/index.js";
import type { Result } from "../errors/index.js";

/** Failure of {@link encodeUtf8}: `index` is the UTF-16 code-unit offset of the lone surrogate. */
export interface Utf8Error {
  readonly index: number;
}

/**
 * Encode a string as UTF-8 without `TextEncoder` (core compiles with `types: []`).
 * Lone surrogates are rejected (never replaced with U+FFFD); the result is `err({index})`.
 */
export function encodeUtf8(text: string): Result<Uint8Array, Utf8Error> {
  const n = text.length;
  // Worst case 3 bytes per code unit (a surrogate pair is 4 bytes for 2 units).
  const out = new Uint8Array(n * 3);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      out[o++] = c;
    } else if (c < 0x800) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < n ? text.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return err({ index: i });
      const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
      out[o++] = 0xf0 | (cp >> 18);
      out[o++] = 0x80 | ((cp >> 12) & 0x3f);
      out[o++] = 0x80 | ((cp >> 6) & 0x3f);
      out[o++] = 0x80 | (cp & 0x3f);
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return err({ index: i });
    } else {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 0x3f);
      out[o++] = 0x80 | (c & 0x3f);
    }
  }
  return ok(out.slice(0, o));
}
