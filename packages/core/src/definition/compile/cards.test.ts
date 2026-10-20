import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  codePaths,
  deckDoc,
  doc,
  failure,
  STOCK,
  success,
  SUIT_RANK_GENERATOR,
} from "./compile.testing.js";

/** The 52-card generator with `over` applied; an `undefined` value drops the key. */
const gen = (over: Record<string, unknown>) => ({
  generate: Object.fromEntries(
    Object.entries({ ...SUIT_RANK_GENERATOR.generate, ...over }).filter(
      ([, v]) => v !== undefined,
    ),
  ),
});
const cardsOf = (cards: unknown[]) => deckDoc({ cards });
const field = (type: string) => ({ type, visibility: "public" });

describe("VC-215 cards: the suit x rank generator", () => {
  const def = success(deckDoc());

  it("expands 52 cards, first axis slowest", () => {
    const ids = def.cards.map((c) => c.id);
    const expected = ["S", "H", "D", "C"].flatMap((s) =>
      Array.from({ length: 13 }, (_, i) => `${s}${i + 1}`),
    );
    expect(ids).toEqual(expected);
  });

  it("keeps the lone placeholder's type and substitutes the rest", () => {
    expect(def.cards[0]).toEqual({
      id: "S1",
      type: "S",
      metadataSchema: { suit: "string", rank: "int" },
      startingZone: "stock",
      initialMetadata: { suit: "S", rank: 1 },
      metadataVisibility: { suit: "public", rank: "public" },
    });
    expect(typeof def.cards[12]?.initialMetadata["rank"]).toBe("number");
  });

  it("swapping the two axis items changes the order (hash half: iteration 5)", () => {
    const [suit, rank] = SUIT_RANK_GENERATOR.generate.axes;
    const swapped = success(deckDoc({ cards: [gen({ axes: [rank, suit] })] }));
    expect(swapped.cards.slice(0, 5).map((c) => c.id)).toEqual([
      "S1",
      "H1",
      "D1",
      "C1",
      "S2",
    ]);
    expect(swapped.cards.map((c) => c.id).sort()).toEqual(
      def.cards.map((c) => c.id).sort(),
    );
  });

  it("is independent of the mapping-key order of the generator", () => {
    const reordered = {
      generate: Object.fromEntries(
        Object.entries(SUIT_RANK_GENERATOR.generate).reverse(),
      ),
    };
    expect(success(deckDoc({ cards: [reordered] })).cards).toEqual(def.cards);
  });

  it("expands three axes with a deck axis of 8 into 416 cards", () => {
    const three = success(
      deckDoc({
        cards: [
          gen({
            axes: [
              { name: "deck", values: { range: [1, 8] } },
              ...SUIT_RANK_GENERATOR.generate.axes,
            ],
            id: "{deck}-{suit}{rank}",
          }),
        ],
      }),
    );
    expect(three.cards).toHaveLength(416);
    expect(three.cards[0]?.id).toBe("1-S1");
    expect(three.cards[52]?.id).toBe("2-S1");
    expect(three.cards[415]?.id).toBe("8-C13");
  });

  it("mixes explicit cards and generators in declaration order", () => {
    const d = success(
      deckDoc({ cards: [{ id: "joker", zone: "stock" }, SUIT_RANK_GENERATOR] }),
    );
    expect(d.cards[0]).toEqual({
      id: "joker",
      metadataSchema: {},
      startingZone: "stock",
      initialMetadata: {},
      metadataVisibility: {},
    });
    expect(d.cards).toHaveLength(53);
  });

  it("gives every card its own initialMetadata object", () => {
    const d = success(
      deckDoc({
        cards: [
          gen({
            metadata: { bag: { a: [1] } },
            metadata_schema: { bag: field("json") },
          }),
        ],
      }),
    );
    expect(d.cards[0]?.initialMetadata["bag"]).toEqual({ a: [1] });
    expect(d.cards[0]?.initialMetadata).not.toBe(d.cards[1]?.initialMetadata);
    expect(d.cards[0]?.initialMetadata["bag"]).not.toBe(
      d.cards[1]?.initialMetadata["bag"],
    );
  });

  it("builds a mixed template into a string", () => {
    const d = success(
      deckDoc({
        cards: [
          gen({
            metadata: { label: "{suit}-{rank}", n: "{rank}" },
            metadata_schema: { label: field("string"), n: field("json") },
          }),
        ],
      }),
    );
    expect(d.cards[0]?.initialMetadata).toEqual({ label: "S-1", n: 1 });
  });

  it("accepts a string axis and an integer list axis", () => {
    const d = success(
      deckDoc({
        cards: [
          {
            generate: {
              axes: [{ name: "n", values: [3, 1, 2] }],
              id: "c{n}",
              zone: "stock",
              metadata: { n: "{n}" },
              metadata_schema: { n: field("int") },
            },
          },
        ],
      }),
    );
    expect(d.cards.map((c) => c.initialMetadata["n"])).toEqual([3, 1, 2]);
  });
});

describe("VC-215 cards: errors", () => {
  const one = (over: Record<string, unknown>) => failure(cardsOf([gen(over)]));
  const g = "cards[0].generate";

  it("rejects an expansion above 10 000 cards", () => {
    const errors = one({
      axes: [
        { name: "a", values: { range: [1, 101] } },
        { name: "b", values: { range: [1, 100] } },
      ],
      id: "{a}-{b}",
      type: undefined,
      metadata: undefined,
      metadata_schema: undefined,
    });
    expect(errors[0]).toMatchObject({ code: "LIMIT_EXCEEDED", path: g });
  });

  it("accepts exactly 10 000 cards and counts across entries", () => {
    const axes = [
      { name: "a", values: { range: [1, 100] } },
      { name: "b", values: { range: [1, 100] } },
    ];
    const big = { generate: { axes, id: "{a}-{b}", zone: "stock" } };
    expect(success(cardsOf([big])).cards).toHaveLength(10000);
    const errors = failure(cardsOf([big, { id: "extra", zone: "stock" }]));
    expect(codePaths(errors)).toEqual([["LIMIT_EXCEEDED", "cards[1]"]]);
  });

  it("does not materialise a huge range", () => {
    const errors = one({
      axes: [{ name: "a", values: { range: [1, 9007199254740991] } }],
      id: "{a}",
      type: undefined,
      metadata: undefined,
      metadata_schema: undefined,
    });
    expect(errors[0]?.code).toBe("LIMIT_EXCEEDED");
  });

  it("rejects placeholder faults naming the card and the producing path", () => {
    expect(one({ id: "{ghost}" })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: `${g}.id`,
      entity: "{ghost}",
    });
    expect(one({ id: "{suit" })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: `${g}.id`,
    });
    expect(one({ zone: "st}ock" })[0]?.path).toBe(`${g}.zone`);
    expect(one({ type: "{nope}" })[0]?.path).toBe(`${g}.type`);
    expect(one({ metadata: { suit: "{nope}" } }).map((e) => e.path)).toContain(
      `${g}.metadata.suit`,
    );
  });

  it("rejects a zone that is unknown or names a template", () => {
    const withTemplate = deckDoc({
      zones: [
        STOCK,
        {
          template: "hand",
          owner: "seat",
          ordering: "ordered",
          max_instances: 1,
        },
      ],
      cards: [gen({ zone: "hand" })],
    });
    expect(failure(withTemplate)[0]).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: `${g}.zone`,
      entity: "S1",
    });
    expect(one({ zone: "ghost" })[0]?.code).toBe("UNKNOWN_REFERENCE");
    expect(failure(cardsOf([{ id: "x", zone: "ghost" }]))[0]).toMatchObject({
      code: "UNKNOWN_REFERENCE",
      path: "cards[0].zone",
      entity: "x",
    });
  });

  it("rejects metadata faults", () => {
    expect(one({ metadata: { suit: "{suit}", extra: "x" } })[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: `${g}.metadata.extra`,
    });
    const mismatch = failure(
      cardsOf([
        {
          id: "c",
          zone: "stock",
          metadata: { rank: "x" },
          metadata_schema: { rank: field("int") },
        },
      ]),
    );
    expect(mismatch[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "cards[0].metadata.rank",
      entity: "c",
    });
    // a lone placeholder over a string axis cannot satisfy an int field
    expect(
      one({
        metadata: { suit: "{suit}" },
        metadata_schema: { suit: field("int") },
      })[0],
    ).toMatchObject({ code: "SCHEMA_TYPE", path: `${g}.metadata.suit` });
    // a mixed template yields a string
    expect(
      one({
        metadata: { suit: "{suit}!" },
        metadata_schema: { suit: field("int") },
      })[0]?.code,
    ).toBe("SCHEMA_TYPE");
  });

  it("rejects a duplicate expanded card id once, naming it", () => {
    const errors = one({
      id: "{suit}",
      type: undefined,
      metadata: undefined,
      metadata_schema: undefined,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "DUPLICATE_ID",
      path: `${g}.id`,
      entity: "S",
    });
    expect(
      failure(
        cardsOf([
          { id: "a", zone: "stock" },
          { id: "a", zone: "stock" },
        ]),
      )[0],
    ).toMatchObject({ code: "DUPLICATE_ID", path: "cards[1].id", entity: "a" });
  });

  it("rejects axis faults", () => {
    const ax = (axes: unknown) =>
      one({
        axes,
        id: "x",
        type: undefined,
        metadata: undefined,
        metadata_schema: undefined,
      });
    expect(ax([])[0]?.code).toBe("INVALID_VALUE");
    expect(ax({ suit: ["S"] })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: `${g}.axes`,
    });
    expect(ax([{ name: "Suit", values: ["S"] }])[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: `${g}.axes[0].name`,
    });
    expect(
      ax([
        { name: "a", values: ["S"] },
        { name: "a", values: ["H"] },
      ])[0],
    ).toMatchObject({ code: "DUPLICATE_ID", path: `${g}.axes[1].name` });
    expect(ax([{ name: "a", values: [] }])[0]?.code).toBe("INVALID_VALUE");
    expect(ax([{ name: "a", values: { range: [5, 1] } }])[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: `${g}.axes[0].values.range`,
    });
    expect(ax([{ name: "a", values: { range: [1] } }])[0]?.code).toBe(
      "INVALID_VALUE",
    );
    expect(ax([{ name: "a", values: { range: [1.5, 3] } }])[0]?.code).toBe(
      "SCHEMA_TYPE",
    );
    expect(ax([{ name: "a", values: [1.5] }])[0]?.code).toBe("SCHEMA_TYPE");
    expect(ax([{ name: "a", values: [true] }])[0]?.code).toBe("SCHEMA_TYPE");
    expect(
      ax([{ name: "a", values: [Number("9007199254740993")] }])[0]?.code,
    ).toBe("INVALID_VALUE");
    expect(ax([{ name: "a" }])[0]).toMatchObject({
      code: "SCHEMA_MISSING",
      path: `${g}.axes[0].values`,
    });
    expect(ax([{ name: "a", values: ["S"], extra: 1 }])[0]?.code).toBe(
      "SCHEMA_UNKNOWN_KEY",
    );
  });

  it("rejects structural faults of an entry", () => {
    expect(failure(cardsOf(["x"]))[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "cards[0]",
    });
    expect(failure(cardsOf([{ zone: "stock" }]))[0]).toMatchObject({
      code: "SCHEMA_MISSING",
      path: "cards[0].id",
    });
    expect(
      failure(
        cardsOf([{ generate: SUIT_RANK_GENERATOR.generate, id: "x" }]),
      )[0],
    ).toMatchObject({ code: "SCHEMA_UNKNOWN_KEY", path: "cards[0].id" });
    expect(one({ axes: undefined })[0]).toMatchObject({
      code: "SCHEMA_MISSING",
      path: `${g}.axes`,
    });
    expect(one({ extra: 1 })[0]).toMatchObject({
      code: "SCHEMA_UNKNOWN_KEY",
      path: `${g}.extra`,
    });
  });

  it("treats braces in an explicit card as literal characters (the id charset rejects them)", () => {
    expect(failure(cardsOf([{ id: "a{b}", zone: "stock" }]))[0]?.code).toBe(
      "INVALID_VALUE",
    );
  });
});

describe("VC-220 (card part) metadata_schema fields", () => {
  const card = (schema: unknown) =>
    failure(cardsOf([{ id: "c", zone: "stock", metadata_schema: schema }]));

  it("requires a visibility of public, subject or secret", () => {
    expect(card({ rank: { type: "int" } })[0]).toMatchObject({
      code: "INVALID_VISIBILITY",
      path: "cards[0].metadata_schema.rank.visibility",
      entity: "c",
    });
    expect(
      card({ rank: { type: "int", visibility: "private" } })[0]?.code,
    ).toBe("INVALID_VISIBILITY");
    expect(
      card({ rank: { type: "float", visibility: "public" } })[0]?.code,
    ).toBe("INVALID_VALUE");
    expect(card({ rank: { visibility: "public" } })[0]?.code).toBe(
      "SCHEMA_MISSING",
    );
  });

  it("compiles the visibility of each declared field", () => {
    const d = success(
      cardsOf([
        {
          id: "c",
          zone: "stock",
          metadata_schema: {
            a: { type: "bool", visibility: "secret" },
            b: { type: "json", visibility: "subject" },
          },
        },
      ]),
    );
    expect(d.cards[0]?.metadataVisibility).toEqual({
      a: "secret",
      b: "subject",
    });
    expect(d.cards[0]?.metadataSchema).toEqual({ a: "bool", b: "json" });
  });
});

describe("VC-228 (card part) json metadata", () => {
  const jsonCard = (value: unknown) =>
    failure(
      cardsOf([
        {
          id: "c",
          zone: "stock",
          metadata: { blob: value },
          metadata_schema: { blob: field("json") },
        },
      ]),
    );

  it("rejects a float anywhere inside a json value with SCHEMA_TYPE", () => {
    expect(jsonCard({ a: [1, { b: 1.5 }] })[0]).toMatchObject({
      code: "SCHEMA_TYPE",
      path: "cards[0].metadata.blob.a[1].b",
    });
    expect(jsonCard(1.5)[0]?.code).toBe("SCHEMA_TYPE");
  });

  it("rejects depth 65, a lone surrogate and an unsafe integer with INVALID_VALUE", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 65; i += 1) deep = [deep];
    expect(jsonCard(deep)[0]?.code).toBe("INVALID_VALUE");
    expect(jsonCard("\ud800")[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "cards[0].metadata.blob",
    });
    expect(jsonCard({ big: Number("9007199254740993") })[0]?.code).toBe(
      "INVALID_VALUE",
    );
  });

  it("accepts depth 64 and nested null/bool/string/int", () => {
    let ok: unknown = 1;
    for (let i = 0; i < 63; i += 1) ok = [ok];
    const d = success(
      cardsOf([
        {
          id: "c",
          zone: "stock",
          metadata: { blob: { n: null, b: true, s: "x", i: -3, deep: ok } },
          metadata_schema: { blob: field("json") },
        },
      ]),
    );
    expect(d.cards[0]?.initialMetadata["blob"]).toMatchObject({
      n: null,
      i: -3,
    });
  });
});

describe("VC-229 card ids", () => {
  it("rejects a generated id with a space, naming it and the producing path", () => {
    const errors = failure(
      cardsOf([
        {
          generate: {
            axes: [{ name: "n", values: [1, 2] }],
            id: "card {n}",
            zone: "stock",
          },
        },
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "cards[0].generate.id",
      entity: "card 1",
    });
  });

  it("rejects an expanded 129-character id and accepts 128 with every allowed character", () => {
    const longId = (n: number) => ({
      generate: {
        axes: [{ name: "n", values: ["x"] }],
        id: `${"a".repeat(n - 1)}{n}`,
        zone: "stock",
      },
    });
    expect(failure(cardsOf([longId(129)]))[0]).toMatchObject({
      code: "INVALID_VALUE",
      path: "cards[0].generate.id",
    });
    expect(success(cardsOf([longId(128)])).cards[0]?.id).toHaveLength(128);
    const allChars = "AZaz09_.:/-";
    expect(
      success(cardsOf([{ id: allChars, zone: "stock" }])).cards[0]?.id,
    ).toBe(allChars);
  });
});

describe("VC-226 (cards) the compiled value is usable", () => {
  it("places every card in its starting zone in expanded order", async () => {
    const { createSession } = await import("../../session/create.js");
    const { assertDefinitionStructure } = await import("../assert.js");
    const { sessionId } = await import("../../session/ids.js");
    const def = success(deckDoc());
    expect(assertDefinitionStructure(def).ok).toBe(true);
    const sid = sessionId("s1");
    if (!sid.ok) throw new Error("id");
    const r = createSession(
      def,
      sid.value,
      def.seats.map((s) => ({ seat: s.id })),
    );
    if (!r.ok) throw new Error(r.error.detail);
    expect(r.value.zones["stock" as never]?.members).toEqual(
      def.cards.map((c) => c.id),
    );
  });
});

describe("VC-227 property: card count is the product of the axis lengths", () => {
  const axisArb = fc.oneof(
    fc.integer({ min: 1, max: 6 }).map((n) => ({
      values: Array.from({ length: n }, (_, i) => `v${i}`),
      length: n,
    })),
    fc
      .tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 5 }))
      .map(([lo, span]) => ({
        values: { range: [lo, lo + span] },
        length: span + 1,
      })),
  );
  const definitionArb = fc.record({
    seats: fc.integer({ min: 1, max: 8 }),
    extraZones: fc.integer({ min: 0, max: 4 }),
    counters: fc.integer({ min: 0, max: 5 }),
    axes: fc.array(axisArb, { minLength: 1, maxLength: 4 }),
  });

  it("compiles a random valid definition with the expected card count", () => {
    fc.assert(
      fc.property(definitionArb, (d) => {
        const raw = doc({
          seats: { count: d.seats },
          zones: [
            STOCK,
            ...Array.from({ length: d.extraZones }, (_, i) => ({
              id: `z${i}`,
              ordering: "unordered",
            })),
          ],
          counters: Array.from({ length: d.counters }, (_, i) => ({
            id: `k${i}`,
            owner: "table",
            min: 0,
            initial: 0,
          })),
          cards: [
            {
              generate: {
                axes: d.axes.map((a, i) => ({
                  name: `a${i}`,
                  values: a.values,
                })),
                id: d.axes.map((_, i) => `{a${i}}`).join("-"),
                zone: "stock",
              },
            },
          ],
        });
        const r = compileDefinition(raw);
        const expected = d.axes.reduce((n, a) => n * a.length, 1);
        return r.ok && r.value.cards.length === expected;
      }),
      { numRuns: 600 },
    );
  });
});

import { compileDefinition } from "./compile.js";
