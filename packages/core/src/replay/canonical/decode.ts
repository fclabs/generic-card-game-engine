import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import { JSON_MAX_DEPTH } from "./canonicalize.js";
import type { JsonValue } from "../../session/state.js";
import type { CanonicalSchema } from "./schema.js";

/**
 * `decodeCanonical` (spec PFR-035): the inverse of `canonicalize`. Canonical profile v1 and
 * every encoder are untouched; this module only reads.
 *
 * The tokenizer is hand-written because `JSON.parse` keeps the last of two equal keys silently,
 * rounds integers beyond 2^53 and cannot report where a value is wrong. Formatting is tolerated
 * (any JSON whitespace, any object key order, any `idMap` pair order); content is strict
 * (exact schema, no unknown keys, safe integers only, `bigint` as decimal strings).
 */

/** Failure codes of package decoding (PFR-039); `decodeCanonical` itself reports the first four. */
export type PackageErrorCode =
  | "PACKAGE_TOO_LARGE"
  | "PACKAGE_SYNTAX"
  | "PACKAGE_DUPLICATE_KEY"
  | "PACKAGE_UNKNOWN_KEY"
  | "PACKAGE_SCHEMA"
  | "PACKAGE_FORMAT_VERSION"
  | "PACKAGE_LOG_GAP";

/** One decoding failure. `path` uses the `canonicalize` notation (`$.log[3].eventId`, `$.x["id"]`). */
export interface PackageError {
  readonly code: PackageErrorCode;
  readonly path: string;
  readonly detail: string;
}

/** At most this many errors are reported, in document order (PFR-036). */
export const MAX_DECODE_ERRORS = 100;

/** Nesting limit of the tokenizer itself (the `json` node limit is `JSON_MAX_DEPTH`). */
const MAX_PARSE_DEPTH = 256;

type Node =
  | {
      readonly t: "str";
      readonly v: string;
      readonly pos: number;
      readonly lone: boolean;
    }
  | { readonly t: "num"; readonly text: string; readonly pos: number }
  | { readonly t: "bool"; readonly v: boolean; readonly pos: number }
  | { readonly t: "null"; readonly pos: number }
  | { readonly t: "arr"; readonly items: readonly Node[]; readonly pos: number }
  | {
      readonly t: "obj";
      readonly entries: readonly Entry[];
      readonly pos: number;
    };

interface Entry {
  readonly key: string;
  readonly keyLone: boolean;
  readonly keyPos: number;
  readonly value: Node;
}

/** A parsed, schema-less document (internal). */
export interface ParsedDocument {
  readonly root: Node;
}

class Stop extends Error {}

class SyntaxFailure extends Error {
  readonly pos: number;
  constructor(pos: number, detail: string) {
    super(detail);
    this.pos = pos;
  }
}

// ---------------------------------------------------------------- UTF-8

/** Strict UTF-8 decoding (no replacement characters, no overlong forms, no surrogates). */
function decodeUtf8(bytes: Uint8Array): string | number {
  const units: number[] = [];
  let out = "";
  const n = bytes.length;
  let i = 0;
  const fail = (at: number): number => at;
  while (i < n) {
    const b = bytes[i] ?? 0;
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b >= 0xc2 && b <= 0xdf) {
      const b1 = bytes[i + 1];
      if (b1 === undefined || (b1 & 0xc0) !== 0x80) return fail(i);
      cp = ((b & 0x1f) << 6) | (b1 & 0x3f);
      i += 2;
    } else if (b >= 0xe0 && b <= 0xef) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (
        b1 === undefined ||
        b2 === undefined ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80
      ) {
        return fail(i);
      }
      cp = ((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) return fail(i);
      i += 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (
        b1 === undefined ||
        b2 === undefined ||
        b3 === undefined ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      ) {
        return fail(i);
      }
      cp =
        ((b & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      if (cp < 0x10000 || cp > 0x10ffff) return fail(i);
      i += 4;
    } else {
      return fail(i);
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp);
    }
    if (units.length >= 8192) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  if (units.length > 0) out += String.fromCharCode(...units);
  return out;
}

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- tokenizer

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function pathOf(segments: readonly (string | number)[]): string {
  let p = "$";
  for (const s of segments) {
    if (typeof s === "number") p += `[${String(s)}]`;
    else p += IDENT.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`;
  }
  return p;
}

class Parser {
  private i = 0;
  private readonly segments: (string | number)[] = [];
  constructor(private readonly text: string) {}

  fail(detail: string, at = this.i): never {
    throw new SyntaxFailure(at, detail);
  }

  parseRoot(): Node {
    this.skipWs();
    if (this.i >= this.text.length) this.fail("empty input");
    const node = this.value(0);
    this.skipWs();
    if (this.i < this.text.length)
      this.fail("unexpected content after the root value");
    return node;
  }

  segmentsNow(): readonly (string | number)[] {
    return this.segments;
  }

  private skipWs(): void {
    const t = this.text;
    while (this.i < t.length) {
      const c = t.charCodeAt(this.i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) this.i++;
      else break;
    }
  }

  private value(depth: number): Node {
    if (depth > MAX_PARSE_DEPTH) {
      this.fail(`nesting deeper than ${String(MAX_PARSE_DEPTH)}`);
    }
    const t = this.text;
    const c = t.charCodeAt(this.i);
    const pos = this.i;
    if (this.i >= t.length) this.fail("unexpected end of input");
    if (c === 0x7b) return this.object(depth);
    if (c === 0x5b) return this.array(depth);
    if (c === 0x22) {
      const s = this.string();
      return { t: "str", v: s.v, pos, lone: s.lone };
    }
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return this.number();
    if (t.startsWith("true", this.i)) {
      this.i += 4;
      return { t: "bool", v: true, pos };
    }
    if (t.startsWith("false", this.i)) {
      this.i += 5;
      return { t: "bool", v: false, pos };
    }
    if (t.startsWith("null", this.i)) {
      this.i += 4;
      return { t: "null", pos };
    }
    return this.fail(
      `unexpected character ${JSON.stringify(t.charAt(this.i))}`,
    );
  }

  private number(): Node {
    const t = this.text;
    const start = this.i;
    const digit = (k: number): boolean => {
      const c = t.charCodeAt(k);
      return c >= 0x30 && c <= 0x39;
    };
    if (t.charCodeAt(this.i) === 0x2d) this.i++;
    if (!digit(this.i)) this.fail("invalid number");
    if (t.charCodeAt(this.i) === 0x30) {
      this.i++;
      if (digit(this.i)) this.fail("leading zero in number", start);
    } else {
      while (digit(this.i)) this.i++;
    }
    if (t.charCodeAt(this.i) === 0x2e) {
      this.i++;
      if (!digit(this.i)) this.fail("invalid number");
      while (digit(this.i)) this.i++;
    }
    const e = t.charCodeAt(this.i);
    if (e === 0x65 || e === 0x45) {
      this.i++;
      const s = t.charCodeAt(this.i);
      if (s === 0x2b || s === 0x2d) this.i++;
      if (!digit(this.i)) this.fail("invalid number");
      while (digit(this.i)) this.i++;
    }
    return { t: "num", text: t.slice(start, this.i), pos: start };
  }

  private string(): { v: string; lone: boolean } {
    const t = this.text;
    const open = this.i;
    this.i++;
    let out = "";
    let start = this.i;
    let surrogateEscape = false;
    for (;;) {
      if (this.i >= t.length) this.fail("unterminated string", open);
      const c = t.charCodeAt(this.i);
      if (c === 0x22) {
        out += t.slice(start, this.i);
        this.i++;
        break;
      }
      if (c < 0x20) this.fail("control character in string");
      if (c === 0x5c) {
        out += t.slice(start, this.i);
        const e = t.charAt(this.i + 1);
        this.i += 2;
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = t.slice(this.i, this.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              this.fail("invalid \\u escape", this.i - 2);
            }
            const code = parseInt(hex, 16);
            if (code >= 0xd800 && code <= 0xdfff) surrogateEscape = true;
            out += String.fromCharCode(code);
            this.i += 4;
            break;
          }
          default:
            this.fail("invalid escape", this.i - 2);
        }
        start = this.i;
        continue;
      }
      this.i++;
    }
    return { v: out, lone: surrogateEscape && hasLoneSurrogate(out) };
  }

  private array(depth: number): Node {
    const pos = this.i;
    this.i++;
    const items: Node[] = [];
    this.skipWs();
    if (this.text.charCodeAt(this.i) === 0x5d) {
      this.i++;
      return { t: "arr", items, pos };
    }
    for (;;) {
      this.skipWs();
      this.segments.push(items.length);
      items.push(this.value(depth + 1));
      this.segments.pop();
      this.skipWs();
      const c = this.text.charCodeAt(this.i);
      if (c === 0x2c) {
        this.i++;
        continue;
      }
      if (c === 0x5d) {
        this.i++;
        return { t: "arr", items, pos };
      }
      this.fail(
        this.i >= this.text.length
          ? "unexpected end of input"
          : "expected , or ]",
      );
    }
  }

  private object(depth: number): Node {
    const pos = this.i;
    this.i++;
    const entries: Entry[] = [];
    this.skipWs();
    if (this.text.charCodeAt(this.i) === 0x7d) {
      this.i++;
      return { t: "obj", entries, pos };
    }
    for (;;) {
      this.skipWs();
      if (this.text.charCodeAt(this.i) !== 0x22) {
        this.fail(
          this.i >= this.text.length
            ? "unexpected end of input"
            : "expected a string key",
        );
      }
      const keyPos = this.i;
      const key = this.string();
      this.skipWs();
      if (this.text.charCodeAt(this.i) !== 0x3a) {
        this.fail(
          this.i >= this.text.length ? "unexpected end of input" : "expected :",
        );
      }
      this.i++;
      this.skipWs();
      this.segments.push(key.v);
      const value = this.value(depth + 1);
      this.segments.pop();
      entries.push({ key: key.v, keyLone: key.lone, keyPos, value });
      this.skipWs();
      const c = this.text.charCodeAt(this.i);
      if (c === 0x2c) {
        this.i++;
        continue;
      }
      if (c === 0x7d) {
        this.i++;
        return { t: "obj", entries, pos };
      }
      this.fail(
        this.i >= this.text.length
          ? "unexpected end of input"
          : "expected , or }",
      );
    }
  }
}

/**
 * Tokenises `bytes` into a schema-less tree. A syntax failure is a single `PACKAGE_SYNTAX`
 * error whose `path` names the container being read when the input went wrong.
 */
export function parseDocument(
  bytes: Uint8Array,
): Result<ParsedDocument, readonly PackageError[]> {
  const text = decodeUtf8(bytes);
  if (typeof text === "number") {
    return err([
      {
        code: "PACKAGE_SYNTAX",
        path: "$",
        detail: `invalid UTF-8 at byte ${String(text)}`,
      },
    ]);
  }
  const parser = new Parser(text);
  try {
    return ok({ root: parser.parseRoot() });
  } catch (e) {
    if (e instanceof SyntaxFailure) {
      return err([
        {
          code: "PACKAGE_SYNTAX",
          path: pathOf(parser.segmentsNow()),
          detail: `${e.message} at offset ${String(e.pos)}`,
        },
      ]);
    }
    throw e;
  }
}

/** The member `name` of the root object of `doc`, if the root is an object that has it. */
export function rootMember(
  doc: ParsedDocument,
  name: string,
):
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "other" }
  | undefined {
  if (doc.root.t !== "obj") return undefined;
  const entry = doc.root.entries.find((e) => e.key === name);
  if (entry === undefined) return undefined;
  const v = entry.value;
  if (v.t === "num" && /^-?(0|[1-9][0-9]*)$/.test(v.text)) {
    const n = Number(v.text);
    if (Number.isSafeInteger(n)) return { kind: "int", value: n };
  }
  return { kind: "other" };
}

/**
 * The schema-less JSON value of a parsed document (used to hand the raw package to the
 * upgrader chain, PFR-051). Strict like the decoder: duplicate keys and numbers that are not
 * safe integers are rejected with a path (the first failure only), so no information is
 * silently lost or rounded before an upgrader sees it.
 */
export function documentToJson(
  doc: ParsedDocument,
): Result<JsonValue, readonly PackageError[]> {
  const fail = (
    code: PackageErrorCode,
    path: string,
    detail: string,
  ): Result<JsonValue, readonly PackageError[]> =>
    err([{ code, path, detail }]);
  const walk = (
    node: Node,
    path: string,
  ): Result<JsonValue, readonly PackageError[]> => {
    switch (node.t) {
      case "str":
        return ok(node.v);
      case "bool":
        return ok(node.v);
      case "null":
        return ok(null);
      case "num": {
        const n = Number(node.text);
        if (!INT_TEXT.test(node.text) || !Number.isSafeInteger(n)) {
          return fail("PACKAGE_SCHEMA", path, "expected a safe integer");
        }
        return ok(n);
      }
      case "arr": {
        const out: JsonValue[] = [];
        for (let i = 0; i < node.items.length; i++) {
          const item = node.items[i];
          if (item === undefined) continue;
          const r = walk(item, `${path}[${String(i)}]`);
          if (!r.ok) return r;
          out.push(r.value);
        }
        return ok(out);
      }
      case "obj": {
        const out: Record<string, JsonValue> = {};
        for (const entry of node.entries) {
          const at = IDENT.test(entry.key)
            ? `${path}.${entry.key}`
            : `${path}[${JSON.stringify(entry.key)}]`;
          if (Object.hasOwn(out, entry.key)) {
            return fail("PACKAGE_DUPLICATE_KEY", at, "duplicate key");
          }
          const r = walk(entry.value, at);
          if (!r.ok) return r;
          Object.defineProperty(out, entry.key, {
            value: r.value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        return ok(out);
      }
    }
  };
  return walk(doc.root, "$");
}

// ---------------------------------------------------------------- schema walk

const INT_TEXT = /^-?(0|[1-9][0-9]*)$/;
const BIGINT_TEXT = /^(0|-?[1-9][0-9]*)$/;

interface Failure {
  readonly pos: number;
  readonly error: PackageError;
}

class Walk {
  readonly failures: Failure[] = [];

  report(
    pos: number,
    code: PackageErrorCode,
    path: string,
    detail: string,
  ): void {
    this.failures.push({ pos, error: { code, path, detail } });
    if (this.failures.length >= MAX_DECODE_ERRORS) throw new Stop();
  }

  describe(node: Node): string {
    switch (node.t) {
      case "str":
        return "string";
      case "num":
        return INT_TEXT.test(node.text) ? "number" : "non-integer number";
      case "bool":
        return "boolean";
      case "null":
        return "null";
      case "arr":
        return "array";
      case "obj":
        return "object";
    }
  }

  checkString(node: Extract<Node, { t: "str" }>, path: string): void {
    if (node.lone) {
      this.report(node.pos, "PACKAGE_SYNTAX", path, "lone surrogate in string");
    }
  }

  intValue(node: Node, path: string): number | undefined {
    if (node.t !== "num") {
      this.report(
        node.pos,
        "PACKAGE_SCHEMA",
        path,
        `expected safe integer, got ${this.describe(node)}`,
      );
      return undefined;
    }
    if (!INT_TEXT.test(node.text)) {
      this.report(
        node.pos,
        "PACKAGE_SCHEMA",
        path,
        `not an integer: ${node.text}`,
      );
      return undefined;
    }
    if (node.text === "-0") {
      this.report(node.pos, "PACKAGE_SCHEMA", path, "negative zero");
      return undefined;
    }
    const n = Number(node.text);
    if (!Number.isSafeInteger(n)) {
      this.report(
        node.pos,
        "PACKAGE_SCHEMA",
        path,
        `not a safe integer: ${node.text}`,
      );
      return undefined;
    }
    return n;
  }

  json(node: Node, path: string, depth: number): unknown {
    switch (node.t) {
      case "str":
        this.checkString(node, path);
        return node.v;
      case "num":
        return this.intValue(node, path);
      case "bool":
        return node.v;
      case "null":
        return null;
      case "arr":
      case "obj":
        break;
    }
    if (depth > JSON_MAX_DEPTH) {
      this.report(
        node.pos,
        "PACKAGE_SCHEMA",
        path,
        `json depth exceeds ${String(JSON_MAX_DEPTH)}`,
      );
      return undefined;
    }
    if (node.t === "arr") {
      const out: unknown[] = [];
      node.items.forEach((item, i) => {
        out.push(this.json(item, `${path}[${String(i)}]`, depth + 1));
      });
      return out;
    }
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const e of node.entries) {
      const p = `${path}${IDENT.test(e.key) ? "." + e.key : `[${JSON.stringify(e.key)}]`}`;
      if (e.keyLone) {
        this.report(e.keyPos, "PACKAGE_SYNTAX", p, "lone surrogate in key");
      }
      if (seen.has(e.key)) {
        this.report(
          e.keyPos,
          "PACKAGE_DUPLICATE_KEY",
          p,
          `duplicate key ${JSON.stringify(e.key)}`,
        );
        continue;
      }
      seen.add(e.key);
      Object.defineProperty(out, e.key, {
        value: this.json(e.value, p, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }

  node(schema: CanonicalSchema, node: Node, path: string): unknown {
    switch (schema.kind) {
      case "int":
        return this.intValue(node, path);
      case "bigint": {
        if (node.t !== "str" || !BIGINT_TEXT.test(node.v)) {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            node.t === "str"
              ? `not a decimal integer string: ${JSON.stringify(node.v)}`
              : `expected bigint as a decimal string, got ${this.describe(node)}`,
          );
          return undefined;
        }
        return BigInt(node.v);
      }
      case "string":
        if (node.t !== "str") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected string, got ${this.describe(node)}`,
          );
          return undefined;
        }
        this.checkString(node, path);
        return node.v;
      case "bool":
        if (node.t !== "bool") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected boolean, got ${this.describe(node)}`,
          );
          return undefined;
        }
        return node.v;
      case "null":
        if (node.t !== "null") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected null, got ${this.describe(node)}`,
          );
          return undefined;
        }
        return null;
      case "json":
        return this.json(node, path, 1);
      case "optional":
        return this.node(schema.of, node, path);
      case "array": {
        if (node.t !== "arr") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected array, got ${this.describe(node)}`,
          );
          return undefined;
        }
        return node.items.map((item, i) =>
          this.node(schema.of, item, `${path}[${String(i)}]`),
        );
      }
      case "idMap": {
        if (node.t !== "arr") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected id map (array of [key, value] pairs), got ${this.describe(node)}`,
          );
          return undefined;
        }
        const out: Record<string, unknown> = {};
        const seen = new Set<string>();
        node.items.forEach((pair, i) => {
          const at = `${path}[${String(i)}]`;
          if (
            pair.t !== "arr" ||
            pair.items.length !== 2 ||
            pair.items[0]?.t !== "str"
          ) {
            this.report(
              pair.pos,
              "PACKAGE_SCHEMA",
              at,
              "expected a [key, value] pair with a string key",
            );
            return;
          }
          const keyNode = pair.items[0];
          const valueNode = pair.items[1];
          if (valueNode === undefined) return;
          const key = keyNode.v;
          const p = `${path}[${JSON.stringify(key)}]`;
          this.checkString(keyNode, p);
          if (seen.has(key)) {
            this.report(
              keyNode.pos,
              "PACKAGE_DUPLICATE_KEY",
              p,
              `duplicate key ${JSON.stringify(key)}`,
            );
            return;
          }
          seen.add(key);
          Object.defineProperty(out, key, {
            value: this.node(schema.of, valueNode, p),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        });
        return out;
      }
      case "object": {
        if (node.t !== "obj") {
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            path,
            `expected object, got ${this.describe(node)}`,
          );
          return undefined;
        }
        const fields = new Map(schema.fields);
        const out: Record<string, unknown> = {};
        const seen = new Set<string>();
        for (const e of node.entries) {
          const p = `${path}.${e.key}`;
          if (e.keyLone) {
            this.report(e.keyPos, "PACKAGE_SYNTAX", p, "lone surrogate in key");
          }
          if (seen.has(e.key)) {
            this.report(
              e.keyPos,
              "PACKAGE_DUPLICATE_KEY",
              p,
              `duplicate key ${JSON.stringify(e.key)}`,
            );
            continue;
          }
          seen.add(e.key);
          const fieldSchema = fields.get(e.key);
          if (fieldSchema === undefined) {
            this.report(e.keyPos, "PACKAGE_UNKNOWN_KEY", p, "unknown key");
            continue;
          }
          Object.defineProperty(out, e.key, {
            value: this.node(fieldSchema, e.value, p),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        for (const [name, fieldSchema] of schema.fields) {
          if (seen.has(name) || fieldSchema.kind === "optional") continue;
          this.report(
            node.pos,
            "PACKAGE_SCHEMA",
            `${path}.${name}`,
            "missing required field",
          );
        }
        return out;
      }
    }
  }
}

/** Validates a parsed document against `schema` and rebuilds the value (`bigint` from strings). */
export function decodeDocument(
  schema: CanonicalSchema,
  doc: ParsedDocument,
): Result<unknown, readonly PackageError[]> {
  const walk = new Walk();
  let value: unknown;
  try {
    value = walk.node(schema, doc.root, "$");
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  if (walk.failures.length === 0) return ok(value);
  const sorted = walk.failures
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.pos - b.f.pos || a.i - b.i)
    .slice(0, MAX_DECODE_ERRORS)
    .map((x) => x.f.error);
  return err(sorted);
}

/**
 * The inverse of `canonicalize(schema, value)` (PFR-035): `decodeCanonical(schema,
 * canonicalize(schema, v))` deep-equals `v`. Tolerant of formatting, strict about content;
 * returns up to {@link MAX_DECODE_ERRORS} path-bearing errors in document order. Never throws
 * for any byte input.
 */
export function decodeCanonical(
  schema: CanonicalSchema,
  bytes: Uint8Array,
): Result<unknown, readonly PackageError[]> {
  const parsed = parseDocument(bytes);
  if (!parsed.ok) return parsed;
  return decodeDocument(schema, parsed.value);
}
