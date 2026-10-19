import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { encodeUtf8 } from "./utf8.js";

describe("encodeUtf8", () => {
  it("encodes 1-, 2-, 3- and 4-byte characters", () => {
    const r = encodeUtf8("Aé日\u{1f600}");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.value]).toEqual([
        0x41, 0xc3, 0xa9, 0xe6, 0x97, 0xa5, 0xf0, 0x9f, 0x98, 0x80,
      ]);
    }
  });

  it("encodes the empty string to zero bytes", () => {
    const r = encodeUtf8("");
    expect(r.ok && r.value.length).toBe(0);
  });

  it("rejects lone surrogates with their index", () => {
    for (const [s, index] of [
      ["\ud800", 0],
      ["\udc00", 0],
      ["ab\ud83d", 2],
      ["\ud83dx", 0],
      ["\ud83d😀", 0],
      ["x\ude00", 1],
    ] as const) {
      const r = encodeUtf8(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.index).toBe(index);
    }
  });

  it("matches TextEncoder on arbitrary well-formed strings", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const r = encodeUtf8(s);
        expect(r.ok).toBe(true);
        if (r.ok)
          expect([...r.value]).toEqual([...new TextEncoder().encode(s)]);
      }),
    );
  });
});
