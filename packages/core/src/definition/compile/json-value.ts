import type { ErrorCollector } from "./errors.js";
import { indexPath, isPlainObject, joinPath } from "./strict.js";

/** Canonical profile v1 depth limit of a `json` node (the node itself is depth 1). */
export const JSON_MAX_DEPTH = 64;

function loneSurrogateAt(s: string): number {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
      else return i;
    } else if (code >= 0xdc00 && code <= 0xdfff) return i;
  }
  return -1;
}

/**
 * Validates a value declared `json` (DFR-010, DFR-014): `null`, booleans,
 * strings, safe integers, arrays and plain objects. A float or a non-JSON
 * value is `SCHEMA_TYPE`; an unsafe integer, a value nested deeper than 64
 * and a lone surrogate are `INVALID_VALUE`, each at the nested path.
 * Reports at most one error. Returns whether the value is acceptable.
 */
export function validateJsonValue(
  c: ErrorCollector,
  value: unknown,
  path: string,
  entity?: string,
): boolean {
  const fail = (
    code: "SCHEMA_TYPE" | "INVALID_VALUE",
    p: string,
    detail: string,
  ): false => {
    c.add(code, p, detail, entity);
    return false;
  };
  const walk = (v: unknown, p: string, depth: number): boolean => {
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "string") {
      return loneSurrogateAt(v) === -1
        ? true
        : fail("INVALID_VALUE", p, "string contains a lone surrogate");
    }
    if (typeof v === "number") {
      if (!Number.isInteger(v)) {
        return fail("SCHEMA_TYPE", p, "floats are not allowed in a json value");
      }
      return Number.isSafeInteger(v)
        ? true
        : fail("INVALID_VALUE", p, "integer is outside the safe range");
    }
    if (typeof v !== "object") {
      return fail("SCHEMA_TYPE", p, `${typeof v} is not a JSON value`);
    }
    if (depth > JSON_MAX_DEPTH) {
      return fail(
        "INVALID_VALUE",
        p,
        `json value is nested deeper than ${JSON_MAX_DEPTH}`,
      );
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) {
        if (!walk(v[i], indexPath(p, i), depth + 1)) return false;
      }
      return true;
    }
    if (!isPlainObject(v)) {
      return fail("SCHEMA_TYPE", p, "not a plain JSON object");
    }
    for (const key of Object.keys(v)) {
      if (loneSurrogateAt(key) !== -1) {
        return fail("INVALID_VALUE", p, "key contains a lone surrogate");
      }
      if (!walk(v[key], joinPath(p, key), depth + 1)) return false;
    }
    return true;
  };
  return walk(value, path, 1);
}
