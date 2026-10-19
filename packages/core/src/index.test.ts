import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import "./index.js";

describe("package loads", () => {
  it("loads", () => {
    expect(true).toBe(true);
  });
});

describe("property placeholder", () => {
  it("n + 0 === n", () => {
    fc.assert(fc.property(fc.integer(), (n) => n + 0 === n));
  });
});

describe("root exports (iteration 1)", () => {
  it("re-exports ids, errors and snapshot primitives", async () => {
    const api = await import("./index.js");
    for (const name of [
      "isCardId",
      "cardId",
      "isSeq",
      "seq",
      "ERROR_CODES",
      "ok",
      "err",
      "deepFreeze",
    ]) {
      expect(api).toHaveProperty(name);
    }
  });
});
