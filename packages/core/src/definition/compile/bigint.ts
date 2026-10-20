import type { ErrorCollector } from "./errors.js";
import { describeType } from "./strict.js";

const DECIMAL = /^-?(0|[1-9][0-9]*)$/;

/**
 * Reads a counter integer (DFR-015) into a `bigint`. Accepts a YAML integer
 * that is a safe integer, or a decimal string (required beyond the safe
 * range). A non-number/non-string or a float is `SCHEMA_TYPE`; an unsafe
 * bare integer (already corrupted by parsing) or a malformed string is
 * `INVALID_VALUE`.
 */
export function readBigInt(
  c: ErrorCollector,
  value: unknown,
  path: string,
  entity?: string,
): bigint | undefined {
  if (typeof value === "string") {
    if (DECIMAL.test(value)) return BigInt(value);
    c.add(
      "INVALID_VALUE",
      path,
      `expected a decimal integer string, got ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`,
      entity,
    );
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    c.add(
      "SCHEMA_TYPE",
      path,
      `expected an integer or a decimal string, got ${describeType(value)}`,
      entity,
    );
    return undefined;
  }
  if (!Number.isInteger(value)) {
    c.add("SCHEMA_TYPE", path, "expected an integer, got a float", entity);
    return undefined;
  }
  if (!Number.isSafeInteger(value)) {
    c.add(
      "INVALID_VALUE",
      path,
      "integer is outside the safe range; write it as a quoted decimal string",
      entity,
    );
    return undefined;
  }
  return BigInt(value);
}
