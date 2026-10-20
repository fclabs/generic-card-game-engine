import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fc from "fast-check";
import { sha256Hex } from "./sha256.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("sha256Hex (FIPS 180-4 vectors, VC-064)", () => {
  it("empty message", () => {
    expect(sha256Hex(enc(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it('"abc"', () => {
    expect(sha256Hex(enc("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("448-bit message", () => {
    expect(
      sha256Hex(
        enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      ),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
  it("one million 'a'", () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
  it("padding boundaries 54..65 bytes agree with node:crypto", () => {
    for (let n = 54; n <= 65; n++) {
      const b = new Uint8Array(n).fill(0xff);
      expect(sha256Hex(b)).toBe(createHash("sha256").update(b).digest("hex"));
    }
  });
  it("200 random byte strings agree with node:crypto", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        expect(sha256Hex(b)).toBe(createHash("sha256").update(b).digest("hex"));
      }),
      { numRuns: 200 },
    );
  });
});
