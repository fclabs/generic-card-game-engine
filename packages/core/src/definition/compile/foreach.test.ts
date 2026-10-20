import { describe, expect, it } from "vitest";
import { createErrorCollector } from "./errors.js";
import {
  expandForEach,
  forEachBindings,
  substitutePlaceholders,
} from "./foreach.js";

const scope = { seats: ["n", "e", "s"], teams: ["ns", "ew"] };

describe("for_each expansion (DFR-018)", () => {
  it("expands per seat in declaration order", () => {
    const c = createErrorCollector();
    const out = expandForEach(c, scope, "seat", "zones[0]", {
      id: "hand-{seat}",
      owner_id: "{seat}",
    });
    expect(out).toEqual([
      { id: "hand-n", owner_id: "n" },
      { id: "hand-e", owner_id: "e" },
      { id: "hand-s", owner_id: "s" },
    ]);
    expect(c.count).toBe(0);
  });

  it("expands per team", () => {
    const c = createErrorCollector();
    expect(expandForEach(c, scope, "team", "p", { id: "m-{team}" })).toEqual([
      { id: "m-ns" },
      { id: "m-ew" },
    ]);
  });

  it("without for_each yields one instance and keeps literal text", () => {
    const c = createErrorCollector();
    expect(expandForEach(c, scope, undefined, "p", { id: "pot" })).toEqual([
      { id: "pot" },
    ]);
  });

  it("rejects a placeholder without a matching for_each", () => {
    const c = createErrorCollector();
    expect(
      expandForEach(
        c,
        scope,
        undefined,
        "zones[1]",
        { id: "h-{seat}" },
        "h-{seat}",
      ),
    ).toBeUndefined();
    expect(c.errors()).toEqual([
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "zones[1].id",
        entity: "h-{seat}",
      }),
    ]);
  });

  it("rejects {team} under for_each: seat and unknown placeholders once", () => {
    const c = createErrorCollector();
    expect(
      expandForEach(c, scope, "seat", "p", { id: "{team}" }),
    ).toBeUndefined();
    expect(expandForEach(c, scope, "seat", "p", { id: "{x}" })).toBeUndefined();
    expect(c.count).toBe(2);
  });

  it("rejects for_each: team in a game with no teams", () => {
    const c = createErrorCollector();
    expect(
      forEachBindings(
        c,
        { seats: ["a"], teams: [] },
        "team",
        "counters[0].for_each",
      ),
    ).toBeUndefined();
    expect(c.errors()[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "counters[0].for_each",
    });
  });

  it("rejects unmatched braces", () => {
    const c = createErrorCollector();
    expect(
      substitutePlaceholders(c, "a{seat", { seat: "x" }, "p"),
    ).toBeUndefined();
    expect(substitutePlaceholders(c, "a}", { seat: "x" }, "p")).toBeUndefined();
    expect(c.count).toBe(2);
  });
});
