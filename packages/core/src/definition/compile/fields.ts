import { setOwn } from "../../session/records.js";
import type { FieldType, FieldVisibility } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import {
  has,
  isPlainObject,
  joinPath,
  member,
  readEnum,
  readObject,
  readString,
} from "./strict.js";

export const FIELD_TYPES: readonly FieldType[] = [
  "string",
  "int",
  "bool",
  "json",
];
export const FIELD_VISIBILITIES: readonly FieldVisibility[] = [
  "public",
  "subject",
  "secret",
];

export interface FieldMap {
  /** Field -> type (`metadataSchema` / `fields`). */
  readonly types: Record<string, FieldType>;
  /** Field -> visibility (`metadataVisibility` / `fieldVisibility`). */
  readonly visibility: Record<string, FieldVisibility>;
}

/**
 * Reads a `{field: {type, visibility}}` mapping (DFR-014, DFR-020). A missing
 * or unknown `visibility` is `INVALID_VISIBILITY` at the field's `visibility`
 * path naming `entity`. Returns `undefined` when anything was reported.
 * Reused by iteration 4 for `meta_schemas[].fields`.
 */
export function readFieldMap(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  entity: string,
): FieldMap | undefined {
  const before = c.count;
  // Field names are free-form: every key of the mapping is allowed.
  const obj = readObject(
    c,
    raw,
    path,
    isPlainObject(raw) ? Object.keys(raw) : [],
  );
  if (obj === undefined) return undefined;
  const types: Record<string, FieldType> = {};
  const visibility: Record<string, FieldVisibility> = {};
  for (const name of Object.keys(obj)) {
    const p = joinPath(path, name);
    const spec = readObject(
      c,
      member(obj, name),
      p,
      ["type", "visibility"],
      ["type"],
    );
    if (spec === undefined) continue;
    if (has(spec, "type")) {
      const t = readEnum(
        c,
        member(spec, "type"),
        joinPath(p, "type"),
        FIELD_TYPES,
      );
      if (t !== undefined) setOwn(types, name, t);
    }
    const vp = joinPath(p, "visibility");
    if (!has(spec, "visibility")) {
      c.add(
        "INVALID_VISIBILITY",
        vp,
        `field "${name}" of ${entity} declares no visibility (public, subject or secret)`,
        entity,
      );
      continue;
    }
    const v = readString(c, member(spec, "visibility"), vp);
    if (v === undefined) continue;
    if (!(FIELD_VISIBILITIES as readonly string[]).includes(v)) {
      c.add(
        "INVALID_VISIBILITY",
        vp,
        `field "${name}" of ${entity} has unknown visibility ${JSON.stringify(v)} (public, subject or secret)`,
        entity,
      );
      continue;
    }
    setOwn(visibility, name, v as FieldVisibility);
  }
  return c.count === before ? { types, visibility } : undefined;
}
