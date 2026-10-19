import { describe, it, expect } from "vitest";
import * as canonical from "./index.js";
import * as root from "../../index.js";

describe("VC-068 (partial) core/replay/canonical exports", () => {
  it("runtime exports are exactly canonicalize, sha256Hex, CanonicalError (stateDigest lands in iteration 4)", () => {
    expect(Object.keys(canonical).sort()).toEqual([
      "CanonicalError",
      "canonicalize",
      "sha256Hex",
    ]);
  });

  it("the package root re-exports each", () => {
    for (const name of [
      "canonicalize",
      "sha256Hex",
      "CanonicalError",
    ] as const) {
      expect(root[name]).toBe(canonical[name]);
    }
  });
});
