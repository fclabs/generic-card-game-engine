import { GRANTABLE_VIEW_KEYS } from "./constants.js";
import type { ErrorCollector } from "./errors.js";
import { indexPath, readArray, readString } from "./strict.js";

/**
 * Compiles `view_keys` (DFR-022): a non-empty list of distinct members of
 * `GRANTABLE_VIEW_KEYS`. Returns `undefined` when anything was reported.
 */
export function compileViewKeys(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): readonly string[] | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  if (items.length === 0) {
    c.add("INVALID_VALUE", path, "view_keys must not be empty");
    return undefined;
  }
  const out: string[] = [];
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const key = readString(c, item, p);
    if (key === undefined) return;
    if (!GRANTABLE_VIEW_KEYS.includes(key)) {
      c.add(
        "INVALID_VALUE",
        p,
        `unknown view key ${JSON.stringify(key)}; grantable: ${GRANTABLE_VIEW_KEYS.join(", ")}`,
        key,
      );
    } else if (out.includes(key)) {
      c.add("DUPLICATE_ID", p, `duplicate view key "${key}"`, key);
    } else out.push(key);
  });
  return c.count === before ? out : undefined;
}
