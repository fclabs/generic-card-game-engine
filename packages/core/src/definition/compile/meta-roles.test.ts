import { describe, expect, it } from "vitest";
import { codePaths, doc, failure, success } from "./compile.testing.js";
import type { HookBundleInfo } from "./references.js";
import { compileDefinition } from "./compile.js";

const field = (type: string, visibility?: string) => ({
  type,
  ...(visibility === undefined ? {} : { visibility }),
});
const meta = (schema: Record<string, unknown>) =>
  doc({ meta_schemas: [schema], hooks: { module: "./h.ts" } });
const BUNDLE: HookBundleInfo = { hash: "h", exports: ["red", "roster"] };
const compile = (raw: unknown) => compileDefinition(raw, { bundle: BUNDLE });
const errorsOf = (raw: unknown) => {
  const r = compile(raw);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
};

describe("VC-220 meta_schemas", () => {
  it("compiles reducerRef, fields and fieldVisibility", () => {
    const r = compile(
      doc({
        meta_schemas: [
          {
            id: "g.s",
            reducer: "red",
            fields: { a: field("int", "public"), b: field("json", "subject") },
          },
        ],
        roster_reducer: "roster",
        hooks: { module: "./h.ts" },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.metaSchemas).toEqual([
      {
        id: "g.s",
        fields: { a: "int", b: "json" },
        reducerRef: "red",
        fieldVisibility: { a: "public", b: "subject" },
      },
    ]);
    expect(r.value.rosterReducerRef).toBe("roster");
  });

  it("MISSING_REDUCER names the schema", () => {
    expect(errorsOf(meta({ id: "g.s" }))[0]).toMatchObject({
      code: "MISSING_REDUCER",
      path: "meta_schemas[0].reducer",
      entity: "g.s",
    });
  });

  it("INVALID_VISIBILITY for a missing or unknown field visibility", () => {
    const missing = errorsOf(
      meta({ id: "g.s", reducer: "red", fields: { p: field("int") } }),
    );
    expect(missing[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      path: "meta_schemas[0].fields.p.visibility",
      entity: "g.s",
    });
    expect(missing[0]?.detail).toContain('"p"');
    expect(
      errorsOf(
        meta({
          id: "g.s",
          reducer: "red",
          fields: { p: field("int", "private") },
        }),
      )[0]?.code,
    ).toBe("INVALID_VISIBILITY");
  });

  it("RESERVED_NAME and DUPLICATE_ID", () => {
    expect(
      errorsOf(meta({ id: "engine.custom", reducer: "red" }))[0],
    ).toMatchObject({
      code: "RESERVED_NAME",
      path: "meta_schemas[0].id",
    });
    const dup = errorsOf(
      doc({
        meta_schemas: [
          { id: "a", reducer: "red" },
          { id: "a", reducer: "red" },
        ],
        hooks: { module: "./h.ts" },
      }),
    );
    expect(dup[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "meta_schemas[1].id",
      entity: "a",
    });
  });

  it("rejects a bad export name and a bad roster_reducer", () => {
    expect(errorsOf(meta({ id: "a", reducer: "not valid" }))[0]?.code).toBe(
      "INVALID_VALUE",
    );
    expect(
      codePaths(
        errorsOf(doc({ roster_reducer: 5, hooks: { module: "./h.ts" } })),
      ),
    ).toEqual([["SCHEMA_TYPE", "roster_reducer"]]);
  });

  it("a card metadata_schema field without visibility is INVALID_VISIBILITY", () => {
    const raw = doc({
      zones: [{ id: "s", ordering: "ordered" }],
      cards: [{ id: "c", zone: "s", metadata_schema: { f: { type: "int" } } }],
    });
    expect(failure(raw)[0]?.code).toBe("INVALID_VISIBILITY");
  });
});

describe("VC-221 roles and visibility", () => {
  const zones = (visibility: unknown, extra: Record<string, unknown> = {}) => [
    { id: "z", ordering: "ordered", ...extra, visibility },
  ];
  const roles = [{ id: "spectator", subject: "forbidden" }];

  it("compiles a role and an owned zone's rules", () => {
    const def = success(
      doc({
        roles,
        zones: zones(
          { default: "hidden", spectator: "public", player: "owner" },
          { owner_id: "seat1" },
        ),
      }),
    );
    expect(def.roles).toEqual(roles);
    expect(def.zones[0]?.visibility).toEqual({
      default: "hidden",
      spectator: "public",
      player: "owner",
    });
  });

  it("omitted block compiles to {}", () => {
    expect(
      success(doc({ zones: [{ id: "z", ordering: "ordered" }] })).zones[0]
        ?.visibility,
    ).toEqual({});
  });

  it.each([
    ["unknown role", { referee: "public" }, "zones[0].visibility.referee"],
    ["unknown audience", { default: "secret" }, "zones[0].visibility.default"],
    [
      "owner on an unowned zone",
      { default: "owner" },
      "zones[0].visibility.default",
    ],
    [
      "team on an unowned zone",
      { player: "team" },
      "zones[0].visibility.player",
    ],
  ])("%s is INVALID_VISIBILITY naming the entity", (_n, v, path) => {
    expect(failure(doc({ zones: zones(v) }))[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      path,
      entity: "z",
    });
  });

  it("rejects owner/team on a none template and on a table counter", () => {
    expect(
      failure(
        doc({
          zones: [
            {
              template: "t",
              owner: "none",
              ordering: "ordered",
              max_instances: 1,
              visibility: { default: "owner" },
            },
          ],
        }),
      )[0],
    ).toMatchObject({ code: "INVALID_VISIBILITY", entity: "t" });
    expect(
      failure(
        doc({
          counters: [
            {
              id: "n",
              owner: "table",
              min: 0,
              initial: 0,
              visibility: { default: "team" },
            },
          ],
        }),
      )[0],
    ).toMatchObject({
      code: "INVALID_VISIBILITY",
      path: "counters[0].visibility.default",
      entity: "n",
    });
  });

  it("allows owner on an owned template and counter, and a non-mapping is SCHEMA_TYPE", () => {
    const def = success(
      doc({
        zones: [
          {
            template: "t",
            owner: "player",
            ordering: "ordered",
            max_instances: 2,
            visibility: { default: "owner" },
          },
        ],
        counters: [
          {
            id: "n",
            owner: "player",
            owner_id: "seat1",
            min: 0,
            initial: 0,
            visibility: { default: "owner" },
          },
        ],
      }),
    );
    expect(def.zoneTemplates[0]?.visibility).toEqual({ default: "owner" });
    expect(def.counters[0]?.visibility).toEqual({ default: "owner" });
    expect(failure(doc({ zones: zones("hidden") }))[0]?.code).toBe(
      "SCHEMA_TYPE",
    );
  });

  it("rejects a custom role named like a built-in or repeated", () => {
    const player = failure(
      doc({ roles: [{ id: "player", subject: "optional" }] }),
    );
    expect(player[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: "roles[0].id",
      entity: "player",
    });
    const dup = failure(doc({ roles: [...roles, ...roles] }));
    expect(dup[0]).toMatchObject({ code: "DUPLICATE_ID", path: "roles[1].id" });
    expect(
      failure(doc({ roles: [{ id: "x", subject: "maybe" }] }))[0]?.code,
    ).toBe("INVALID_VALUE");
  });

  it("skips the role-key check when roles failed", () => {
    expect(
      codePaths(
        failure(
          doc({
            roles: [{ id: "player", subject: "optional" }],
            zones: zones({ ghost: "public" }),
          }),
        ),
      ),
    ).toEqual([["DUPLICATE_ID", "roles[0].id"]]);
  });
});

describe("VC-222 view_keys", () => {
  it("defaults, accepts a subset, rejects bad lists", () => {
    expect(success(doc()).viewKeys).toEqual([
      "card_face",
      "zone_membership",
      "zone_count",
      "zone_order",
    ]);
    expect(success(doc({ view_keys: ["card_face"] })).viewKeys).toEqual([
      "card_face",
    ]);
    expect(codePaths(failure(doc({ view_keys: [] })))).toEqual([
      ["INVALID_VALUE", "view_keys"],
    ]);
    expect(
      codePaths(failure(doc({ view_keys: ["card_face", "card_face"] }))),
    ).toEqual([["DUPLICATE_ID", "view_keys[1]"]]);
    expect(codePaths(failure(doc({ view_keys: ["secret_key"] })))).toEqual([
      ["INVALID_VALUE", "view_keys[0]"],
    ]);
  });
});
