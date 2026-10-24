import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalize } from "./canonicalize.js";
import { decodeCanonical, MAX_DECODE_ERRORS } from "./decode.js";
import { reviveInput } from "./generate-golden-vectors.testing.js";
import type { GoldenVector } from "./generate-golden-vectors.testing.js";
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

const vectors = JSON.parse(
  readFileSync(new URL("./golden-vectors.json", import.meta.url), "utf8"),
) as GoldenVector[];

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function failure(schema: CanonicalSchema, text: string | Uint8Array) {
  const r = decodeCanonical(
    schema,
    typeof text === "string" ? enc(text) : text,
  );
  if (r.ok) throw new Error(`expected a failure for ${String(text)}`);
  return r.error;
}

function success(schema: CanonicalSchema, text: string): unknown {
  const r = decodeCanonical(schema, enc(text));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe("VC-349 decodeCanonical inverts canonicalize on every P1 golden vector", () => {
  for (const v of vectors) {
    it(`${v.name}`, () => {
      const value = reviveInput(v.schema, v.input);
      const bytes = canonicalize(v.schema, value);
      const decoded = decodeCanonical(v.schema, bytes);
      if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
      expect(decoded.value).toEqual(value);
      expect(canonicalize(v.schema, decoded.value)).toEqual(bytes);
    });
  }

  it("keeps bigint 0, negatives and 10^40 exact", () => {
    const schema = arrayNode(bigintNode);
    const value = [0n, -1n, 10n ** 40n, -(10n ** 40n)];
    const decoded = decodeCanonical(schema, canonicalize(schema, value));
    expect(decoded).toEqual({ ok: true, value });
  });
});

describe("tokenizer", () => {
  const schema = objectNode([
    ["a", intNode],
    ["b", optionalNode(stringNode)],
    ["c", optionalNode(idMapNode(intNode))],
    ["d", optionalNode(jsonNode)],
  ]);

  it("accepts any whitespace and key order", () => {
    expect(success(schema, ' \n\t{ "b" : "x" ,\r"a" : -12 } ')).toEqual({
      a: -12,
      b: "x",
    });
  });

  it("accepts idMap pairs in any order and rebuilds the record", () => {
    expect(success(schema, '{"a":1,"c":[["z",1],["a",2]]}')).toEqual({
      a: 1,
      c: { z: 1, a: 2 },
    });
  });

  it("decodes escapes and astral characters", () => {
    const s = objectNode([["s", stringNode]]);
    expect(success(s, '{"s":"a\\n\\u00e9\\ud83d\\ude00\\/"}')).toEqual({
      s: "a\né\u{1f600}/",
    });
    expect(
      decodeCanonical(
        s,
        new Uint8Array([
          0x7b, 0x22, 0x73, 0x22, 0x3a, 0x22, 0xf0, 0x9f, 0x98, 0x80, 0x22,
          0x7d,
        ]),
      ),
    ).toEqual({
      ok: true,
      value: { s: "\u{1f600}" },
    });
  });

  it("keeps a __proto__ key as own data", () => {
    const value = success(schema, '{"a":1,"d":{"__proto__":{"x":1}}}') as {
      d: object;
    };
    expect(Object.getPrototypeOf(value.d)).toBe(Object.prototype);
    expect(Object.keys(value.d)).toEqual(["__proto__"]);
  });

  it("reports syntax errors with a path", () => {
    const errors = failure(schema, '{"a":1,"d":{"x":[1,2');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("PACKAGE_SYNTAX");
    expect(errors[0]?.path).toBe("$.d.x");
    for (const text of [
      "",
      "   ",
      "{",
      '{"a":01}',
      '{"a":1,}',
      '{"a" 1}',
      "{'a':1}",
      '{"a":1} x',
      '{"a":"\u0001"}',
      '{"a":"\\x"}',
      '{"a":"\\u12"}',
      '{"a":tru}',
      '{"a":-}',
      '{"a":1.}',
      '{"a":1e}',
    ]) {
      expect(failure(schema, text)[0]?.code, text).toBe("PACKAGE_SYNTAX");
    }
  });

  it("rejects invalid UTF-8", () => {
    for (const bytes of [
      [0x22, 0xff, 0x22],
      [0x22, 0xc0, 0x80, 0x22],
      [0x22, 0xed, 0xa0, 0x80, 0x22],
      [0x22, 0xf4, 0x90, 0x80, 0x80, 0x22],
      [0x22, 0xe2, 0x82],
    ]) {
      expect(failure(stringNode, new Uint8Array(bytes))[0]?.code).toBe(
        "PACKAGE_SYNTAX",
      );
    }
  });

  it("rejects absurd nesting without overflowing the stack", () => {
    const deep = "[".repeat(100_000) + "]".repeat(100_000);
    expect(failure(jsonNode, deep)[0]?.code).toBe("PACKAGE_SYNTAX");
  });

  it("detects duplicate keys (object, json node, idMap)", () => {
    expect(failure(schema, '{"a":1,"a":2}')).toEqual([
      expect.objectContaining({ code: "PACKAGE_DUPLICATE_KEY", path: "$.a" }),
    ]);
    expect(failure(schema, '{"a":1,"d":{"k":{"x":1,"x":2}}}')[0]).toMatchObject(
      {
        code: "PACKAGE_DUPLICATE_KEY",
        path: "$.d.k.x",
      },
    );
    expect(failure(schema, '{"a":1,"c":[["k",1],["k",2]]}')[0]).toMatchObject({
      code: "PACKAGE_DUPLICATE_KEY",
      path: '$.c["k"]',
    });
  });

  it("detects unknown and missing keys", () => {
    expect(failure(schema, '{"a":1,"zz":2}')[0]).toMatchObject({
      code: "PACKAGE_UNKNOWN_KEY",
      path: "$.zz",
    });
    expect(failure(schema, "{}")[0]).toMatchObject({
      code: "PACKAGE_SCHEMA",
      path: "$.a",
    });
  });

  it("detects lone surrogates in values and keys", () => {
    expect(failure(schema, '{"a":1,"b":"\\ud800"}')[0]).toMatchObject({
      code: "PACKAGE_SYNTAX",
      path: "$.b",
    });
    expect(failure(schema, '{"a":1,"b":"\\udc00x"}')[0]?.code).toBe(
      "PACKAGE_SYNTAX",
    );
    expect(failure(schema, '{"a":1,"d":{"\\ud800":1}}')[0]?.code).toBe(
      "PACKAGE_SYNTAX",
    );
    expect(success(schema, '{"a":1,"b":"\\ud83d\\ude00"}')).toEqual({
      a: 1,
      b: "\u{1f600}",
    });
  });

  it("rejects floats, exponents, unsafe integers and negative zero", () => {
    for (const num of [
      "1.5",
      "1e2",
      "1.0",
      "9007199254740992",
      "-9007199254740993",
      "-0",
    ]) {
      expect(failure(schema, `{"a":${num}}`)[0], num).toMatchObject({
        code: "PACKAGE_SCHEMA",
        path: "$.a",
      });
    }
    expect(success(schema, '{"a":9007199254740991}')).toEqual({
      a: 9007199254740991,
    });
    expect(success(schema, '{"a":-9007199254740991}')).toEqual({
      a: -9007199254740991,
    });
    expect(failure(schema, '{"a":1,"d":[1.5]}')[0]).toMatchObject({
      code: "PACKAGE_SCHEMA",
      path: "$.d[0]",
    });
  });

  it("requires bigint as a decimal string", () => {
    const s = arrayNode(bigintNode);
    expect(success(s, '["0","-5","1000000000000000000000000000000"]')).toEqual([
      0n,
      -5n,
      10n ** 30n,
    ]);
    for (const bad of [
      "5",
      '"05"',
      '"-0"',
      '"1.5"',
      '"x"',
      '""',
      "null",
      '"+1"',
    ]) {
      expect(failure(s, `[${bad}]`)[0], bad).toMatchObject({
        code: "PACKAGE_SCHEMA",
        path: "$[0]",
      });
    }
  });

  it("type-checks every node kind", () => {
    const s = objectNode([
      ["i", intNode],
      ["s", stringNode],
      ["b", boolNode],
      ["n", nullNode],
      ["a", arrayNode(intNode)],
      ["m", idMapNode(intNode)],
      ["o", objectNode([])],
    ]);
    const good =
      '{"i":1,"s":"x","b":true,"n":null,"a":[1],"m":[["k",1]],"o":{}}';
    expect(success(s, good)).toEqual({
      i: 1,
      s: "x",
      b: true,
      n: null,
      a: [1],
      m: { k: 1 },
      o: {},
    });
    const wrong = '{"i":"1","s":1,"b":1,"n":0,"a":{},"m":{},"o":[]}';
    const errors = failure(s, wrong);
    expect(errors.map((e) => e.path)).toEqual([
      "$.i",
      "$.s",
      "$.b",
      "$.n",
      "$.a",
      "$.m",
      "$.o",
    ]);
    expect(
      failure(s, good.replace('"m":[["k",1]]', '"m":[["k"]]'))[0]?.path,
    ).toBe("$.m[0]");
    expect(
      failure(s, good.replace('"m":[["k",1]]', '"m":[[1,1]]'))[0]?.path,
    ).toBe("$.m[0]");
  });

  it("limits a json node to depth 64 like the encoder", () => {
    const nest = (depth: number): string =>
      "[".repeat(depth) + "1" + "]".repeat(depth);
    expect(decodeCanonical(jsonNode, enc(nest(64))).ok).toBe(true);
    expect(failure(jsonNode, nest(65))[0]?.code).toBe("PACKAGE_SCHEMA");
    expect(() => canonicalize(jsonNode, JSON.parse(nest(65)))).toThrow();
  });

  it(`reports at most ${String(MAX_DECODE_ERRORS)} errors in document order`, () => {
    const s = arrayNode(intNode);
    const text = `[${Array.from({ length: 150 }, () => '"x"').join(",")}]`;
    const errors = failure(s, text);
    expect(errors).toHaveLength(MAX_DECODE_ERRORS);
    expect(errors.map((e) => e.path)).toEqual(
      Array.from({ length: MAX_DECODE_ERRORS }, (_, i) => `$[${String(i)}]`),
    );
  });
});
