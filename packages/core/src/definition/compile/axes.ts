import type { ErrorCollector } from "./errors.js";
import {
  has,
  indexPath,
  isPlainObject,
  joinPath,
  member,
  readArray,
  readInteger,
  readObject,
  readString,
} from "./strict.js";

/** Value of one axis position: a string or a safe integer. */
export type AxisValue = string | number;

export interface Axis {
  readonly name: string;
  /** Number of values (`hi - lo + 1` for a range; never materialised up front). */
  readonly length: number;
  readonly at: (index: number) => AxisValue;
  readonly hasStrings: boolean;
  readonly hasInts: boolean;
}

const AXIS_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Reads `generate.axes` (DFR-014): an ordered list of `{name, values}`.
 * `values` is a non-empty list of strings/safe integers or `{range: [lo, hi]}`.
 * Names are distinct (`DUPLICATE_ID` at the second) and match
 * `^[a-z][a-z0-9_]*$` (`INVALID_VALUE`). Returns `undefined` after reporting.
 */
export function readAxes(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): readonly Axis[] | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  if (items.length === 0) {
    c.add("INVALID_VALUE", path, "at least one axis is required");
    return undefined;
  }
  const axes: Axis[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const entry = readObject(
      c,
      item,
      p,
      ["name", "values"],
      ["name", "values"],
    );
    if (entry === undefined) return;
    let name: string | undefined;
    if (has(entry, "name")) {
      name = readString(c, member(entry, "name"), joinPath(p, "name"));
      if (name !== undefined) {
        if (!AXIS_NAME.test(name)) {
          c.add(
            "INVALID_VALUE",
            joinPath(p, "name"),
            `axis name must match ^[a-z][a-z0-9_]*$, got ${JSON.stringify(name)}`,
            name,
          );
        } else if (seen.has(name)) {
          c.add(
            "DUPLICATE_ID",
            joinPath(p, "name"),
            `duplicate axis name "${name}"`,
            name,
          );
        } else seen.add(name);
      }
    }
    const values = has(entry, "values")
      ? readValues(c, member(entry, "values"), joinPath(p, "values"))
      : undefined;
    if (name !== undefined && values !== undefined) {
      axes.push({ name, ...values });
    }
  });
  return c.count === before ? axes : undefined;
}

type Values = Omit<Axis, "name">;

function readValues(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): Values | undefined {
  if (isPlainObject(raw)) return readRange(c, raw, path);
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  if (items.length === 0) {
    c.add("INVALID_VALUE", path, "an axis needs at least one value");
    return undefined;
  }
  const values: AxisValue[] = [];
  let good = true;
  let hasStrings = false;
  let hasInts = false;
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    if (typeof item === "string") {
      hasStrings = true;
      values.push(item);
    } else if (typeof item === "number") {
      const n = readInteger(c, item, p);
      if (n === undefined) good = false;
      else {
        hasInts = true;
        values.push(n);
      }
    } else {
      c.add("SCHEMA_TYPE", p, "an axis value must be a string or an integer");
      good = false;
    }
  });
  if (!good) return undefined;
  return {
    length: values.length,
    at: (i) => values[i] as AxisValue,
    hasStrings,
    hasInts,
  };
}

function readRange(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  path: string,
): Values | undefined {
  const entry = readObject(c, obj, path, ["range"], ["range"]);
  if (entry === undefined || !has(entry, "range")) return undefined;
  const rp = joinPath(path, "range");
  const pair = readArray(c, member(entry, "range"), rp);
  if (pair === undefined) return undefined;
  if (pair.length !== 2) {
    c.add("INVALID_VALUE", rp, "range must be [lo, hi]");
    return undefined;
  }
  const lo = readInteger(c, pair[0], indexPath(rp, 0));
  const hi = readInteger(c, pair[1], indexPath(rp, 1));
  if (lo === undefined || hi === undefined) return undefined;
  if (lo > hi) {
    c.add("INVALID_VALUE", rp, `range lo ${lo} is greater than hi ${hi}`);
    return undefined;
  }
  return {
    length: hi - lo + 1,
    at: (i) => lo + i,
    hasStrings: false,
    hasInts: true,
  };
}
