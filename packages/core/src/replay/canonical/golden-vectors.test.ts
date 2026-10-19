import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalize } from "./canonicalize.js";
import { sha256Hex } from "./sha256.js";
import {
  buildGoldenVectors,
  encodeInput,
  GOLDEN_SOURCES,
  reviveInput,
  toHex,
} from "./generate-golden-vectors.testing.js";
import type { GoldenVector } from "./generate-golden-vectors.testing.js";

const FILE = new URL("./golden-vectors.json", import.meta.url);

if (process.env["UPDATE_GOLDEN"] === "1") {
  writeFileSync(FILE, JSON.stringify(buildGoldenVectors(), null, 2) + "\n");
}

const vectors = JSON.parse(readFileSync(FILE, "utf8")) as GoldenVector[];

describe("golden vectors (VC-060)", () => {
  it("has at least 25 uniquely named entries", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(25);
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
  });

  it("committed file equals the generator output", () => {
    expect(vectors).toEqual(JSON.parse(JSON.stringify(buildGoldenVectors())));
  });

  for (const v of vectors) {
    it(`${v.name}: bytes and digest match`, () => {
      const bytes = canonicalize(v.schema, reviveInput(v.schema, v.input));
      expect(toHex(bytes)).toBe(v.expectedHex);
      expect(new TextDecoder().decode(bytes)).toBe(v.expectedText);
      expect(toHex(new TextEncoder().encode(v.expectedText))).toBe(
        v.expectedHex,
      );
      expect(sha256Hex(bytes)).toBe(v.expectedDigest);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        v.expectedDigest,
      );
    });
  }

  it("input encoding round-trips", () => {
    for (const s of GOLDEN_SOURCES) {
      expect(reviveInput(s.schema, encodeInput(s.schema, s.input))).toEqual(
        s.input,
      );
    }
  });

  it("covers the VC-060 categories", () => {
    const names = vectors.map((v) => v.name).join(" ");
    for (const frag of [
      "empty-object",
      "nested-arrays",
      "bigint-zero",
      "bigint-minus-one",
      "bigint-2-pow-200",
      "quote-backslash",
      "control-chars",
      "del-raw",
      "line-separators",
      "astral",
      "non-ascii",
      "bool",
      "null-declared",
      "idmap-case-order",
      "idmap-code-unit-order",
      "json-unsorted-keys",
    ]) {
      expect(names).toContain(frag);
    }
  });
});
