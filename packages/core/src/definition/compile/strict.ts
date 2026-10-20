import type { ErrorCollector } from "./errors.js";

/**
 * Strict readers (DBR-003, DFR-031). Each reads one node of the raw value,
 * reports at `path` and returns the typed value or `undefined` after
 * reporting. None throws for any input.
 */

export type RawObject = Readonly<Record<string, unknown>>;

const hasOwn = (o: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key);

export function isPlainObject(value: unknown): value is RawObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `path` of a mapping member: `join("seats", "list")` is `seats.list`. */
export const joinPath = (base: string, key: string): string =>
  base === "" ? key : `${base}.${key}`;

/** `path` of a sequence element: `indexPath("seats.list", 2)` is `seats.list[2]`. */
export const indexPath = (base: string, index: number): string =>
  `${base}[${index}]`;

/** Short description of a value's JSON type, for error details. */
export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

/** Whether `obj` has own key `key` (a present key set to `null` counts). */
export const has = (obj: RawObject, key: string): boolean => hasOwn(obj, key);

/** Own member `key` of `obj`, or `undefined` when absent. */
export function member(obj: RawObject, key: string): unknown {
  return hasOwn(obj, key) ? obj[key] : undefined;
}

/**
 * Reads a mapping. Not a plain object: `SCHEMA_TYPE` at `path`. Each key not
 * in `allowed`: `SCHEMA_UNKNOWN_KEY` at the key's path. Each `required` key
 * absent: `SCHEMA_MISSING` at the key's path. Returns the object (even if
 * keys were reported) so the caller can continue to collect errors.
 */
export function readObject(
  c: ErrorCollector,
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[] = [],
): RawObject | undefined {
  if (!isPlainObject(value)) {
    c.add(
      "SCHEMA_TYPE",
      path,
      `expected a mapping, got ${describeType(value)}`,
    );
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      c.add("SCHEMA_UNKNOWN_KEY", joinPath(path, key), `unknown key "${key}"`);
    }
  }
  for (const key of required) {
    if (!hasOwn(value, key)) {
      c.add(
        "SCHEMA_MISSING",
        joinPath(path, key),
        `missing required key "${key}"`,
      );
    }
  }
  return value;
}

export function readArray(
  c: ErrorCollector,
  value: unknown,
  path: string,
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    c.add(
      "SCHEMA_TYPE",
      path,
      `expected a sequence, got ${describeType(value)}`,
    );
    return undefined;
  }
  return value as readonly unknown[];
}

export function readString(
  c: ErrorCollector,
  value: unknown,
  path: string,
): string | undefined {
  if (typeof value !== "string") {
    c.add("SCHEMA_TYPE", path, `expected a string, got ${describeType(value)}`);
    return undefined;
  }
  return value;
}

export function readBoolean(
  c: ErrorCollector,
  value: unknown,
  path: string,
): boolean | undefined {
  if (typeof value !== "boolean") {
    c.add(
      "SCHEMA_TYPE",
      path,
      `expected a boolean, got ${describeType(value)}`,
    );
    return undefined;
  }
  return value;
}

/**
 * A YAML integer. Not a number or a float: `SCHEMA_TYPE`. An integer beyond
 * the safe range (already corrupted by parsing): `INVALID_VALUE`.
 */
export function readInteger(
  c: ErrorCollector,
  value: unknown,
  path: string,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    c.add(
      "SCHEMA_TYPE",
      path,
      `expected an integer, got ${describeType(value)}`,
    );
    return undefined;
  }
  if (!Number.isInteger(value)) {
    c.add("SCHEMA_TYPE", path, "expected an integer, got a non-integer number");
    return undefined;
  }
  if (!Number.isSafeInteger(value)) {
    c.add("INVALID_VALUE", path, "integer is outside the safe range");
    return undefined;
  }
  return value;
}

/** An integer in `[min, max]`; out of range is `INVALID_VALUE`. */
export function readIntegerInRange(
  c: ErrorCollector,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  const n = readInteger(c, value, path);
  if (n === undefined) return undefined;
  if (n < min || n > max) {
    c.add(
      "INVALID_VALUE",
      path,
      `expected an integer in [${min}, ${max}], got ${n}`,
    );
    return undefined;
  }
  return n;
}

/** A member of `values`; a non-string is `SCHEMA_TYPE`, another string `INVALID_VALUE`. */
export function readEnum<T extends string>(
  c: ErrorCollector,
  value: unknown,
  path: string,
  values: readonly T[],
): T | undefined {
  const s = readString(c, value, path);
  if (s === undefined) return undefined;
  if (!(values as readonly string[]).includes(s)) {
    c.add(
      "INVALID_VALUE",
      path,
      `expected one of ${values.join(", ")}, got ${JSON.stringify(s)}`,
    );
    return undefined;
  }
  return s as T;
}

/** A sequence of strings; reports each non-string element. */
export function readStringList(
  c: ErrorCollector,
  value: unknown,
  path: string,
): readonly string[] | undefined {
  const arr = readArray(c, value, path);
  if (arr === undefined) return undefined;
  const out: string[] = [];
  let good = true;
  arr.forEach((item, i) => {
    const s = readString(c, item, indexPath(path, i));
    if (s === undefined) good = false;
    else out.push(s);
  });
  return good ? out : undefined;
}
