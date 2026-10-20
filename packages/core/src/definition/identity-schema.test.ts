import { describe, expect, expectTypeOf, it } from "vitest";
import { canonicalize } from "../replay/canonical/canonicalize.js";
import { definitionIdentitySchema } from "../replay/canonical/definition-schema.js";
import type { CanonicalSchema } from "../replay/canonical/schema.js";
import { definitionData } from "./data.js";
import type { DefinitionData } from "./data.js";
import { buildDefinition, buildFloorDefinition } from "./definition.testing.js";
import type {
  CardDecl,
  CompiledGameDefinition,
  CounterDecl,
  MetaSchemaDecl,
  RoleDecl,
  ZoneDecl,
  ZoneTemplateDecl,
} from "./types.js";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** Field names of the object node reached by `path` (array element nodes are entered implicitly). */
function fieldsAt(schema: CanonicalSchema, path: readonly string[]): string[] {
  let node = schema;
  for (const step of ["", ...path]) {
    while (node.kind === "array" || node.kind === "optional") node = node.of;
    if (node.kind !== "object") throw new Error(`not an object at ${step}`);
    if (step === "") continue;
    const next = node.fields.find(([name]) => name === step);
    if (next === undefined) throw new Error(`no field ${step}`);
    node = next[1];
  }
  while (node.kind === "array" || node.kind === "optional") node = node.of;
  if (node.kind !== "object") throw new Error("not an object");
  return node.fields.map(([name]) => name);
}

// Each record lists every key of the declaration type; `Record<keyof T, true>` makes the
// compiler reject the file when a field is added to the type but not listed here, and the
// tests below fail when a listed key is absent from the identity schema.
const defKeys: Record<keyof DefinitionData, true> = {
  gameId: true,
  roles: true,
  schemaVersion: true,
  cards: true,
  zones: true,
  zoneTemplates: true,
  counters: true,
  conservationGroups: true,
  seats: true,
  teams: true,
  viewKeys: true,
  control: true,
  metaSchemas: true,
  rosterReducerRef: true,
  policies: true,
  hookBindings: true,
};
const cardKeys: Record<keyof CardDecl, true> = {
  id: true,
  type: true,
  metadataSchema: true,
  startingZone: true,
  initialMetadata: true,
  metadataVisibility: true,
};
const zoneKeys: Record<keyof ZoneDecl, true> = {
  id: true,
  ordered: true,
  owner: true,
  visibility: true,
};
const templateKeys: Record<keyof ZoneTemplateDecl, true> = {
  name: true,
  ownerRule: true,
  ordered: true,
  maxInstances: true,
  visibility: true,
};
// `derived` is a function member; its data form is `derivedSpec`.
const counterKeys: Record<Exclude<keyof CounterDecl, "derived">, true> = {
  id: true,
  owner: true,
  ownerId: true,
  visibility: true,
  min: true,
  max: true,
  initial: true,
  scale: true,
  rounding: true,
  supplyRole: true,
  derivedSpec: true,
};
// `reducer` is a function member; its data form is `reducerRef`.
const metaKeys: Record<Exclude<keyof MetaSchemaDecl, "reducer">, true> = {
  id: true,
  fields: true,
  reducerRef: true,
  fieldVisibility: true,
};
const roleKeys: Record<keyof RoleDecl, true> = { id: true, subject: true };

describe("definitionIdentitySchema covers every field (VC-253, DFR-066)", () => {
  const names = (r: Record<string, true>) => Object.keys(r).sort();
  const cases: [string, readonly string[], Record<string, true>][] = [
    ["definition", [], defKeys],
    ["cards", ["cards"], cardKeys],
    ["zones", ["zones"], zoneKeys],
    ["zoneTemplates", ["zoneTemplates"], templateKeys],
    ["counters", ["counters"], counterKeys],
    ["metaSchemas", ["metaSchemas"], metaKeys],
    ["roles", ["roles"], roleKeys],
  ];
  it.each(cases)(
    "%s: schema fields equal the type's data keys",
    (_n, path, keys) => {
      expect(fieldsAt(definitionIdentitySchema, path).sort()).toEqual(
        names(keys),
      );
    },
  );

  it("the CompiledGameDefinition-only members are exactly the function members", () => {
    expectTypeOf<
      Exclude<keyof CompiledGameDefinition, keyof DefinitionData>
    >().toEqualTypeOf<"rosterReducer">();
  });
});

describe("definitionData and the identity schema (VC-253)", () => {
  const def = buildDefinition();
  const data = definitionData(def);

  it("carries the new fields and none of the removed flags", () => {
    expect(data.gameId).toBe("test");
    expect(data.roles).toEqual([]);
    expect(data.rosterReducerRef).toBe("identity");
    expect(data.counters.at(-1)?.derivedSpec).toEqual({
      kind: "zone_size",
      zone: "deck",
    });
    expect(data.metaSchemas[0]).toMatchObject({
      reducerRef: "identity",
      fieldVisibility: {},
    });
    expect(data.cards[0]).toMatchObject({
      initialMetadata: {},
      metadataVisibility: {},
    });
    expect(data.zones[0]).toMatchObject({ visibility: {} });
    expect(data.zoneTemplates[0]).toMatchObject({ visibility: {} });
    expect(data.counters[0]).toMatchObject({ visibility: {} });
    const json = JSON.stringify(data, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(json).not.toContain("hasReducer");
    expect(json).not.toContain("hasRosterReducer");
    expect(data.counters.some((c) => "derived" in c)).toBe(false);
  });

  it("canonicalize(definitionIdentitySchema, data) succeeds and is stable", () => {
    const a = text(canonicalize(definitionIdentitySchema, data));
    expect(a).toContain('"gameId":"test"');
    expect(a).toContain('"reducerRef":"identity"');
    expect(
      text(
        canonicalize(
          definitionIdentitySchema,
          definitionData(buildDefinition()),
        ),
      ),
    ).toBe(a);
    expect(() =>
      canonicalize(
        definitionIdentitySchema,
        definitionData(buildFloorDefinition()),
      ),
    ).not.toThrow();
  });

  it("binding reducer functions does not change the canonical bytes", () => {
    const { rosterReducer, ...rest } = def;
    expect(rosterReducer).toBeDefined();
    const unbound: CompiledGameDefinition = {
      ...rest,
      metaSchemas: def.metaSchemas.map(({ reducer, ...m }) => {
        expect(reducer).toBeDefined();
        return m;
      }),
      counters: def.counters.map(({ derived, ...c }) => {
        void derived;
        return c;
      }),
    };
    expect(
      text(canonicalize(definitionIdentitySchema, definitionData(unbound))),
    ).toBe(text(canonicalize(definitionIdentitySchema, data)));
  });

  it("an omitted rosterReducerRef is omitted from the data", () => {
    const { rosterReducerRef, ...noRef } = def;
    expect(rosterReducerRef).toBeDefined();
    expect("rosterReducerRef" in definitionData(noRef)).toBe(false);
  });
});
