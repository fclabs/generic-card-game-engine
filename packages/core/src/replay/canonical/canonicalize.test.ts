import { describe, it, expect } from "vitest";
import { canonicalize, CanonicalError } from "./canonicalize.js";
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

const text = (schema: CanonicalSchema, v: unknown): string =>
  new TextDecoder().decode(canonicalize(schema, v));

function pathOf(schema: CanonicalSchema, v: unknown): string {
  try {
    canonicalize(schema, v);
  } catch (e) {
    expect(e).toBeInstanceOf(CanonicalError);
    return (e as CanonicalError).path;
  }
  throw new Error("expected CanonicalError");
}

describe("CanonicalError", () => {
  it("carries path, name and a message naming the path", () => {
    const e = new CanonicalError("$.a", "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CanonicalError");
    expect(e.path).toBe("$.a");
    expect(e.message).toContain("$.a");
  });
});

describe("VC-061 invalid inputs raise CanonicalError with a path", () => {
  const rec = objectNode([["x", intNode]]);
  const cases: [string, CanonicalSchema, unknown, string][] = [
    ["1.5", rec, { x: 1.5 }, "$.x"],
    ["NaN", rec, { x: NaN }, "$.x"],
    ["Infinity", rec, { x: Infinity }, "$.x"],
    ["-Infinity", rec, { x: -Infinity }, "$.x"],
    ["-0", rec, { x: -0 }, "$.x"],
    ["2^53", rec, { x: 2 ** 53 }, "$.x"],
    ["-(2^53)", rec, { x: -(2 ** 53) }, "$.x"],
    ["undefined (required)", rec, { x: undefined }, "$.x"],
    [
      "undefined (optional, explicit key)",
      objectNode([["x", optionalNode(intNode)]]),
      { x: undefined },
      "$.x",
    ],
    ["undefined (root)", intNode, undefined, "$"],
    ["function", rec, { x: () => 1 }, "$.x"],
    ["symbol", rec, { x: Symbol("s") }, "$.x"],
    ["bigint where int declared", rec, { x: 1n }, "$.x"],
    [
      "number where bigint declared",
      objectNode([["b", bigintNode]]),
      { b: 1 },
      "$.b",
    ],
    ["Map", objectNode([["m", jsonNode]]), { m: new Map() }, "$.m"],
    [
      "Map for object node",
      objectNode([["m", objectNode([])]]),
      { m: new Map() },
      "$.m",
    ],
    ["Set", objectNode([["m", jsonNode]]), { m: new Set() }, "$.m"],
    ["Date", objectNode([["m", jsonNode]]), { m: new Date(0) }, "$.m"],
    [
      "Date for string node",
      objectNode([["m", stringNode]]),
      { m: new Date(0) },
      "$.m",
    ],
    [
      "lone surrogate string",
      objectNode([["s", stringNode]]),
      { s: "a\ud800" },
      "$.s",
    ],
    [
      "lone low surrogate in idMap key",
      idMapNode(intNode),
      { "\udc00": 1 },
      '$["\\udc00"]',
    ],
    ["lone surrogate in json", jsonNode, { k: ["\udfff"] }, "$.k[0]"],
    ["undeclared field", rec, { x: 1, extra: 2 }, "$.extra"],
    [
      "undeclared field (meta payload)",
      objectNode([["meta", objectNode([["a", intNode]])]]),
      { meta: { a: 1, b: 2 } },
      "$.meta.b",
    ],
    ["missing required field", rec, {}, "$.x"],
    ["bigint inside json", jsonNode, { a: [1, 2n] }, "$.a[1]"],
    ["float inside json", jsonNode, { a: 0.5 }, "$.a"],
    ["undefined inside json", jsonNode, { a: undefined }, "$.a"],
    ["function inside json", jsonNode, [() => 1], "$[0]"],
    ["class instance in json", jsonNode, new (class Foo {})(), "$"],
    [
      "wrong type: string for bool",
      objectNode([["b", boolNode]]),
      { b: "true" },
      "$.b",
    ],
    ["wrong type: 1 for null", objectNode([["n", nullNode]]), { n: 1 }, "$.n"],
    ["null where not declared", rec, { x: null }, "$.x"],
    ["array expected", arrayNode(intNode), { 0: 1 }, "$"],
    ["array element path", arrayNode(intNode), [1, 2.5], "$[1]"],
    ["sparse array", arrayNode(intNode), [1, , 3], "$[1]"], // eslint-disable-line no-sparse-arrays
    ["array for idMap", idMapNode(intNode), [1], "$"],
    ["idMap value path", idMapNode(intNode), { k: 1.5 }, '$["k"]'],
    ["symbol key", objectNode([]), { [Symbol("k")]: 1 }, "$"],
  ];
  for (const [name, schema, value, path] of cases) {
    it(`${name} -> ${path}`, () => {
      expect(pathOf(schema, value)).toBe(path);
    });
  }

  it("cyclic structure in a json node", () => {
    const a: Record<string, unknown> = { n: 1 };
    a["self"] = a;
    expect(pathOf(jsonNode, a)).toBe("$.self");
    const arr: unknown[] = [];
    arr.push(arr);
    expect(pathOf(jsonNode, arr)).toBe("$[0]");
  });

  it("a shared (non-cyclic) reference is not a cycle", () => {
    const shared = { z: 1 };
    expect(text(jsonNode, { a: shared, b: shared })).toBe(
      '{"a":{"z":1},"b":{"z":1}}',
    );
  });

  it("json deeper than 64 levels", () => {
    let v: unknown = 1;
    for (let i = 0; i < 65; i++) v = [v];
    expect(pathOf(jsonNode, v)).toBe("$" + "[0]".repeat(64));
    let ok: unknown = 1;
    for (let i = 0; i < 64; i++) ok = [ok];
    expect(() => canonicalize(jsonNode, ok)).not.toThrow();
  });

  it("very deep json does not overflow the stack", () => {
    let v: unknown = 1;
    for (let i = 0; i < 100_000; i++) v = [v];
    expect(() => canonicalize(jsonNode, v)).toThrow(CanonicalError);
  });
});

describe("rules", () => {
  it("rule 1: no whitespace, BOM or trailing newline", () => {
    const b = canonicalize(objectNode([["a", arrayNode(intNode)]]), {
      a: [1, 2],
    });
    expect(b[0]).toBe(0x7b);
    expect(new TextDecoder().decode(b)).toBe('{"a":[1,2]}');
  });

  it("rule 3: absent optional is omitted; present optional is emitted", () => {
    const s = objectNode([["a", optionalNode(stringNode)]]);
    expect(text(s, {})).toBe("{}");
    expect(text(s, { a: "x" })).toBe('{"a":"x"}');
  });

  it("rule 4: bigint decimal string", () => {
    expect(text(bigintNode, 10n ** 30n)).toBe(
      '"1000000000000000000000000000000"',
    );
  });

  it("rule 5: negative and large safe ints", () => {
    expect(text(arrayNode(intNode), [-7, 0, Number.MAX_SAFE_INTEGER])).toBe(
      "[-7,0,9007199254740991]",
    );
  });

  it("rule 6: all control characters below U+0020 use the documented escapes", () => {
    let all = "";
    for (let c = 0; c < 0x20; c++) all += String.fromCharCode(c);
    const out = text(stringNode, all);
    expect(out).toBe(
      '"' +
        "\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f" +
        "\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f" +
        '"',
    );
  });

  it("rule 6: valid surrogate pairs pass", () => {
    expect(text(stringNode, "\u{10ffff}")).toBe('"\u{10ffff}"');
  });

  it("accepts null-prototype objects", () => {
    const o = Object.assign(Object.create(null) as Record<string, unknown>, {
      a: 1,
    });
    expect(text(objectNode([["a", intNode]]), o)).toBe('{"a":1}');
    expect(text(jsonNode, o)).toBe('{"a":1}');
  });

  it("top-level optional with a present value", () => {
    expect(text(optionalNode(intNode), 3)).toBe("3");
  });
});

describe("VC-062 (map-order half) idMap insertion order is irrelevant", () => {
  const schema = idMapNode(objectNode([["n", bigintNode]]));
  it("same logical map, different insertion orders -> identical bytes", () => {
    const keys = ["z", "a", "M", "b", "\u{1f600}", "￿", "10", "9"];
    const forward: Record<string, unknown> = {};
    const backward: Record<string, unknown> = {};
    keys.forEach((k, i) => (forward[k] = { n: BigInt(i) }));
    [...keys]
      .reverse()
      .forEach((k) => (backward[k] = { n: BigInt(keys.indexOf(k)) }));
    expect(Object.keys(forward)).not.toEqual(Object.keys(backward));
    expect([...canonicalize(schema, forward)]).toEqual([
      ...canonicalize(schema, backward),
    ]);
  });
  it("json node key order is irrelevant too", () => {
    expect(text(jsonNode, { b: 1, a: 2 })).toBe(text(jsonNode, { a: 2, b: 1 }));
  });
  it("__proto__ as an own key is an ordinary id", () => {
    const m = JSON.parse('{"__proto__":1,"a":2}') as unknown;
    expect(text(idMapNode(intNode), m)).toBe('[["__proto__",1],["a",2]]');
  });
});
