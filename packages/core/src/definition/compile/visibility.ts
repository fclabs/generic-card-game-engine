import { setOwn } from "../../session/records.js";
import type { Audience, VisibilityRules } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import {
  isPlainObject,
  joinPath,
  member,
  readObject,
  readString,
} from "./strict.js";

/** What a `visibility` block is attached to (DFR-021). */
export interface VisibilityTarget {
  readonly kind: "zone" | "template" | "counter";
  /** Entity id (or the id template of a `for_each` item). */
  readonly entity: string;
  /** Whether the entity has an owner (`owner`/`team` audiences make sense). */
  readonly owned: boolean;
  /** Known role names; `undefined` skips the role-key check. */
  readonly roles?: readonly string[] | undefined;
}

export const AUDIENCES: readonly Audience[] = [
  "public",
  "hidden",
  "owner",
  "team",
];

/**
 * Compiles a `visibility` block (DFR-021): keys are `default` or a known role,
 * values are audiences. Unknown role, unknown audience, and `owner`/`team` on
 * an unowned entity are `INVALID_VISIBILITY` naming the entity. A non-mapping
 * is `SCHEMA_TYPE`, a non-string audience `SCHEMA_TYPE`. Returns `{}` when
 * anything was reported (the caller's error count tells).
 */
export function compileVisibility(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  target: VisibilityTarget,
): VisibilityRules {
  const obj = readObject(
    c,
    raw,
    path,
    isPlainObject(raw) ? Object.keys(raw) : [],
  );
  if (obj === undefined) return {};
  const before = c.count;
  const rules: Record<string, Audience> = {};
  for (const key of Object.keys(obj)) {
    const p = joinPath(path, key);
    if (
      key !== "default" &&
      target.roles !== undefined &&
      !target.roles.includes(key)
    ) {
      c.add(
        "INVALID_VISIBILITY",
        p,
        `visibility of ${target.kind} ${target.entity} names unknown role "${key}"`,
        target.entity,
      );
    }
    const audience = readString(c, member(obj, key), p);
    if (audience === undefined) continue;
    if (!(AUDIENCES as readonly string[]).includes(audience)) {
      c.add(
        "INVALID_VISIBILITY",
        p,
        `visibility of ${target.kind} ${target.entity} has unknown audience ${JSON.stringify(audience)} (public, hidden, owner or team)`,
        target.entity,
      );
      continue;
    }
    if ((audience === "owner" || audience === "team") && !target.owned) {
      c.add(
        "INVALID_VISIBILITY",
        p,
        `audience "${audience}" needs an owner, but ${target.kind} ${target.entity} has none`,
        target.entity,
      );
      continue;
    }
    setOwn(rules, key, audience as Audience);
  }
  return c.count === before ? rules : {};
}
