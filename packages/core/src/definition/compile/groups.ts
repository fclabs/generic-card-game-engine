import type { CounterId } from "../../session/ids.js";
import type { ConservationGroupDecl, CounterDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import type { ForEachScope } from "./foreach.js";
import { expandForEach, FOR_EACH_KINDS } from "./foreach.js";
import { checkId } from "./ids.js";
import {
  has,
  indexPath,
  isPlainObject,
  joinPath,
  member,
  readArray,
  readEnum,
  readObject,
  readString,
} from "./strict.js";

export interface CompiledGroups {
  readonly conservationGroups: readonly ConservationGroupDecl[];
}

/**
 * Compiles `conservation_groups` (DFR-017): `{id, counters}` where each
 * counter is a literal id or `{expand, for_each}`. `counters` is the compiled
 * counter list used to resolve references (`undefined` skips that check when
 * the counters section failed). Returns `undefined` when anything was
 * reported.
 */
export function compileConservationGroups(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  scope: ForEachScope,
  counters: readonly CounterDecl[] | undefined,
): CompiledGroups | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const stored = new Set<string>();
  const derived = new Set<string>();
  for (const k of counters ?? []) {
    (k.derivedSpec !== undefined || k.derived !== undefined
      ? derived
      : stored
    ).add(k.id);
  }
  const groups: ConservationGroupDecl[] = [];
  const groupIds = new Set<string>();
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    const obj = readObject(c, item, p, ["id", "counters"], ["id", "counters"]);
    if (obj === undefined) return;
    let id: string | undefined;
    if (has(obj, "id")) {
      id = readString(c, member(obj, "id"), joinPath(p, "id"));
      if (id !== undefined) {
        if (!checkId(c, id, joinPath(p, "id"), "conservation group id"))
          id = undefined;
        else if (groupIds.has(id)) {
          c.add(
            "DUPLICATE_ID",
            joinPath(p, "id"),
            `duplicate conservation group id "${id}"`,
            id,
          );
          id = undefined;
        } else groupIds.add(id);
      }
    }
    if (!has(obj, "counters")) return;
    const list = compileMembers(
      c,
      member(obj, "counters"),
      joinPath(p, "counters"),
      scope,
      counters === undefined ? undefined : { stored, derived },
      id ?? "",
    );
    if (id !== undefined && list !== undefined) {
      groups.push({ id, counters: list });
    }
  });
  return c.count === before ? { conservationGroups: groups } : undefined;
}

function compileMembers(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  scope: ForEachScope,
  known:
    { stored: ReadonlySet<string>; derived: ReadonlySet<string> } | undefined,
  group: string,
): readonly CounterId[] | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const out: CounterId[] = [];
  const seen = new Set<string>();
  const add = (id: string, p: string): void => {
    if (known !== undefined && !known.stored.has(id)) {
      c.add(
        "UNKNOWN_REFERENCE",
        p,
        known.derived.has(id)
          ? `conservation group "${group}" names derived counter "${id}"`
          : `conservation group "${group}" names unknown counter "${id}"`,
        id,
      );
      return;
    }
    if (seen.has(id)) {
      c.add(
        "DUPLICATE_ID",
        p,
        `counter "${id}" appears twice in group "${group}"`,
        id,
      );
      return;
    }
    seen.add(id);
    out.push(id as CounterId);
  };
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    if (typeof item === "string") {
      add(item, p);
      return;
    }
    if (!isPlainObject(item)) {
      c.add("SCHEMA_TYPE", p, "expected a counter id or {expand, for_each}");
      return;
    }
    const obj = readObject(
      c,
      item,
      p,
      ["expand", "for_each"],
      ["expand", "for_each"],
    );
    if (obj === undefined) return;
    const pattern = has(obj, "expand")
      ? readString(c, member(obj, "expand"), joinPath(p, "expand"))
      : undefined;
    const kind = has(obj, "for_each")
      ? readEnum(
          c,
          member(obj, "for_each"),
          joinPath(p, "for_each"),
          FOR_EACH_KINDS,
        )
      : undefined;
    if (pattern === undefined || kind === undefined) return;
    const instances = expandForEach(
      c,
      scope,
      kind,
      p,
      { expand: pattern },
      pattern,
    );
    if (instances === undefined) return;
    for (const instance of instances) {
      const id = instance["expand"];
      if (id !== undefined) add(id, joinPath(p, "expand"));
    }
  });
  return c.count === before ? out : undefined;
}
