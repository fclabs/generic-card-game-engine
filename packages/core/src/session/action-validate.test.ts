import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_DEPTH, validateAction } from "./action-validate.js";
import { MACRO_KINDS, PRIMITIVE_KINDS } from "./actions.js";
import { SAMPLES } from "./actions.testing.js";

function bad(raw: unknown) {
  const r = validateAction(raw);
  if (r.ok)
    throw new Error(
      `expected a failure for ${JSON.stringify(raw, (_k, v: unknown) => (typeof v === "bigint" ? "big" : v))}`,
    );
  return r.error;
}

describe("validateAction table", () => {
  it("accepts a valid sample of every kind and returns an equal fresh copy", () => {
    const kinds = new Set<string>();
    for (const sample of SAMPLES) {
      const r = validateAction(sample);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual(sample);
        expect(r.value).not.toBe(sample);
        kinds.add(r.value.kind);
      }
    }
    expect([...kinds].sort()).toEqual(
      [...PRIMITIVE_KINDS, ...MACRO_KINDS].sort(),
    );
  });

  it("does not share nested payloads with the input", () => {
    const payload = { a: [1] };
    const r = validateAction({ kind: "meta", schema_id: "n", payload });
    expect(r.ok && r.value.kind === "meta" && r.value.payload).toEqual(payload);
    expect(r.ok && r.value.kind === "meta" && r.value.payload !== payload).toBe(
      true,
    );
  });

  it("every required field missing -> MALFORMED_ACTION with its path", () => {
    for (const sample of SAMPLES) {
      for (const field of Object.keys(sample)) {
        if (field === "kind" || field === "op") continue;
        const copy = { ...sample };
        delete copy[field];
        const r = validateAction(copy);
        // optional fields may legitimately be absent
        if (r.ok) continue;
        expect(r.error.code).toBe("MALFORMED_ACTION");
        expect(r.error.path).toBe(`$.${field}`);
        expect(r.error.detail).toContain(`$.${field}`);
      }
    }
  });

  it("an extra field fails with its path", () => {
    for (const sample of SAMPLES) {
      const e = bad({ ...sample, bogus: 1 });
      expect(e.code).toBe("MALFORMED_ACTION");
      expect(e.path).toBe("$.bogus");
    }
  });

  it("rejects non-objects, bad kinds and non-plain objects", () => {
    for (const raw of [
      null,
      undefined,
      1,
      "move",
      [],
      [{ kind: "move" }],
      () => 1,
      new Map(),
      new Date(),
      Object.create({ kind: "move" }),
    ]) {
      expect(bad(raw).code).toBe("MALFORMED_ACTION");
    }
    expect(bad({}).path).toBe("$.kind");
    expect(bad({ kind: 1 }).path).toBe("$.kind");
    expect(bad({ kind: "nope" }).path).toBe("$.kind");
    expect(bad({ kind: "__proto__" }).path).toBe("$.kind");
    expect(bad({ kind: "toString" }).path).toBe("$.kind");
    expect(bad({ kind: "roster", op: "nope" }).path).toBe("$.op");
    expect(bad({ kind: "roster" }).path).toBe("$.op");
  });

  it("rejects symbol keys, accessors and undefined values", () => {
    const withSymbol = { ...SAMPLES[0], [Symbol("x")]: 1 };
    expect(bad(withSymbol).code).toBe("MALFORMED_ACTION");
    const withGetter = { kind: "flip", orientation: "face_up" };
    Object.defineProperty(withGetter, "card_id", {
      get: () => "c1",
      enumerable: true,
    });
    expect(bad(withGetter).path).toBe("$.card_id");
    expect(
      bad({
        kind: "move",
        card_id: "c1",
        from_zone: "a",
        to_zone: "b",
        to_position: undefined,
      }).path,
    ).toBe("$.to_position");
  });

  it("rejects wrong types and ranges", () => {
    const move = { kind: "move", card_id: "c1", from_zone: "a", to_zone: "b" };
    expect(bad({ ...move, card_id: "bad id" }).path).toBe("$.card_id");
    expect(bad({ ...move, to_position: -1 }).path).toBe("$.to_position");
    expect(bad({ ...move, to_position: 1.5 }).path).toBe("$.to_position");
    expect(bad({ ...move, to_position: -0 }).path).toBe("$.to_position");
    expect(
      bad({ kind: "draw", from_zone: "a", to_zone: "b", count: 1.5 }).path,
    ).toBe("$.count");
    expect(
      bad({ kind: "draw", from_zone: "a", to_zone: "b", count: -1 }).path,
    ).toBe("$.count");
    expect(bad({ kind: "control_advance", steps: 0 }).path).toBe("$.steps");
    expect(bad({ kind: "control_advance", steps: 1, mode: "other" }).path).toBe(
      "$.mode",
    );
    expect(bad({ kind: "control_set", direction: 0 }).path).toBe("$.direction");
    expect(bad({ kind: "flip", card_id: "c1", orientation: "up" }).path).toBe(
      "$.orientation",
    );
    expect(
      bad({ kind: "counter_adjust", counter_id: "p", delta: 1 }).path,
    ).toBe("$.delta");
    expect(
      bad({
        kind: "counter_adjust",
        counter_id: "p",
        delta: 1n,
        ratio: { num: 1n, den: 0n },
      }).path,
    ).toBe("$.ratio.den");
    expect(
      bad({ kind: "shuffle", zone: "a", permutation: ["c1", 2] }).path,
    ).toBe("$.permutation[1]");
    expect(
      bad({
        kind: "roster",
        op: "delegate",
        seat_id: "s1",
        grantee_principal: "",
      }).path,
    ).toBe("$.grantee_principal");
    expect(
      bad({
        kind: "roster",
        op: "delegate",
        seat_id: "s1",
        grantee_principal: "a".repeat(257),
      }).path,
    ).toBe("$.grantee_principal");
    expect(
      validateAction({
        kind: "roster",
        op: "delegate",
        seat_id: "s1",
        grantee_principal: "a".repeat(256),
      }).ok,
    ).toBe(true);
    expect(
      bad({
        kind: "roster",
        op: "delegate",
        seat_id: "s1",
        grantee_principal: "\ud800",
      }).path,
    ).toBe("$.grantee_principal");
    // fields that belong to another op are extra
    expect(
      bad({ kind: "roster", op: "leave", player_id: "p1", status: "seated" })
        .path,
    ).toBe("$.status");
  });

  it("json payloads accept integers, strings, arrays, objects only; keys are checked", () => {
    const meta = (payload: unknown) =>
      validateAction({ kind: "meta", schema_id: "n", payload });
    expect(meta({ a: [1, { b: null }] }).ok).toBe(true);
    for (const payload of [
      1.5,
      NaN,
      Infinity,
      -0,
      2 ** 53,
      1n,
      undefined,
      () => 1,
      Symbol("s"),
      new Date(),
      new Map(),
      "\udc00",
      { "\ud800": 1 },
    ]) {
      const r = meta(payload);
      expect(r.ok).toBe(false);
    }
    expect(
      bad({ kind: "set_metadata", card_id: "c1", fields: { a: 1.5 } }).path,
    ).toBe("$.fields.a");
    expect(bad({ kind: "set_metadata", card_id: "c1", fields: [] }).path).toBe(
      "$.fields",
    );
  });

  it("keeps __proto__ keys as data without touching prototypes", () => {
    const payload = JSON.parse('{"__proto__": {"x": 1}, "y": 2}') as unknown;
    const r = validateAction({ kind: "meta", schema_id: "n", payload });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "meta") {
      const p = r.value.payload as Record<string, unknown>;
      expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
      expect(Object.keys(p)).toEqual(["__proto__", "y"]);
      expect(({} as { x?: number }).x).toBeUndefined();
    }
  });

  it("payload depth: 64 levels are fine, 65 are malformed, cycles do not overflow", () => {
    const nest = (levels: number): unknown => {
      let v: unknown = 1;
      for (let i = 0; i < levels; i++) v = [v];
      return v;
    };
    expect(MAX_PAYLOAD_DEPTH).toBe(64);
    expect(
      validateAction({ kind: "meta", schema_id: "n", payload: nest(64) }).ok,
    ).toBe(true);
    const e = bad({ kind: "meta", schema_id: "n", payload: nest(65) });
    expect(e.code).toBe("MALFORMED_ACTION");
    expect(e.detail).toContain("deeper than 64");
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(bad({ kind: "meta", schema_id: "n", payload: cyclic }).code).toBe(
      "MALFORMED_ACTION",
    );
    expect(
      bad({ kind: "meta", schema_id: "n", payload: nest(100000) }).code,
    ).toBe("MALFORMED_ACTION");
  });

  it("path prefix is honoured", () => {
    const r = validateAction({ kind: "flip" }, "$[3]");
    expect(!r.ok && r.error.path).toBe("$[3].card_id");
  });
});
