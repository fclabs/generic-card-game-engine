import type { RoleDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import { checkId } from "./ids.js";
import {
  has,
  indexPath,
  joinPath,
  member,
  readArray,
  readEnum,
  readObject,
  readString,
} from "./strict.js";

/** Roles every game has (DFR-021). */
export const BUILT_IN_ROLES: readonly string[] = [
  "player",
  "dealer",
  "auditor",
  "render",
];

const SUBJECTS = ["required", "optional", "forbidden"] as const;

/**
 * Compiles `roles` (DFR-021): `{id, subject}` items whose ids differ from the
 * built-ins and from each other (`DUPLICATE_ID` at the later occurrence).
 * Returns `undefined` when anything was reported.
 */
export function compileRoles(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): readonly RoleDecl[] | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const out: RoleDecl[] = [];
  const seen = new Set<string>(BUILT_IN_ROLES);
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const obj = readObject(c, item, p, ["id", "subject"], ["id", "subject"]);
    if (obj === undefined) return;
    const id = has(obj, "id")
      ? readString(c, member(obj, "id"), joinPath(p, "id"))
      : undefined;
    const subject = has(obj, "subject")
      ? readEnum(c, member(obj, "subject"), joinPath(p, "subject"), SUBJECTS)
      : undefined;
    if (id === undefined) return;
    if (!checkId(c, id, joinPath(p, "id"), "role id")) return;
    if (seen.has(id)) {
      c.add(
        "DUPLICATE_ID",
        joinPath(p, "id"),
        BUILT_IN_ROLES.includes(id)
          ? `role "${id}" is built in and cannot be redeclared`
          : `duplicate role id "${id}"`,
        id,
      );
      return;
    }
    seen.add(id);
    if (subject !== undefined) out.push({ id, subject });
  });
  return c.count === before ? out : undefined;
}
