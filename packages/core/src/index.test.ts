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
