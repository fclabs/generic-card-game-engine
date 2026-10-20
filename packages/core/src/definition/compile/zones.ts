import type { SeatId, TeamId, ZoneId } from "../../session/ids.js";
import type {
  OwnerRule,
  VisibilityRules,
  ZoneDecl,
  ZoneTemplateDecl,
} from "../types.js";
import type { ErrorCollector } from "./errors.js";
import type { ForEachKind, ForEachScope } from "./foreach.js";
import { expandForEach, FOR_EACH_KINDS } from "./foreach.js";
import { checkId } from "./ids.js";
import {
  MAX_TEMPLATE_INSTANCES,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_ZONES,
} from "./limits.js";
import {
  has,
  indexPath,
  isPlainObject,
  joinPath,
  member,
  readArray,
  readEnum,
  readIntegerInRange,
  readObject,
  readString,
} from "./strict.js";
import { compileVisibility } from "./visibility.js";

export interface CompiledZones {
  readonly zones: readonly ZoneDecl[];
  readonly zoneTemplates: readonly ZoneTemplateDecl[];
}

const ORDERINGS = ["ordered", "unordered"] as const;
const OWNER_RULES: readonly OwnerRule[] = ["seat", "team", "player", "none"];

interface Namespaces {
  readonly fixed: Set<string>;
  readonly templates: Set<string>;
}

/**
 * Compiles `zones` (DFR-013, DFR-018): fixed zones (with optional `for_each`)
 * and templates, in declaration order. Returns `undefined` when anything was
 * reported.
 */
export function compileZones(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  scope: ForEachScope,
): CompiledZones | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const zones: ZoneDecl[] = [];
  const zoneTemplates: ZoneTemplateDecl[] = [];
  const names: Namespaces = { fixed: new Set(), templates: new Set() };
  let limitReported = false;
  items.forEach((item, i) => {
    const p = indexPath(path, i);
    if (isPlainObject(item) && has(item, "template")) {
      const t = compileTemplate(c, item, p, names, scope);
      if (t !== undefined) zoneTemplates.push(t);
    } else {
      zones.push(...compileFixedZone(c, item, p, scope, names));
    }
    if (zones.length > MAX_ZONES && !limitReported) {
      limitReported = true;
      c.add(
        "LIMIT_EXCEEDED",
        path,
        `at most ${MAX_ZONES} zones are allowed after expansion, got ${zones.length}`,
      );
    }
  });
  return c.count === before ? { zones, zoneTemplates } : undefined;
}

function compileFixedZone(
  c: ErrorCollector,
  item: unknown,
  p: string,
  scope: ForEachScope,
  names: Namespaces,
): ZoneDecl[] {
  const obj = readObject(
    c,
    item,
    p,
    ["id", "ordering", "owner_id", "for_each", "visibility"],
    ["id", "ordering"],
  );
  if (obj === undefined) return [];
  const idTemplate = has(obj, "id")
    ? readString(c, member(obj, "id"), joinPath(p, "id"))
    : undefined;
  const ordering = has(obj, "ordering")
    ? readEnum(c, member(obj, "ordering"), joinPath(p, "ordering"), ORDERINGS)
    : undefined;
  const ownerTemplate = has(obj, "owner_id")
    ? readString(c, member(obj, "owner_id"), joinPath(p, "owner_id"))
    : undefined;
  const kind = readForEach(c, obj, p);
  const rules = has(obj, "visibility")
    ? compileVisibility(
        c,
        member(obj, "visibility"),
        joinPath(p, "visibility"),
        {
          kind: "zone",
          entity: idTemplate ?? "",
          owned: has(obj, "owner_id"),
          roles: scope.roles,
        },
      )
    : {};
  if (
    idTemplate === undefined ||
    ordering === undefined ||
    kind === null ||
    (has(obj, "owner_id") && ownerTemplate === undefined)
  ) {
    return [];
  }
  const fields: Record<string, string> = { id: idTemplate };
  if (ownerTemplate !== undefined) fields["owner_id"] = ownerTemplate;
  const instances = expandForEach(c, scope, kind, p, fields, idTemplate);
  if (instances === undefined) return [];
  const out: ZoneDecl[] = [];
  for (const instance of instances) {
    const id = instance["id"];
    if (id === undefined) return [];
    const idPath = joinPath(p, "id");
    if (!checkId(c, id, idPath, "zone id")) return [];
    if (names.fixed.has(id) || names.templates.has(id)) {
      c.add("DUPLICATE_ID", idPath, `duplicate zone id "${id}"`, id);
      return [];
    }
    const owner = instance["owner_id"];
    if (owner !== undefined) {
      const ownerPath = joinPath(p, "owner_id");
      if (!scope.seats.includes(owner) && !scope.teams.includes(owner)) {
        c.add(
          "UNKNOWN_REFERENCE",
          ownerPath,
          `owner_id "${owner}" is not a declared seat or team`,
          id,
        );
        return [];
      }
    }
    names.fixed.add(id);
    out.push(zoneDecl(id, ordering === "ordered", owner, rules));
  }
  return out;
}

function zoneDecl(
  id: string,
  ordered: boolean,
  owner: string | undefined,
  visibility: VisibilityRules,
): ZoneDecl {
  return {
    id: id as ZoneId,
    ordered,
    ...(owner !== undefined ? { owner: owner as SeatId | TeamId } : {}),
    visibility,
  };
}

/** `for_each` of an item: `undefined` when absent, `null` after a reported error. */
export function readForEach(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  p: string,
): ForEachKind | undefined | null {
  if (!has(obj, "for_each")) return undefined;
  return (
    readEnum(
      c,
      member(obj, "for_each"),
      joinPath(p, "for_each"),
      FOR_EACH_KINDS,
    ) ?? null
  );
}

function compileTemplate(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  p: string,
  names: Namespaces,
  scope: ForEachScope,
): ZoneTemplateDecl | undefined {
  const entry = readObject(
    c,
    obj,
    p,
    ["template", "owner", "ordering", "max_instances", "visibility"],
    ["template", "owner", "ordering", "max_instances"],
  );
  if (entry === undefined) return undefined;
  const before = c.count;
  const namePath = joinPath(p, "template");
  let name = readString(c, member(entry, "template"), namePath);
  if (name !== undefined) {
    if (name.includes("/")) {
      c.add(
        "INVALID_VALUE",
        namePath,
        'template name must not contain "/"',
        name,
      );
      name = undefined;
    } else if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
      c.add(
        "INVALID_VALUE",
        namePath,
        `template name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`,
        name,
      );
      name = undefined;
    } else if (!checkId(c, name, namePath, "template name")) name = undefined;
    else if (names.templates.has(name) || names.fixed.has(name)) {
      c.add("DUPLICATE_ID", namePath, `duplicate zone name "${name}"`, name);
      name = undefined;
    } else names.templates.add(name);
  }
  const owner = has(entry, "owner")
    ? readEnum(c, member(entry, "owner"), joinPath(p, "owner"), OWNER_RULES)
    : undefined;
  const ordering = has(entry, "ordering")
    ? readEnum(c, member(entry, "ordering"), joinPath(p, "ordering"), ORDERINGS)
    : undefined;
  const max = has(entry, "max_instances")
    ? readIntegerInRange(
        c,
        member(entry, "max_instances"),
        joinPath(p, "max_instances"),
        1,
        MAX_TEMPLATE_INSTANCES,
      )
    : undefined;
  const visibility = has(entry, "visibility")
    ? compileVisibility(
        c,
        member(entry, "visibility"),
        joinPath(p, "visibility"),
        {
          kind: "template",
          entity: name ?? "",
          owned: owner !== undefined && owner !== "none",
          roles: scope.roles,
        },
      )
    : {};
  if (
    c.count !== before ||
    name === undefined ||
    owner === undefined ||
    ordering === undefined ||
    max === undefined
  ) {
    return undefined;
  }
  return {
    name,
    ownerRule: owner,
    ordered: ordering === "ordered",
    maxInstances: max,
    visibility,
  };
}
