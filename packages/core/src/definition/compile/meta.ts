import type { MetaSchemaDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import { readFieldMap } from "./fields.js";
import { checkId } from "./ids.js";
import {
  has,
  indexPath,
  joinPath,
  member,
  readArray,
  readObject,
  readString,
} from "./strict.js";

/** An export name is a JavaScript identifier (DFR-020, DFR-023). */
export const EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Reads a reducer/hook export name; reports `INVALID_VALUE` for a bad one. */
export function readExportName(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): string | undefined {
  const name = readString(c, raw, path);
  if (name === undefined) return undefined;
  if (!EXPORT_NAME.test(name)) {
    c.add(
      "INVALID_VALUE",
      path,
      `${JSON.stringify(name)} is not a valid export name`,
      name,
    );
    return undefined;
  }
  return name;
}

/**
 * Compiles `meta_schemas` (DFR-020): `{id, reducer, fields?}`. `id` is unique
 * and must not start with `engine.` (`RESERVED_NAME`); a missing `reducer` is
 * `MISSING_REDUCER` naming the schema; each field needs `type` and
 * `visibility` (`readFieldMap`). Returns `undefined` when anything was
 * reported.
 */
export function compileMetaSchemas(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): readonly MetaSchemaDecl[] | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const out: MetaSchemaDecl[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const obj = readObject(c, item, p, ["id", "reducer", "fields"], ["id"]);
    if (obj === undefined) return;
    const id = has(obj, "id")
      ? readString(c, member(obj, "id"), joinPath(p, "id"))
      : undefined;
    let valid = false;
    if (id !== undefined && checkId(c, id, joinPath(p, "id"), "schema id")) {
      valid = true;
      if (id.startsWith("engine.")) {
        c.add(
          "RESERVED_NAME",
          joinPath(p, "id"),
          `schema id "${id}" uses the reserved engine. namespace`,
          id,
        );
        valid = false;
      } else if (seen.has(id)) {
        c.add(
          "DUPLICATE_ID",
          joinPath(p, "id"),
          `duplicate meta schema id "${id}"`,
          id,
        );
        valid = false;
      }
      seen.add(id);
    }
    const entity = id ?? p;
    let reducerRef: string | undefined;
    if (!has(obj, "reducer")) {
      c.add(
        "MISSING_REDUCER",
        joinPath(p, "reducer"),
        `meta schema ${entity} declares no reducer`,
        id,
      );
    } else {
      reducerRef = readExportName(
        c,
        member(obj, "reducer"),
        joinPath(p, "reducer"),
      );
    }
    const fields = has(obj, "fields")
      ? readFieldMap(c, member(obj, "fields"), joinPath(p, "fields"), entity)
      : { types: {}, visibility: {} };
    if (
      valid &&
      id !== undefined &&
      reducerRef !== undefined &&
      fields !== undefined
    ) {
      out.push({
        id,
        fields: fields.types,
        reducerRef,
        fieldVisibility: fields.visibility,
      });
    }
  });
  return c.count === before ? out : undefined;
}
