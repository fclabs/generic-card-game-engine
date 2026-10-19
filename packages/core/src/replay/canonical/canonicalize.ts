import { encodeUtf8 } from "../../util/utf8.js";
import type { CanonicalSchema } from "./schema.js";

/** Maximum nesting depth of a `json` node (plan-level decision; the node's own value is depth 1). */
export const JSON_MAX_DEPTH = 64;

/** A value is outside canonical profile v1 or does not fit its schema. `path` names the offender (`$` is the root). */
export class CanonicalError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`canonical error at ${path}: ${detail}`);
    this.name = "CanonicalError";
    this.path = path;
  }
}

const ESCAPES: Readonly<Record<number, string>> = {
  0x22: '\\"',
  0x5c: "\\\\",
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
};

const HEX = "0123456789abcdef";

/** Rule 6: JSON string with minimal escaping; lone surrogates are errors. */
function quote(s: string, path: string): string {
  let out = '"';
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < n ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) {
        throw new CanonicalError(path, `lone surrogate at index ${String(i)}`);
      }
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CanonicalError(path, `lone surrogate at index ${String(i)}`);
    }
    if (c < 0x20 || c === 0x22 || c === 0x5c) {
      out += s.slice(start, i);
      out += ESCAPES[c] ?? "\\u00" + (HEX[c >> 4] ?? "") + (HEX[c & 15] ?? "");
      start = i + 1;
    }
  }
  return out + s.slice(start) + '"';
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v) as object | null;
    const name = proto === null ? undefined : proto.constructor.name;
    return `object (${name ?? "null prototype"})`;
  }
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

function child(path: string, key: string): string {
  return `${path}.${key}`;
}

function index(path: string, i: number): string {
  return `${path}[${String(i)}]`;
}

function keyed(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function ownKeys(obj: Record<string, unknown>, path: string): string[] {
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new CanonicalError(path, "symbol-keyed property");
  }
  return Object.keys(obj);
}

function emitInt(v: unknown, path: string): string {
  if (typeof v !== "number") {
    throw new CanonicalError(path, `expected safe integer, got ${describe(v)}`);
  }
  if (Object.is(v, -0)) throw new CanonicalError(path, "negative zero");
  if (!Number.isSafeInteger(v)) {
    throw new CanonicalError(path, `not a safe integer: ${String(v)}`);
  }
  return String(v);
}

function emitJson(
  v: unknown,
  path: string,
  depth: number,
  ancestors: Set<object>,
): string {
  switch (typeof v) {
    case "string":
      return quote(v, path);
    case "number":
      return emitInt(v, path);
    case "boolean":
      return v ? "true" : "false";
    case "object":
      break;
    default:
      throw new CanonicalError(
        path,
        `${typeof v} is not allowed in a json node`,
      );
  }
  if (v === null) return "null";
  if (depth > JSON_MAX_DEPTH) {
    throw new CanonicalError(
      path,
      `json depth exceeds ${String(JSON_MAX_DEPTH)}`,
    );
  }
  if (ancestors.has(v)) throw new CanonicalError(path, "cyclic structure");
  ancestors.add(v);
  const parts: string[] = [];
  let out: string;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      parts.push(emitJson(v[i], index(path, i), depth + 1, ancestors));
    }
    out = `[${parts.join(",")}]`;
  } else if (isPlainObject(v)) {
    const keys = ownKeys(v, path).sort();
    for (const k of keys) {
      parts.push(
        `${quote(k, keyed(path, k))}:${emitJson(v[k], child(path, k), depth + 1, ancestors)}`,
      );
    }
    out = `{${parts.join(",")}}`;
  } else {
    throw new CanonicalError(
      path,
      `${describe(v)} is not allowed in a json node`,
    );
  }
  ancestors.delete(v);
  return out;
}

function emit(schema: CanonicalSchema, v: unknown, path: string): string {
  switch (schema.kind) {
    case "int":
      return emitInt(v, path);
    case "bigint":
      if (typeof v !== "bigint") {
        throw new CanonicalError(path, `expected bigint, got ${describe(v)}`);
      }
      return `"${v.toString(10)}"`;
    case "string":
      if (typeof v !== "string") {
        throw new CanonicalError(path, `expected string, got ${describe(v)}`);
      }
      return quote(v, path);
    case "bool":
      if (typeof v !== "boolean") {
        throw new CanonicalError(path, `expected boolean, got ${describe(v)}`);
      }
      return v ? "true" : "false";
    case "null":
      if (v !== null) {
        throw new CanonicalError(path, `expected null, got ${describe(v)}`);
      }
      return "null";
    case "json":
      return emitJson(v, path, 1, new Set());
    case "optional":
      // Absence is handled by the enclosing object; a present value must fit `of`.
      return emit(schema.of, v, path);
    case "array": {
      if (!Array.isArray(v)) {
        throw new CanonicalError(path, `expected array, got ${describe(v)}`);
      }
      const parts: string[] = [];
      for (let i = 0; i < v.length; i++) {
        parts.push(emit(schema.of, v[i], index(path, i)));
      }
      return `[${parts.join(",")}]`;
    }
    case "idMap": {
      if (!isPlainObject(v)) {
        throw new CanonicalError(path, `expected id map, got ${describe(v)}`);
      }
      const parts: string[] = [];
      for (const k of ownKeys(v, path).sort()) {
        const p = keyed(path, k);
        parts.push(`[${quote(k, p)},${emit(schema.of, v[k], p)}]`);
      }
      return `[${parts.join(",")}]`;
    }
    case "object": {
      if (!isPlainObject(v)) {
        throw new CanonicalError(path, `expected object, got ${describe(v)}`);
      }
      const declared = new Set(schema.fields.map(([name]) => name));
      for (const k of ownKeys(v, path)) {
        if (!declared.has(k)) {
          throw new CanonicalError(child(path, k), "undeclared field");
        }
      }
      const parts: string[] = [];
      for (const [name, node] of schema.fields) {
        const p = child(path, name);
        if (!Object.prototype.hasOwnProperty.call(v, name)) {
          if (node.kind === "optional") continue;
          throw new CanonicalError(p, "missing required field");
        }
        parts.push(`${quote(name, p)}:${emit(node, v[name], p)}`);
      }
      return `{${parts.join(",")}}`;
    }
  }
}

/**
 * Canonical JSON profile v1 (spec §6.2): UTF-8 bytes of `value` as described by `schema`.
 * Throws {@link CanonicalError} (with `path`) for anything outside the profile or the schema.
 */
export function canonicalize(
  schema: CanonicalSchema,
  value: unknown,
): Uint8Array {
  const text = emit(schema, value, "$");
  const bytes = encodeUtf8(text);
  if (!bytes.ok) {
    // Unreachable: every string was surrogate-checked while emitting.
    throw new CanonicalError(
      "$",
      `lone surrogate at index ${String(bytes.error.index)}`,
    );
  }
  return bytes.value;
}
