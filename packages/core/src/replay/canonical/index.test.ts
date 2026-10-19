import { describe, it, expect } from "vitest";
import * as canonical from "./index.js";
import * as root from "../../index.js";

describe("VC-068 core/replay/canonical exports", () => {
  it("runtime exports are exactly canonicalize, stateDigest, sha256Hex, CanonicalError", () => {
    expect(Object.keys(canonical).sort()).toEqual([
      "CanonicalError",
      "canonicalize",
      "sha256Hex",
      "stateDigest",
    ]);
  });

  it("the package root re-exports each", () => {
    for (const name of [
      "canonicalize",
      "stateDigest",
      "sha256Hex",
      "CanonicalError",
    ] as const) {
      expect(root[name]).toBe(canonical[name]);
    }
  });
});
