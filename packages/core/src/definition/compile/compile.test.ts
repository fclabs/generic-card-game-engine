import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileDefinition } from "./compile.js";
import type { CompileResult } from "./compile.js";
import { DEFINITION_ERROR_CODES, MAX_DEFINITION_ERRORS } from "./errors.js";
import type { DefinitionError } from "./errors.js";

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "hearts",
  action_schema_version: 1,
  seats: { count: 4 },
  ...over,
});

function failure(raw: unknown): readonly DefinitionError[] {
  const r: CompileResult = compileDefinition(raw);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
}

function success(raw: unknown) {
  const r = compileDefinition(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

const seatsOf = (seats: unknown) => failure(base({ seats }));

describe("error vocabulary (DFR-030)", () => {
  it("lists the 22 codes once", () => {
    expect(DEFINITION_ERROR_CODES).toHaveLength(22);
    expect(new Set(DEFINITION_ERROR_CODES).size).toBe(22);
  });
});

describe("VC-211 (partial): totality and strictness", () => {
  it("never throws for 1000 random values", () => {
    const anyValue = fc.anything({ withNullPrototype: true, withBigInt: true });
    fc.assert(
      fc.property(anyValue, (raw) => {
        const r = compileDefinition(raw);
        if (r.ok) return true;
        return (
          r.errors.length >= 1 &&
          r.errors.length <= MAX_DEFINITION_ERRORS &&
          r.errors.every((e) => DEFINITION_ERROR_CODES.includes(e.code))
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("never throws for random objects shaped like a definition", () => {
    const junk = fc.anything();
    fc.assert(
      fc.property(junk, junk, junk, (a, b, c) => {
        compileDefinition({ id: a, action_schema_version: b, seats: c });
        return true;
      }),
      { numRuns: 1000 },
    );
  });

  it("reports a non-object root as SCHEMA_TYPE at the root", () => {
    for (const raw of [null, 3, "x", [], undefined]) {
      expect(failure(raw)).toEqual([
        expect.objectContaining({ code: "SCHEMA_TYPE", path: "" }),
      ]);
    }
  });

  it("reports an unknown top-level key with its path", () => {
    const errors = failure(base({ colour: 1 }));
    expect(errors).toEqual([
      expect.objectContaining({ code: "SCHEMA_UNKNOWN_KEY", path: "colour" }),
    ]);
  });

  it("reports missing required keys in section order", () => {
    const errors = failure({});
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ["SCHEMA_MISSING", "id"],
      ["SCHEMA_MISSING", "action_schema_version"],
      ["SCHEMA_MISSING", "seats"],
    ]);
  });

  it('reports seats: "four" as SCHEMA_TYPE', () => {
    expect(seatsOf("four")).toEqual([
      expect.objectContaining({ code: "SCHEMA_TYPE", path: "seats" }),
    ]);
  });

  it("accepts every known section key as absent", () => {
    expect(compileDefinition(base()).ok).toBe(true);
  });

  it("caps at 100 errors, keeps order and sets truncated", () => {
    const seats = {
      list: Array.from({ length: 64 }, () => ({ id: "dup", team: "nope" })),
    };
    const r = compileDefinition(base({ seats }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(MAX_DEFINITION_ERRORS);
    expect(r.truncated).toBe(true);
    // 63 DUPLICATE_ID + 64 UNKNOWN_REFERENCE exist; document order interleaves per seat.
    expect(r.errors[0]?.path).toBe("seats.list[0].team");
    expect(r.errors[1]?.path).toBe("seats.list[1].id");
  });

  it("does not set truncated for exactly 100 errors", () => {
    const seats = {
      list: Array.from({ length: 50 }, (_, i) => ({
        id: `s${i}`,
        team: "x",
        extra: 1,
      })),
    };
    const r = compileDefinition(base({ seats }));
    if (r.ok) throw new Error("expected failure");
    expect(r.errors).toHaveLength(100);
    expect(r.truncated).toBe(false);
  });

  it("is deterministic", () => {
    const raw = base({ seats: { count: 3 } });
    expect(compileDefinition(raw)).toEqual(compileDefinition(raw));
  });
});

describe("VC-212: id and action_schema_version (DFR-011)", () => {
  it.each(["Hearts", "", "a".repeat(65), "-x", "a b"])(
    "rejects id %j",
    (id) => {
      const errors = failure(base({ id }));
      expect(errors).toEqual([
        expect.objectContaining({ code: "INVALID_VALUE", path: "id" }),
      ]);
    },
  );

  it("accepts a 64-character id and a leading digit", () => {
    expect(success(base({ id: "a".repeat(64) })).gameId).toBe("a".repeat(64));
    expect(success(base({ id: "1_a-b" })).gameId).toBe("1_a-b");
  });

  it("rejects a non-string id as SCHEMA_TYPE", () => {
    expect(failure(base({ id: 4 }))[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "id",
    });
  });

  it.each([2, 0, -1])("rejects action_schema_version %j", (v) => {
    expect(failure(base({ action_schema_version: v }))).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA_VERSION",
        path: "action_schema_version",
      }),
    ]);
  });

  it("classifies a float, string and unsafe integer version", () => {
    expect(failure(base({ action_schema_version: 1.5 }))[0]?.code).toBe(
      "SCHEMA_TYPE",
    );
    expect(failure(base({ action_schema_version: "1" }))[0]?.code).toBe(
      "SCHEMA_TYPE",
    );
    expect(failure(base({ action_schema_version: 2 ** 60 }))[0]?.code).toBe(
      "INVALID_VALUE",
    );
  });

  it("accepts 1 and sets schemaVersion", () => {
    const def = success(base());
    expect(def.schemaVersion).toBe(1);
    expect(def.gameId).toBe("hearts");
  });
});

describe("VC-213: seats (DFR-012)", () => {
  it("count 4 yields seat1..seat4 with no teams", () => {
    const def = success(base());
    expect(def.seats.map((s) => s.id)).toEqual([
      "seat1",
      "seat2",
      "seat3",
      "seat4",
    ]);
    expect(def.teams).toEqual([]);
    expect(def.control.turnOrder).toEqual(def.seats.map((s) => s.id));
    expect(def.control.initialActiveSeats).toEqual(["seat1"]);
  });

  it("count with prefix yields p1..p4", () => {
    const def = success(base({ seats: { count: 4, prefix: "p" } }));
    expect(def.seats.map((s) => s.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("list with teams preserves the layout and order", () => {
    const def = success(
      base({
        seats: {
          list: [
            { id: "north", team: "ns" },
            { id: "east", team: "ew" },
            { id: "south", team: "ns" },
            { id: "west", team: "ew" },
          ],
          teams: ["ns", "ew"],
        },
      }),
    );
    expect(def.seats).toEqual([
      { id: "north", team: "ns" },
      { id: "east", team: "ew" },
      { id: "south", team: "ns" },
      { id: "west", team: "ew" },
    ]);
    expect(def.teams).toEqual(["ns", "ew"]);
  });

  it("omits team on a seat without one", () => {
    const def = success(base({ seats: { list: [{ id: "a" }, { id: "b" }] } }));
    expect(def.seats).toEqual([{ id: "a" }, { id: "b" }]);
    expect(Object.keys(def.seats[0] ?? {})).toEqual(["id"]);
  });

  it("rejects count with teams", () => {
    expect(seatsOf({ count: 2, teams: ["a"] })).toEqual([
      expect.objectContaining({ code: "INVALID_VALUE", path: "seats.teams" }),
    ]);
  });

  it("rejects list together with count", () => {
    expect(seatsOf({ list: [{ id: "a" }], count: 1 })).toEqual([
      expect.objectContaining({ code: "INVALID_VALUE", path: "seats" }),
    ]);
  });

  it("rejects neither list nor count", () => {
    expect(seatsOf({})).toEqual([
      expect.objectContaining({ code: "INVALID_VALUE", path: "seats" }),
    ]);
  });

  it("rejects zero seats (count 0, empty list)", () => {
    expect(seatsOf({ count: 0 })).toEqual([
      expect.objectContaining({ code: "INVALID_VALUE", path: "seats.count" }),
    ]);
    expect(seatsOf({ list: [] })).toEqual([
      expect.objectContaining({ code: "INVALID_VALUE", path: "seats.list" }),
    ]);
  });

  it("rejects a team without a seat", () => {
    expect(
      seatsOf({ list: [{ id: "a", team: "x" }], teams: ["x", "y"] }),
    ).toEqual([
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "seats.teams[1]",
        entity: "y",
      }),
    ]);
  });

  it("65 seats is LIMIT_EXCEEDED at seats, for count and list", () => {
    expect(seatsOf({ count: 65 })).toEqual([
      expect.objectContaining({ code: "LIMIT_EXCEEDED", path: "seats" }),
    ]);
    const list = Array.from({ length: 65 }, (_, i) => ({ id: `s${i}` }));
    expect(seatsOf({ list })).toEqual([
      expect.objectContaining({ code: "LIMIT_EXCEEDED", path: "seats" }),
    ]);
    expect(success(base({ seats: { count: 64 } })).seats).toHaveLength(64);
  });

  it("33 teams is LIMIT_EXCEEDED at seats.teams", () => {
    const list = Array.from({ length: 33 }, (_, i) => ({
      id: `s${i}`,
      team: `t${i}`,
    }));
    const teams = list.map((s) => s.team);
    expect(seatsOf({ list, teams })).toEqual([
      expect.objectContaining({ code: "LIMIT_EXCEEDED", path: "seats.teams" }),
    ]);
  });

  it("a seat naming an undeclared team is UNKNOWN_REFERENCE", () => {
    expect(
      seatsOf({ list: [{ id: "a", team: "x" }], teams: ["y"] })[0],
    ).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: "seats.list[0].team",
      entity: "x",
    });
    expect(seatsOf({ list: [{ id: "a", team: "x" }] })[0]).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      entity: "x",
    });
  });

  it("duplicate seat and team ids are DUPLICATE_ID at the second occurrence", () => {
    expect(seatsOf({ list: [{ id: "a" }, { id: "a" }] })).toEqual([
      expect.objectContaining({
        code: "DUPLICATE_ID",
        path: "seats.list[1].id",
        entity: "a",
      }),
    ]);
    expect(
      seatsOf({ list: [{ id: "a", team: "t" }], teams: ["t", "t"] })[0],
    ).toMatchObject({
      code: "DUPLICATE_ID",
      path: "seats.teams[1]",
      entity: "t",
    });
  });

  it("14 seats and 4 teams compile", () => {
    const teams = ["t1", "t2", "t3", "t4"];
    const list = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i + 1}`,
      team: teams[i % 4],
    }));
    const def = success(base({ seats: { list, teams } }));
    expect(def.seats).toHaveLength(14);
    expect(def.teams).toEqual(teams);
  });

  it("rejects prefix with list, wrong types and unknown keys", () => {
    expect(seatsOf({ list: [{ id: "a" }], prefix: "p" })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "seats.prefix",
    });
    expect(seatsOf({ count: 1.5 })[0]?.code).toBe("SCHEMA_TYPE");
    expect(seatsOf({ count: "4" })[0]?.code).toBe("SCHEMA_TYPE");
    expect(seatsOf({ count: 2, prefix: 3 })[0]?.code).toBe("SCHEMA_TYPE");
    expect(seatsOf({ count: 2, extra: 1 })[0]).toMatchObject({
      code: "SCHEMA_UNKNOWN_KEY",
      path: "seats.extra",
    });
    expect(seatsOf({ list: "x" })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "seats.list",
    });
    expect(seatsOf({ list: [{ team: "x" }] })[0]).toMatchObject({
      code: "SCHEMA_MISSING",
      path: "seats.list[0].id",
    });
    expect(seatsOf({ list: [3] })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "seats.list[0]",
    });
    expect(seatsOf({ list: [{ id: "a" }], teams: "x" })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "seats.teams",
    });
    expect(seatsOf({ list: [{ id: "a", team: 3 }] })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "seats.list[0].team",
    });
  });
});

describe("VC-229 (partial): id charset for seats (DFR-027)", () => {
  it('prefix "Seat " is INVALID_VALUE naming "Seat 1"', () => {
    expect(seatsOf({ count: 3, prefix: "Seat " })).toEqual([
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "seats.prefix",
        entity: "Seat 1",
      }),
    ]);
  });

  it("a prefix producing ids over 128 characters is INVALID_VALUE", () => {
    expect(seatsOf({ count: 2, prefix: "a".repeat(128) })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "seats.prefix",
    });
  });

  it("accepts 128-character ids with every allowed character", () => {
    const all = "AZaz09_.:/-";
    const id128 = (all.repeat(12) + "x".repeat(128)).slice(0, 128);
    const def = success(
      base({ seats: { list: [{ id: id128, team: id128 }], teams: [id128] } }),
    );
    expect(def.seats[0]?.id).toHaveLength(128);
    const prefix = "p".repeat(126);
    expect(
      success(base({ seats: { count: 9, prefix } })).seats[8]?.id,
    ).toHaveLength(127);
  });

  it("rejects explicit seat and team ids outside the charset", () => {
    expect(seatsOf({ list: [{ id: "a b" }] })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "seats.list[0].id",
      entity: "a b",
    });
    expect(
      seatsOf({ list: [{ id: "a", team: "x" }], teams: ["x y"] })[0],
    ).toMatchObject({
      code: "INVALID_VALUE",
      path: "seats.teams[0]",
    });
    expect(seatsOf({ list: [{ id: "a".repeat(129) }] })[0]?.code).toBe(
      "INVALID_VALUE",
    );
  });
});
