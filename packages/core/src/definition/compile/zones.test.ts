import { describe, expect, it } from "vitest";
import { codePaths, doc, failure, STOCK, success } from "./compile.testing.js";

const zonesOf = (zones: unknown[], extra: Record<string, unknown> = {}) =>
  doc({ zones, ...extra });

describe("VC-214 zones (DFR-013, DFR-018)", () => {
  it("compiles a fixed zone, a template and a for_each zone per seat", () => {
    const def = success(
      zonesOf(
        [
          STOCK,
          { id: "discard", ordering: "unordered", owner_id: "e" },
          {
            id: "hand-{seat}",
            for_each: "seat",
            owner_id: "{seat}",
            ordering: "unordered",
          },
          {
            template: "meld",
            owner: "team",
            ordering: "ordered",
            max_instances: 8,
          },
        ],
        {
          seats: {
            list: [
              { id: "n", team: "ns" },
              { id: "e", team: "ew" },
            ],
            teams: ["ns", "ew"],
          },
        },
      ),
    );
    expect(def.zones.map((z) => [z.id, z.ordered, z.owner])).toEqual([
      ["stock", true, undefined],
      ["discard", false, "e"],
      ["hand-n", false, "n"],
      ["hand-e", false, "e"],
    ]);
    expect(def.zones[0]).toEqual({
      id: "stock",
      ordered: true,
      visibility: {},
    });
    expect(Object.hasOwn(def.zones[0] ?? {}, "owner")).toBe(false);
    expect(def.zoneTemplates).toEqual([
      {
        name: "meld",
        ownerRule: "team",
        ordered: true,
        maxInstances: 8,
        visibility: {},
      },
    ]);
  });

  it("accepts a team as owner_id", () => {
    const def = success(
      doc({
        seats: { list: [{ id: "a", team: "t" }], teams: ["t"] },
        zones: [{ id: "z", ordering: "ordered", owner_id: "t" }],
      }),
    );
    expect(def.zones[0]?.owner).toBe("t");
  });

  it("expands for_each: team in team order", () => {
    const def = success(
      doc({
        seats: {
          list: [
            { id: "a", team: "x" },
            { id: "b", team: "y" },
          ],
          teams: ["x", "y"],
        },
        zones: [
          {
            id: "pile-{team}",
            for_each: "team",
            owner_id: "{team}",
            ordering: "ordered",
          },
        ],
      }),
    );
    expect(def.zones.map((z) => z.id)).toEqual(["pile-x", "pile-y"]);
  });

  it("reports each zone error with code and path", () => {
    const cases: [string, unknown[], string, string][] = [
      [
        "missing ordering",
        [{ id: "z" }],
        "SCHEMA_MISSING",
        "zones[0].ordering",
      ],
      [
        "bad ordering",
        [{ id: "z", ordering: "sorted" }],
        "INVALID_VALUE",
        "zones[0].ordering",
      ],
      [
        "max_instances 0",
        [
          {
            template: "t",
            owner: "none",
            ordering: "ordered",
            max_instances: 0,
          },
        ],
        "INVALID_VALUE",
        "zones[0].max_instances",
      ],
      [
        "max_instances 257",
        [
          {
            template: "t",
            owner: "none",
            ordering: "ordered",
            max_instances: 257,
          },
        ],
        "INVALID_VALUE",
        "zones[0].max_instances",
      ],
      [
        "template with slash",
        [
          {
            template: "a/b",
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
          },
        ],
        "INVALID_VALUE",
        "zones[0].template",
      ],
      [
        "template 49 characters",
        [
          {
            template: "a".repeat(49),
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
          },
        ],
        "INVALID_VALUE",
        "zones[0].template",
      ],
      [
        "bad owner rule",
        [
          {
            template: "t",
            owner: "dealer",
            ordering: "ordered",
            max_instances: 1,
          },
        ],
        "INVALID_VALUE",
        "zones[0].owner",
      ],
      [
        "unknown owner_id",
        [{ id: "z", ordering: "ordered", owner_id: "ghost" }],
        "UNKNOWN_REFERENCE",
        "zones[0].owner_id",
      ],
      [
        "unknown key",
        [STOCK, { id: "z", ordering: "ordered", color: "red" }],
        "SCHEMA_UNKNOWN_KEY",
        "zones[1].color",
      ],
      [
        "unknown template key",
        [
          {
            template: "t",
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
            id: "x",
          },
        ],
        "SCHEMA_UNKNOWN_KEY",
        "zones[0].id",
      ],
      ["not a mapping", ["stock"], "SCHEMA_TYPE", "zones[0]"],
      [
        "bad for_each",
        [{ id: "z-{seat}", ordering: "ordered", for_each: "player" }],
        "INVALID_VALUE",
        "zones[0].for_each",
      ],
      [
        "seat placeholder without for_each",
        [{ id: "z-{seat}", ordering: "ordered" }],
        "INVALID_VALUE",
        "zones[0].id",
      ],
      ["duplicate id", [STOCK, STOCK], "DUPLICATE_ID", "zones[1].id"],
      [
        "duplicate for_each expansion",
        [{ id: "z", for_each: "seat", ordering: "ordered" }],
        "DUPLICATE_ID",
        "zones[0].id",
      ],
      [
        "duplicate template",
        [
          {
            template: "t",
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
          },
          {
            template: "t",
            owner: "none",
            ordering: "ordered",
            max_instances: 1,
          },
        ],
        "DUPLICATE_ID",
        "zones[1].template",
      ],
    ];
    for (const [name, zones, code, path] of cases) {
      const errors = failure(zonesOf(zones));
      expect(codePaths(errors), name).toContainEqual([code, path]);
    }
  });

  it("rejects a template named like a fixed zone, in either order", () => {
    const tpl = {
      template: "stock",
      owner: "none",
      ordering: "ordered",
      max_instances: 1,
    };
    expect(failure(zonesOf([STOCK, tpl]))[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "zones[1].template",
      entity: "stock",
    });
    expect(failure(zonesOf([tpl, STOCK]))[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "zones[1].id",
      entity: "stock",
    });
  });

  it("names the entity of an unknown owner", () => {
    expect(
      failure(
        zonesOf([{ id: "z", ordering: "ordered", owner_id: "ghost" }]),
      )[0],
    ).toMatchObject({ entity: "z" });
  });

  it("accepts 1000 zones and rejects 1001 with LIMIT_EXCEEDED", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `z${i}`,
        ordering: "ordered",
      }));
    expect(success(zonesOf(make(1000))).zones).toHaveLength(1000);
    expect(codePaths(failure(zonesOf(make(1001))))).toEqual([
      ["LIMIT_EXCEEDED", "zones"],
    ]);
  });

  it("counts zones after for_each expansion", () => {
    const items = Array.from({ length: 16 }, (_, i) => ({
      id: `z${i}-{seat}`,
      for_each: "seat",
      ordering: "ordered",
    }));
    expect(success(zonesOf(items)).zones).toHaveLength(64);
    const many = Array.from({ length: 17 }, (_, i) => ({
      id: `z${i}-{seat}`,
      for_each: "seat",
      ordering: "ordered",
    }));
    expect(codePaths(failure(zonesOf(many, { seats: { count: 64 } })))).toEqual(
      [["LIMIT_EXCEEDED", "zones"]],
    );
  });

  it("accepts a visibility block and compiles it to {} (known gap until iteration 4)", () => {
    const def = success(
      zonesOf([{ ...STOCK, visibility: { default: "hidden" } }]),
    );
    expect(def.zones[0]?.visibility).toEqual({});
  });
});

describe("VC-229 zone ids", () => {
  it("rejects a for_each zone id containing a space, naming the generated id", () => {
    const errors = failure(
      zonesOf([{ id: "hand {seat}", for_each: "seat", ordering: "ordered" }]),
    );
    expect(errors[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "zones[0].id",
      entity: "hand seat1",
    });
  });

  it("accepts a 128-character zone id and rejects 129", () => {
    expect(
      success(zonesOf([{ id: "z".repeat(128), ordering: "ordered" }])).zones,
    ).toHaveLength(1);
    expect(
      failure(zonesOf([{ id: "z".repeat(129), ordering: "ordered" }]))[0]?.code,
    ).toBe("INVALID_VALUE");
  });
});

describe("sections that depend on the seat layout", () => {
  it("are skipped, not cascaded, when seats failed", () => {
    const errors = failure(
      doc({
        seats: { count: 0 },
        zones: [{ id: "z", ordering: "ordered", owner_id: "ghost" }],
      }),
    );
    expect(codePaths(errors)).toEqual([["INVALID_VALUE", "seats.count"]]);
  });
});
