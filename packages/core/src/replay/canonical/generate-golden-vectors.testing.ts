/**
 * Source of truth for `golden-vectors.json` (test-only; pure, no I/O).
 *
 * Every vector hand-writes its `expectedText`; `buildGoldenVectors` throws if `canonicalize`
 * disagrees, so the committed file is not merely a snapshot of the implementation.
 * Regenerate: `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/canonical/golden-vectors.test.ts`.
 * Inputs are stored JSON-encoded: at `bigint` schema positions the value is its decimal string.
 */
import { canonicalize } from "./canonicalize.js";
import {
  arrayNode,
  bigintNode,
  boolNode,
  idMapNode,
  intNode,
  jsonNode,
  nullNode,
  objectNode,
  optionalNode,
  stringNode,
} from "./schema.js";
import type { CanonicalSchema } from "./schema.js";
import { sha256Hex } from "./sha256.js";

export interface GoldenSource {
  readonly name: string;
  readonly description: string;
  readonly schema: CanonicalSchema;
  readonly input: unknown;
  readonly expectedText: string;
}

export interface GoldenVector {
  readonly name: string;
  readonly description: string;
  readonly schema: CanonicalSchema;
  /** JSON-encoded input; `bigint` positions hold decimal strings (see `reviveInput`). */
  readonly input: unknown;
  readonly expectedText: string;
  readonly expectedHex: string;
  readonly expectedDigest: string;
}

function nested(depth: number): unknown {
  let v: unknown = 1;
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

export const GOLDEN_SOURCES: readonly GoldenSource[] = [
  {
    name: "empty-object",
    description: "object with no fields",
    schema: objectNode([]),
    input: {},
    expectedText: "{}",
  },
  {
    name: "empty-array",
    description: "empty array of ints",
    schema: arrayNode(intNode),
    input: [],
    expectedText: "[]",
  },
  {
    name: "empty-idmap",
    description: "empty idMap emits an empty array of pairs",
    schema: idMapNode(intNode),
    input: {},
    expectedText: "[]",
  },
  {
    name: "nested-arrays",
    description: "array of arrays keeps order and empties",
    schema: arrayNode(arrayNode(intNode)),
    input: [[1, 2], [], [3]],
    expectedText: "[[1,2],[],[3]]",
  },
  {
    name: "bigint-zero",
    description: 'bigint 0n is the string "0"',
    schema: bigintNode,
    input: 0n,
    expectedText: '"0"',
  },
  {
    name: "bigint-minus-one",
    description: "bigint -1n",
    schema: bigintNode,
    input: -1n,
    expectedText: '"-1"',
  },
  {
    name: "bigint-2-pow-200",
    description: "bigint 2n ** 200n",
    schema: bigintNode,
    input: 2n ** 200n,
    expectedText:
      '"1606938044258990275541962092341162602522202993782792835301376"',
  },
  {
    name: "bigint-negative-2-pow-64",
    description: "bigint -(2n ** 64n)",
    schema: bigintNode,
    input: -(2n ** 64n),
    expectedText: '"-18446744073709551616"',
  },
  {
    name: "int-zero",
    description: "int 0",
    schema: intNode,
    input: 0,
    expectedText: "0",
  },
  {
    name: "int-max-safe",
    description: "int Number.MAX_SAFE_INTEGER",
    schema: intNode,
    input: 9007199254740991,
    expectedText: "9007199254740991",
  },
  {
    name: "int-min-safe",
    description: "int Number.MIN_SAFE_INTEGER",
    schema: intNode,
    input: -9007199254740991,
    expectedText: "-9007199254740991",
  },
  {
    name: "string-empty",
    description: "empty string",
    schema: stringNode,
    input: "",
    expectedText: '""',
  },
  {
    name: "string-quote-backslash",
    description: 'string a"b\\c: quote and backslash are escaped',
    schema: stringNode,
    input: 'a"b\\c',
    expectedText: '"a\\"b\\\\c"',
  },
  {
    name: "string-control-chars",
    description: "U+0000, U+0001, \\b \\t \\n, U+000B, \\f \\r, U+001F",
    schema: stringNode,
    input: "\u0000\u0001\b\t\n\u000b\f\r\u001f",
    expectedText: '"\\u0000\\u0001\\b\\t\\n\\u000b\\f\\r\\u001f"',
  },
  {
    name: "string-del-raw",
    description: "U+007F is emitted raw",
    schema: stringNode,
    input: "\u007f",
    expectedText: '"\u007f"',
  },
  {
    name: "string-line-separators-raw",
    description: "U+2028 and U+2029 are emitted raw",
    schema: stringNode,
    input: "  ",
    expectedText: '"  "',
  },
  {
    name: "string-astral",
    description: "U+1F600 (surrogate pair) is emitted as 4 raw UTF-8 bytes",
    schema: stringNode,
    input: "\u{1f600}",
    expectedText: '"\u{1f600}"',
  },
  {
    name: "string-non-ascii",
    description:
      "Latin-1, BMP CJK, no normalisation (e + combining acute stays decomposed)",
    schema: stringNode,
    input: "é日本 é",
    expectedText: '"é日本 é"',
  },
  {
    name: "string-slash-raw",
    description: "forward slash is not escaped",
    schema: stringNode,
    input: "a/b",
    expectedText: '"a/b"',
  },
  {
    name: "bool-array",
    description: "booleans",
    schema: arrayNode(boolNode),
    input: [true, false],
    expectedText: "[true,false]",
  },
  {
    name: "null-declared",
    description: "null where the schema declares it",
    schema: objectNode([["outcome", nullNode]]),
    input: { outcome: null },
    expectedText: '{"outcome":null}',
  },
  {
    name: "schema-order-not-lexicographic",
    description:
      "keys follow schema order (z before a), not input order or sort order",
    schema: objectNode([
      ["z", intNode],
      ["a", intNode],
    ]),
    input: { a: 1, z: 2 },
    expectedText: '{"z":2,"a":1}',
  },
  {
    name: "optional-absent",
    description: "absent optional field is omitted",
    schema: objectNode([
      ["a", intNode],
      ["b", optionalNode(intNode)],
    ]),
    input: { a: 1 },
    expectedText: '{"a":1}',
  },
  {
    name: "optional-present",
    description: "present optional field is emitted in schema position",
    schema: objectNode([
      ["a", intNode],
      ["b", optionalNode(intNode)],
      ["c", boolNode],
    ]),
    input: { c: true, b: 2, a: 1 },
    expectedText: '{"a":1,"b":2,"c":true}',
  },
  {
    name: "idmap-case-order",
    description:
      "idMap keys differing by case: uppercase sorts before lowercase",
    schema: idMapNode(intNode),
    input: { b: 4, A: 1, a: 3, B: 2 },
    expectedText: '[["A",1],["B",2],["a",3],["b",4]]',
  },
  {
    name: "idmap-code-unit-order",
    description:
      "U+FFFF vs U+1F600: UTF-16 code-unit order puts the astral key (D83D..) first; code-point order would not",
    schema: idMapNode(intNode),
    input: { "￿": 1, "\u{1f600}": 2 },
    expectedText: '[["\u{1f600}",2],["￿",1]]',
  },
  {
    name: "idmap-numeric-like-keys",
    description: "keys sort as strings: 10 < 2 < a",
    schema: idMapNode(intNode),
    input: { a: 3, "2": 2, "10": 1 },
    expectedText: '[["10",1],["2",2],["a",3]]',
  },
  {
    name: "idmap-key-escaping",
    description: "keys use string escaping",
    schema: idMapNode(boolNode),
    input: { 'a"b': true, "a\\b": false },
    expectedText: '[["a\\"b",true],["a\\\\b",false]]',
  },
  {
    name: "idmap-of-objects",
    description: "idMap of objects with bigint and array fields",
    schema: idMapNode(
      objectNode([
        ["n", bigintNode],
        ["tags", arrayNode(stringNode)],
      ]),
    ),
    input: { c2: { tags: [], n: -5n }, c1: { tags: ["x", "y"], n: 7n } },
    expectedText:
      '[["c1",{"n":"7","tags":["x","y"]}],["c2",{"n":"-5","tags":[]}]]',
  },
  {
    name: "idmap-of-idmap",
    description: "nested idMaps",
    schema: idMapNode(idMapNode(intNode)),
    input: { z: { b: 1, a: 2 }, y: {} },
    expectedText: '[["y",[]],["z",[["a",2],["b",1]]]]',
  },
  {
    name: "json-unsorted-keys",
    description: "json node sorts object keys at every level",
    schema: jsonNode,
    input: { b: 1, a: { d: true, c: null }, arr: [{ z: 1, y: 2 }] },
    expectedText: '{"a":{"c":null,"d":true},"arr":[{"y":2,"z":1}],"b":1}',
  },
  {
    name: "json-key-escaping-and-negatives",
    description:
      "json node: escaped keys, negative ints, strings with control chars",
    schema: jsonNode,
    input: { "k\n": -3, "a\u0001": 't\tq"' },
    expectedText: '{"a\\u0001":"t\\tq\\"","k\\n":-3}',
  },
  {
    name: "json-primitives-array",
    description:
      "json node arrays keep order and hold every admitted primitive",
    schema: jsonNode,
    input: [5, "x", null, false, [], {}],
    expectedText: '[5,"x",null,false,[],{}]',
  },
  {
    name: "json-depth-64",
    description: "json node nested exactly 64 containers deep is admitted",
    schema: jsonNode,
    input: nested(64),
    expectedText: "[".repeat(64) + "1" + "]".repeat(64),
  },
  {
    name: "mini-state",
    description:
      "state-like object: strings, ints, idMaps, bigint counters, json meta, optional outcome",
    schema: objectNode([
      ["lifecycle", stringNode],
      ["seq", intNode],
      ["zones", idMapNode(arrayNode(stringNode))],
      ["counters", idMapNode(bigintNode)],
      ["meta", jsonNode],
      ["outcome", optionalNode(jsonNode)],
    ]),
    input: {
      meta: { round: 1, flags: { b: true, a: false } },
      counters: { chips: 1000n, debt: -20n },
      zones: { hand: ["c2", "c1"], deck: [] },
      seq: 12,
      lifecycle: "active",
    },
    expectedText:
      '{"lifecycle":"active","seq":12,"zones":[["deck",[]],["hand",["c2","c1"]]],"counters":[["chips","1000"],["debt","-20"]],"meta":{"flags":{"a":false,"b":true},"round":1}}',
  },
];

/** Schema-directed encoding of an input to JSON-safe data (`bigint` -> decimal string). */
export function encodeInput(schema: CanonicalSchema, value: unknown): unknown {
  switch (schema.kind) {
    case "bigint":
      return (value as bigint).toString(10);
    case "optional":
      return encodeInput(schema.of, value);
    case "array":
      return (value as unknown[]).map((v) => encodeInput(schema.of, v));
    case "idMap": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = encodeInput(schema.of, v);
      }
      return out;
    }
    case "object": {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [name, node] of schema.fields) {
        if (name in src) out[name] = encodeInput(node, src[name]);
      }
      return out;
    }
    default:
      return value;
  }
}

/** Inverse of {@link encodeInput}. */
export function reviveInput(schema: CanonicalSchema, data: unknown): unknown {
  switch (schema.kind) {
    case "bigint":
      return BigInt(data as string);
    case "optional":
      return reviveInput(schema.of, data);
    case "array":
      return (data as unknown[]).map((v) => reviveInput(schema.of, v));
    case "idMap": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        out[k] = reviveInput(schema.of, v);
      }
      return out;
    }
    case "object": {
      const src = data as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [name, node] of schema.fields) {
        if (name in src) out[name] = reviveInput(node, src[name]);
      }
      return out;
    }
    default:
      return data;
  }
}

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += (HEX[b >> 4] ?? "") + (HEX[b & 15] ?? "");
  return s;
}

/** Build the committed file content; throws if the implementation disagrees with a hand-written text. */
export function buildGoldenVectors(): GoldenVector[] {
  return GOLDEN_SOURCES.map((s) => {
    const bytes = canonicalize(s.schema, s.input);
    const hex = toHex(bytes);
    const expectedHex = toHex(hexOfText(s.expectedText));
    if (hex !== expectedHex) {
      throw new Error(
        `golden vector ${s.name}: canonicalize disagrees with expectedText`,
      );
    }
    return {
      name: s.name,
      description: s.description,
      schema: s.schema,
      input: encodeInput(s.schema, s.input),
      expectedText: s.expectedText,
      expectedHex: hex,
      expectedDigest: sha256Hex(bytes),
    };
  });
}

/** Independent UTF-8 encoding of the hand-written text (code points, not the library encoder). */
function hexOfText(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return new Uint8Array(out);
}
