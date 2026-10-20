import { describe, expect, it } from "vitest";
import { buildDefinition } from "../definition/definition.testing.js";
import { startState } from "./apply/apply.testing.js";
import { maskGates } from "./mask-gates.js";
import { getOwn, hasOwn, setOwn } from "./records.js";
import { variant } from "./state.testing.js";

describe("own-property record helpers", () => {
  it("never read inherited members and store __proto__ as data", () => {
    const record: Record<string, number> = {};
    expect(getOwn(record, "constructor")).toBeUndefined();
    expect(getOwn(record, "__proto__")).toBeUndefined();
    expect(hasOwn(record, "toString")).toBe(false);
    setOwn(record, "__proto__", 5);
    setOwn(record, "a", 1);
    expect(Object.keys(record)).toEqual(["__proto__", "a"]);
    expect(getOwn(record, "__proto__")).toBe(5);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect({ ...record, b: 2 }).toHaveProperty("b", 2);
    expect(Object.keys({ ...record })).toEqual(["__proto__", "a"]);
  });

  it("maskGates keeps an open gate named __proto__", () => {
    const state = variant(startState(buildDefinition()), (d) => {
      const gate = {
        schemaId: "q",
        expectedSeats: ["s1"],
        submissions: { s1: 1 },
      };
      Object.defineProperty(d.gates.open, "__proto__", {
        value: gate,
        enumerable: true,
      });
    });
    const masked = maskGates(state);
    expect(Object.keys(masked.gates.open)).toEqual(["__proto__"]);
    expect(
      Object.getOwnPropertyDescriptor(masked.gates.open, "__proto__")?.value,
    ).toEqual({
      schemaId: "q",
      expectedSeats: ["s1"],
      submitted: ["s1"],
    });
  });
});
