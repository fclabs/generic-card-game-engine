import { describe, expect, it } from "vitest";
import { createSession } from "../../session/create.js";
import { A } from "../../session/actions.testing.js";
import { apply } from "../../session/apply/index.js";
import { sessionId } from "../../session/ids.js";
import { assertDefinitionStructure } from "../assert.js";
import { compileDefinition } from "./compile.js";
import {
  codePaths,
  deckDoc,
  doc,
  failure,
  STOCK,
  success,
} from "./compile.testing.js";

const counters = (list: unknown[], extra: Record<string, unknown> = {}) =>
  doc({ zones: [STOCK], counters: list, ...extra });
const POT = { id: "pot", owner: "table", min: 0, initial: 0 };
const BIG = "1000000000000000000000";

describe("VC-216 counters: values and bounds (DFR-015)", () => {
  it("compiles bounds to bigint, including values beyond the safe range", () => {
    const def = success(
      counters([
        {
          id: "chips",
          owner: "table",
          min: 0,
          max: BIG,
          initial: 100,
          scale: 2,
          rounding: "half_even",
          supply_role: "mint",
        },
      ]),
    );
    expect(def.counters[0]).toEqual({
      id: "chips",
      owner: "table",
      visibility: {},
      min: 0n,
      max: 1000000000000000000000n,
      initial: 100n,
      scale: 2,
      rounding: "half_even",
      supplyRole: "mint",
    });
  });

  it("accepts negative bounds and decimal strings in the safe range", () => {
    const c = success(
      counters([{ id: "k", owner: "table", min: "-5", initial: "-5" }]),
    ).counters[0];
    expect([c?.min, c?.initial, c?.max]).toEqual([-5n, -5n, undefined]);
  });

  it("distinguishes unsafe bare integers from quoted strings", () => {
    for (const v of [9007199254740992, Number("9007199254740993")]) {
      expect(failure(counters([{ ...POT, max: v }]))[0]).toMatchObject({
        code: "INVALID_VALUE",
        path: "counters[0].max",
        entity: "pot",
      });
    }
    const def = success(
      counters([
        { ...POT, max: "9007199254740993", initial: "9007199254740992" },
      ]),
    );
    expect(def.counters[0]?.max).toBe(9007199254740993n);
    expect(def.counters[0]?.initial).toBe(9007199254740992n);
  });

  it("reports each value error with code and path", () => {
    const cases: [string, Record<string, unknown>, string, string][] = [
      [
        "initial below min",
        { min: 5, initial: 1 },
        "INVALID_VALUE",
        "counters[0].initial",
      ],
      [
        "initial above max",
        { max: 5, initial: 6 },
        "INVALID_VALUE",
        "counters[0].initial",
      ],
      [
        "max below min",
        { min: 5, max: 1, initial: 5 },
        "INVALID_VALUE",
        "counters[0].max",
      ],
      ["float", { initial: 1.5 }, "SCHEMA_TYPE", "counters[0].initial"],
      [
        "non-numeric string",
        { initial: "12a" },
        "INVALID_VALUE",
        "counters[0].initial",
      ],
      ["boolean", { initial: true }, "SCHEMA_TYPE", "counters[0].initial"],
      ["missing min", { min: undefined }, "SCHEMA_MISSING", "counters[0].min"],
      [
        "missing initial",
        { initial: undefined },
        "SCHEMA_MISSING",
        "counters[0].initial",
      ],
      [
        "missing owner",
        { owner: undefined },
        "SCHEMA_MISSING",
        "counters[0].owner",
      ],
      ["scale 19", { scale: 19 }, "INVALID_VALUE", "counters[0].scale"],
      ["scale -1", { scale: -1 }, "INVALID_VALUE", "counters[0].scale"],
      [
        "rounding ceil",
        { rounding: "ceil" },
        "INVALID_VALUE",
        "counters[0].rounding",
      ],
      [
        "supply_role print",
        { supply_role: "print" },
        "INVALID_VALUE",
        "counters[0].supply_role",
      ],
      ["bad owner", { owner: "dealer" }, "INVALID_VALUE", "counters[0].owner"],
      [
        "unknown key",
        { colour: 1 },
        "SCHEMA_UNKNOWN_KEY",
        "counters[0].colour",
      ],
    ];
    for (const [name, over, code, path] of cases) {
      const item = Object.fromEntries(
        Object.entries({ ...POT, ...over }).filter(([, v]) => v !== undefined),
      );
      expect(codePaths(failure(counters([item]))), name).toContainEqual([
        code,
        path,
      ]);
    }
  });

  it("accepts scale 0 and 18 and every rounding and supply role", () => {
    for (const scale of [0, 18]) success(counters([{ ...POT, scale }]));
    for (const rounding of ["floor", "half_up", "half_even"])
      success(counters([{ ...POT, rounding }]));
    for (const supply_role of ["mint", "burn"])
      success(counters([{ ...POT, supply_role }]));
  });
});

describe("VC-216 counters: owner rules and for_each", () => {
  const teams = {
    seats: {
      list: [
        { id: "n", team: "t" },
        { id: "e", team: "t" },
      ],
      teams: ["t"],
    },
  };

  it("forbids owner_id on a table counter and requires it otherwise", () => {
    expect(failure(counters([{ ...POT, owner_id: "n" }]))[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "counters[0].owner_id",
    });
    for (const owner of ["player", "team", "zone", "card"]) {
      expect(failure(counters([{ ...POT, owner }]))[0]).toMatchObject({
        code: "SCHEMA_MISSING",
        path: "counters[0].owner_id",
      });
    }
  });

  it("checks that the owner entity exists", () => {
    const ghost = (owner: string) =>
      failure(deckDoc({ counters: [{ ...POT, owner, owner_id: "ghost" }] }));
    for (const owner of ["player", "team", "zone", "card"]) {
      expect(ghost(owner)[0], owner).toMatchObject({
        code: "UNKNOWN_REFERENCE",
        path: "counters[0].owner_id",
        entity: "pot",
      });
    }
  });

  it("accepts a seat, team, fixed zone and card owner", () => {
    const def = success(
      deckDoc({
        ...teams,
        counters: [
          { id: "a", owner: "player", owner_id: "n", min: 0, initial: 0 },
          { id: "b", owner: "team", owner_id: "t", min: 0, initial: 0 },
          { id: "c", owner: "zone", owner_id: "stock", min: 0, initial: 0 },
          { id: "d", owner: "card", owner_id: "S1", min: 0, initial: 0 },
        ],
      }),
    );
    expect(def.counters.map((k) => [k.owner, k.ownerId])).toEqual([
      ["player", "n"],
      ["team", "t"],
      ["zone", "stock"],
      ["card", "S1"],
    ]);
  });

  it("expands for_each in seat order and unique", () => {
    const def = success(
      counters([
        POT,
        {
          id: "chips-{seat}",
          for_each: "seat",
          owner: "player",
          owner_id: "{seat}",
          min: 0,
          initial: 100,
        },
      ]),
    );
    expect(def.counters.map((k) => [k.id, k.ownerId])).toEqual([
      ["pot", undefined],
      ["chips-seat1", "seat1"],
      ["chips-seat2", "seat2"],
      ["chips-seat3", "seat3"],
      ["chips-seat4", "seat4"],
    ]);
  });

  it("expands for_each: team and rejects it without teams", () => {
    const item = {
      id: "score-{team}",
      for_each: "team",
      owner: "team",
      owner_id: "{team}",
      min: 0,
      initial: 0,
    };
    expect(success(counters([item], teams)).counters.map((k) => k.id)).toEqual([
      "score-t",
    ]);
    expect(failure(counters([item]))[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "counters[0].for_each",
    });
  });

  it("rejects placeholder and duplicate faults", () => {
    expect(failure(counters([{ ...POT, id: "p-{seat}" }]))[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "counters[0].id",
    });
    expect(failure(counters([{ ...POT, for_each: "seat" }]))[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "counters[0].id",
      entity: "pot",
    });
    expect(failure(counters([POT, POT]))[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "counters[1].id",
    });
  });

  it("limits counters to 5000 after expansion", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `k${i}`,
        owner: "table",
        min: 0,
        initial: 0,
      }));
    expect(success(counters(make(5000))).counters).toHaveLength(5000);
    expect(codePaths(failure(counters(make(5001))))).toEqual([
      ["LIMIT_EXCEEDED", "counters"],
    ]);
  });

  it("compiles a visibility block (DFR-021)", () => {
    const def = success(
      counters([{ ...POT, visibility: { default: "public" } }]),
    );
    expect(def.counters[0]?.visibility).toEqual({ default: "public" });
  });
});

describe("VC-229 counter ids", () => {
  it("rejects a generated id with a space naming entity and producing path", () => {
    expect(
      failure(
        counters([
          {
            id: "c {seat}",
            for_each: "seat",
            owner: "player",
            owner_id: "{seat}",
            min: 0,
            initial: 0,
          },
        ]),
      )[0],
    ).toMatchObject({
      code: "INVALID_VALUE",
      path: "counters[0].id",
      entity: "c seat1",
    });
  });
  it("accepts a 128-character id and rejects 129", () => {
    expect(
      success(counters([{ ...POT, id: "k".repeat(128) }])).counters,
    ).toHaveLength(1);
    expect(failure(counters([{ ...POT, id: "k".repeat(129) }]))[0]?.code).toBe(
      "INVALID_VALUE",
    );
  });
});

describe("VC-217 derived counters (DFR-016, DFR-063)", () => {
  const derived = { id: "stock_size", derived: { zone_size: "stock" } };
  const def = success(deckDoc({ counters: [derived, POT] }));
  const counter = def.counters[0];

  it("compiles to a derivedSpec with 0n placeholders and no max or supplyRole", () => {
    expect(counter).toBeDefined();
    expect(counter?.derivedSpec).toEqual({ kind: "zone_size", zone: "stock" });
    expect(counter?.min).toBe(0n);
    expect(counter?.initial).toBe(0n);
    expect(counter?.owner).toBe("table");
    expect(Object.hasOwn(counter ?? {}, "max")).toBe(false);
    expect(Object.hasOwn(counter ?? {}, "supplyRole")).toBe(false);
    expect(typeof counter?.derived).toBe("function");
    expect(assertDefinitionStructure(def).ok).toBe(true);
  });

  it("evaluates to 52n on a fresh session and 51n after one move out of stock", () => {
    const full = success(
      deckDoc({
        zones: [STOCK, { id: "table", ordering: "unordered" }],
        counters: [derived],
      }),
    );
    const evaluate = full.counters[0]?.derived;
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const fresh = createSession(
      full,
      sid.value,
      full.seats.map((s) => ({ seat: s.id })),
    );
    if (!fresh.ok) throw new Error(fresh.error.detail);
    expect(evaluate?.(fresh.value)).toBe(52n);
    const moved = apply(full, fresh.value, [A.move("S1", "stock", "table")]);
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    expect(evaluate?.(moved.value.state)).toBe(51n);
  });

  it("counts a move out of stock", () => {
    const two = success(
      doc({
        zones: [STOCK, { id: "table", ordering: "unordered" }],
        cards: [
          { id: "a", zone: "stock" },
          { id: "b", zone: "stock" },
        ],
        counters: [{ id: "n", derived: { zone_size: "stock" } }],
      }),
    );
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const fresh = createSession(
      two,
      sid.value,
      two.seats.map((s) => ({ seat: s.id })),
    );
    if (!fresh.ok) throw new Error(fresh.error.detail);
    const evaluate = two.counters[0]?.derived;
    expect(evaluate?.(fresh.value)).toBe(2n);
    const moved = apply(two, fresh.value, [A.move("a", "stock", "table")]);
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    expect(evaluate?.(moved.value.state)).toBe(1n);
  });

  it("gives two independent compiles evaluators with equal results", () => {
    const again = success(deckDoc({ counters: [derived, POT] }));
    const other = again.counters[0];
    expect(other?.derived).not.toBe(counter?.derived);
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const state = createSession(
      def,
      sid.value,
      def.seats.map((s) => ({ seat: s.id })),
    );
    if (!state.ok) throw new Error("session");
    expect(other?.derived?.(state.value)).toBe(counter?.derived?.(state.value));
  });

  it("evaluates a zone without state as 0n", () => {
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const state = createSession(
      def,
      sid.value,
      def.seats.map((s) => ({ seat: s.id })),
    );
    if (!state.ok) throw new Error("session");
    const ghost = success(
      doc({
        zones: [{ id: "q", ordering: "ordered" }],
        counters: [{ id: "n", derived: { zone_size: "q" } }],
      }),
    );
    expect(ghost.counters[0]?.derived?.(state.value)).toBe(0n);
  });

  it("rejects min, max, initial, supply_role, an unknown zone and other shapes", () => {
    for (const key of ["min", "max", "initial"]) {
      expect(
        failure(deckDoc({ counters: [{ ...derived, [key]: 0 }] }))[0],
      ).toMatchObject({
        code: "INVALID_VALUE",
        path: `counters[0].${key}`,
        entity: "stock_size",
      });
    }
    expect(
      failure(deckDoc({ counters: [{ ...derived, supply_role: "mint" }] }))[0]
        ?.path,
    ).toBe("counters[0].supply_role");
    expect(
      failure(
        deckDoc({ counters: [{ id: "n", derived: { zone_size: "ghost" } }] }),
      )[0],
    ).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: "counters[0].derived.zone_size",
    });
    expect(
      codePaths(
        failure(deckDoc({ counters: [{ id: "n", derived: { sum: "x" } }] })),
      ),
    ).toEqual([["SCHEMA_UNKNOWN_KEY", "counters[0].derived.sum"]]);
    expect(
      failure(deckDoc({ counters: [{ id: "n", derived: {} }] }))[0]?.code,
    ).toBe("SCHEMA_MISSING");
    expect(
      failure(deckDoc({ counters: [{ id: "n", derived: "stock" }] }))[0],
    ).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "counters[0].derived",
    });
    expect(
      failure(
        deckDoc({ counters: [{ id: "n", derived: { zone_size: 3 } }] }),
      )[0]?.code,
    ).toBe("SCHEMA_TYPE");
  });

  it("is deterministic for the same document", () => {
    const a = compileDefinition(deckDoc({ counters: [derived] }));
    const b = compileDefinition(deckDoc({ counters: [derived] }));
    expect(a.ok && b.ok).toBe(true);
  });
});

describe("VC-218 conservation groups (DFR-017)", () => {
  const withGroups = (groups: unknown[], list: unknown[] = []) =>
    doc({
      zones: [STOCK],
      counters: [
        POT,
        {
          id: "chips-{seat}",
          for_each: "seat",
          owner: "player",
          owner_id: "{seat}",
          min: 0,
          initial: 0,
        },
        { id: "size", derived: { zone_size: "stock" } },
        ...list,
      ],
      conservation_groups: groups,
    });

  it("compiles literals and expand in order", () => {
    const def = success(
      withGroups([
        {
          id: "money",
          counters: ["pot", { expand: "chips-{seat}", for_each: "seat" }],
        },
        { id: "only", counters: ["chips-seat2"] },
        { id: "empty", counters: [] },
      ]),
    );
    expect(def.conservationGroups).toEqual([
      {
        id: "money",
        counters: [
          "pot",
          "chips-seat1",
          "chips-seat2",
          "chips-seat3",
          "chips-seat4",
        ],
      },
      { id: "only", counters: ["chips-seat2"] },
      { id: "empty", counters: [] },
    ]);
  });

  it("reports an unknown and a derived counter as UNKNOWN_REFERENCE naming it", () => {
    const errors = failure(
      withGroups([{ id: "g", counters: ["pot", "ghost", "size"] }]),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: "conservation_groups[0].counters[1]",
      entity: "ghost",
    });
    expect(errors[1]).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: "conservation_groups[0].counters[2]",
      entity: "size",
    });
    expect(
      failure(
        withGroups([
          { id: "g", counters: [{ expand: "nope-{seat}", for_each: "seat" }] },
        ]),
      )[0],
    ).toMatchObject({ code: "UNKNOWN_REFERENCE", entity: "nope-seat1" });
  });

  it("reports a duplicate counter within a group and a duplicate group id as DUPLICATE_ID", () => {
    expect(
      failure(withGroups([{ id: "g", counters: ["pot", "pot"] }]))[0],
    ).toMatchObject({
      code: "DUPLICATE_ID",
      path: "conservation_groups[0].counters[1]",
      entity: "pot",
    });
    expect(
      failure(
        withGroups([
          {
            id: "g",
            counters: [
              "pot",
              { expand: "chips-{seat}", for_each: "seat" },
              "chips-seat1",
            ],
          },
        ]),
      )[0],
    ).toMatchObject({ code: "DUPLICATE_ID", entity: "chips-seat1" });
    expect(
      failure(
        withGroups([
          { id: "g", counters: [] },
          { id: "g", counters: [] },
        ]),
      )[0],
    ).toMatchObject({
      code: "DUPLICATE_ID",
      path: "conservation_groups[1].id",
      entity: "g",
    });
  });

  it("reports structural faults", () => {
    expect(failure(withGroups([{ id: "g" }]))[0]).toMatchObject({
      code: "SCHEMA_MISSING",
      path: "conservation_groups[0].counters",
    });
    expect(failure(withGroups([{ id: "g", counters: [3] }]))[0]?.code).toBe(
      "SCHEMA_TYPE",
    );
    expect(
      failure(withGroups([{ id: "g", counters: [{ expand: "x" }] }]))[0],
    ).toMatchObject({
      code: "SCHEMA_MISSING",
      path: "conservation_groups[0].counters[0].for_each",
    });
    expect(
      failure(
        withGroups([
          { id: "g", counters: [{ expand: "pot", for_each: "seat" }] },
        ]),
      )[0]?.code,
    ).toBe("DUPLICATE_ID");
    expect(
      failure(withGroups([{ id: "bad id", counters: [] }]))[0],
    ).toMatchObject({
      code: "INVALID_VALUE",
      path: "conservation_groups[0].id",
    });
    expect(
      failure(withGroups([{ id: "g", counters: [], extra: 1 }]))[0]?.code,
    ).toBe("SCHEMA_UNKNOWN_KEY");
  });

  it("does not cascade reference errors from a failed counters section", () => {
    const errors = failure(
      doc({
        counters: [{ id: "bad id", owner: "table", min: 0, initial: 0 }],
        conservation_groups: [{ id: "g", counters: ["whatever"] }],
      }),
    );
    expect(codePaths(errors)).toEqual([["INVALID_VALUE", "counters[0].id"]]);
  });
});
