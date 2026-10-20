import type { CounterId, ZoneId } from "../../session/ids.js";
import type {
  CounterDecl,
  CounterOwner,
  RoundingMode,
  SupplyRole,
} from "../types.js";
import { readBigInt } from "./bigint.js";
import type { ErrorCollector } from "./errors.js";
import type { ForEachScope } from "./foreach.js";
import { expandForEach } from "./foreach.js";
import { checkId } from "./ids.js";
import { MAX_COUNTERS } from "./limits.js";
import {
  has,
  indexPath,
  joinPath,
  member,
  readArray,
  readEnum,
  readIntegerInRange,
  readObject,
  readString,
} from "./strict.js";
import { zoneSizeEvaluator } from "./derived.js";
import { readForEach } from "./zones.js";
import { compileVisibility } from "./visibility.js";

export interface CompiledCounters {
  readonly counters: readonly CounterDecl[];
}

/** Entity ids an `owner_id` may name; `undefined` skips that check. */
export interface OwnerRefs {
  readonly zones: ReadonlySet<string> | undefined;
  readonly cards: ReadonlySet<string> | undefined;
}

const OWNERS: readonly CounterOwner[] = [
  "table",
  "player",
  "team",
  "zone",
  "card",
];
const ROUNDINGS: readonly RoundingMode[] = ["floor", "half_up", "half_even"];
const SUPPLY_ROLES: readonly SupplyRole[] = ["mint", "burn"];
const KEYS = [
  "id",
  "owner",
  "owner_id",
  "min",
  "max",
  "initial",
  "scale",
  "rounding",
  "supply_role",
  "derived",
  "visibility",
  "for_each",
];
/** Keys a derived counter must not declare (DFR-016). */
const DERIVED_FORBIDDEN = ["min", "max", "initial", "supply_role"];

/**
 * Compiles `counters` (DFR-015, DFR-016, DFR-018) in declaration order, with
 * `for_each` instances in seat/team order. Returns `undefined` when anything
 * was reported.
 */
export function compileCounters(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  scope: ForEachScope,
  refs: OwnerRefs,
): CompiledCounters | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const counters: CounterDecl[] = [];
  const ids = new Set<string>();
  let limitReported = false;
  items.forEach((item, i) => {
    counters.push(
      ...compileCounter(c, item, indexPath(path, i), scope, refs, ids),
    );
    if (counters.length > MAX_COUNTERS && !limitReported) {
      limitReported = true;
      c.add(
        "LIMIT_EXCEEDED",
        path,
        `at most ${MAX_COUNTERS} counters are allowed after expansion, got ${counters.length}`,
      );
    }
  });
  return c.count === before ? { counters } : undefined;
}

function compileCounter(
  c: ErrorCollector,
  item: unknown,
  p: string,
  scope: ForEachScope,
  refs: OwnerRefs,
  ids: Set<string>,
): CounterDecl[] {
  const before = c.count;
  const probe = readObject(c, item, p, KEYS);
  if (probe === undefined) return [];
  const isDerived = has(probe, "derived");
  const required = isDerived ? ["id"] : ["id", "owner", "min", "initial"];
  for (const key of required) {
    if (!has(probe, key)) {
      c.add(
        "SCHEMA_MISSING",
        joinPath(p, key),
        `missing required key "${key}"`,
      );
    }
  }
  const idTemplate = has(probe, "id")
    ? readString(c, member(probe, "id"), joinPath(p, "id"))
    : undefined;
  const entity = idTemplate ?? "";
  const kind = readForEach(c, probe, p);

  let owner: CounterOwner | undefined = isDerived ? "table" : undefined;
  if (has(probe, "owner")) {
    owner = readEnum(c, member(probe, "owner"), joinPath(p, "owner"), OWNERS);
  }
  const ownerTemplate = readOwnerId(c, probe, p, owner, entity);

  let derivedZone: string | undefined;
  let min: bigint | undefined;
  let max: bigint | undefined;
  let initial: bigint | undefined;
  let supplyRole: SupplyRole | undefined;
  if (isDerived) {
    derivedZone = readDerived(
      c,
      member(probe, "derived"),
      joinPath(p, "derived"),
      refs,
      entity,
    );
    for (const key of DERIVED_FORBIDDEN) {
      if (has(probe, key)) {
        c.add(
          "INVALID_VALUE",
          joinPath(p, key),
          `a derived counter must not declare ${key}`,
          entity,
        );
      }
    }
  } else {
    if (has(probe, "min"))
      min = readBigInt(c, member(probe, "min"), joinPath(p, "min"), entity);
    if (has(probe, "max"))
      max = readBigInt(c, member(probe, "max"), joinPath(p, "max"), entity);
    if (has(probe, "initial")) {
      initial = readBigInt(
        c,
        member(probe, "initial"),
        joinPath(p, "initial"),
        entity,
      );
    }
    if (min !== undefined && max !== undefined && max < min) {
      c.add(
        "INVALID_VALUE",
        joinPath(p, "max"),
        `max ${max} is below min ${min}`,
        entity,
      );
    }
    if (initial !== undefined && min !== undefined && initial < min) {
      c.add(
        "INVALID_VALUE",
        joinPath(p, "initial"),
        `initial ${initial} is below min ${min}`,
        entity,
      );
    } else if (initial !== undefined && max !== undefined && initial > max) {
      c.add(
        "INVALID_VALUE",
        joinPath(p, "initial"),
        `initial ${initial} is above max ${max}`,
        entity,
      );
    }
    if (has(probe, "supply_role")) {
      supplyRole = readEnum(
        c,
        member(probe, "supply_role"),
        joinPath(p, "supply_role"),
        SUPPLY_ROLES,
      );
    }
  }
  const scale = has(probe, "scale")
    ? readIntegerInRange(c, member(probe, "scale"), joinPath(p, "scale"), 0, 18)
    : undefined;
  const rounding = has(probe, "rounding")
    ? readEnum(c, member(probe, "rounding"), joinPath(p, "rounding"), ROUNDINGS)
    : undefined;
  const rules = has(probe, "visibility")
    ? compileVisibility(
        c,
        member(probe, "visibility"),
        joinPath(p, "visibility"),
        {
          kind: "counter",
          entity,
          owned: owner !== undefined && owner !== "table",
        },
      )
    : {};
  if (
    c.count !== before ||
    idTemplate === undefined ||
    kind === null ||
    owner === undefined ||
    (!isDerived && (min === undefined || initial === undefined))
  ) {
    return [];
  }
  const fields: Record<string, string> = { id: idTemplate };
  if (ownerTemplate !== undefined) fields["owner_id"] = ownerTemplate;
  const instances = expandForEach(c, scope, kind, p, fields, idTemplate);
  if (instances === undefined) return [];
  const out: CounterDecl[] = [];
  for (const instance of instances) {
    const id = instance["id"];
    if (id === undefined) return [];
    const idPath = joinPath(p, "id");
    if (!checkId(c, id, idPath, "counter id")) return [];
    if (ids.has(id)) {
      c.add("DUPLICATE_ID", idPath, `duplicate counter id "${id}"`, id);
      return [];
    }
    const ownerId = instance["owner_id"];
    if (
      ownerId !== undefined &&
      !ownerExists(c, owner, ownerId, scope, refs, joinPath(p, "owner_id"), id)
    ) {
      return [];
    }
    ids.add(id);
    out.push({
      id: id as CounterId,
      owner,
      ...(ownerId !== undefined ? { ownerId } : {}),
      visibility: rules,
      min: min ?? 0n,
      ...(max !== undefined ? { max } : {}),
      initial: initial ?? 0n,
      ...(scale !== undefined ? { scale } : {}),
      ...(rounding !== undefined ? { rounding } : {}),
      ...(supplyRole !== undefined ? { supplyRole } : {}),
      ...(derivedZone !== undefined
        ? {
            derived: zoneSizeEvaluator(derivedZone),
            derivedSpec: {
              kind: "zone_size" as const,
              zone: derivedZone as ZoneId,
            },
          }
        : {}),
    });
  }
  return out;
}

/** `owner_id` template: forbidden for `table`, required otherwise. */
function readOwnerId(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  p: string,
  owner: CounterOwner | undefined,
  entity: string,
): string | undefined {
  const path = joinPath(p, "owner_id");
  if (owner === undefined) {
    return has(obj, "owner_id")
      ? readString(c, member(obj, "owner_id"), path)
      : undefined;
  }
  if (owner === "table") {
    if (has(obj, "owner_id")) {
      c.add(
        "INVALID_VALUE",
        path,
        "owner_id is forbidden for a table counter",
        entity,
      );
    }
    return undefined;
  }
  if (!has(obj, "owner_id")) {
    c.add(
      "SCHEMA_MISSING",
      path,
      `owner_id is required for a ${owner} counter`,
      entity,
    );
    return undefined;
  }
  return readString(c, member(obj, "owner_id"), path);
}

function ownerExists(
  c: ErrorCollector,
  owner: CounterOwner,
  ownerId: string,
  scope: ForEachScope,
  refs: OwnerRefs,
  path: string,
  entity: string,
): boolean {
  let known: boolean;
  let what: string;
  switch (owner) {
    case "player":
      known = scope.seats.includes(ownerId);
      what = "seat";
      break;
    case "team":
      known = scope.teams.includes(ownerId);
      what = "team";
      break;
    case "zone":
      known = refs.zones === undefined || refs.zones.has(ownerId);
      what = "fixed zone";
      break;
    case "card":
      known = refs.cards === undefined || refs.cards.has(ownerId);
      what = "card";
      break;
    default:
      return true;
  }
  if (!known) {
    c.add(
      "UNKNOWN_REFERENCE",
      path,
      `owner_id "${ownerId}" is not a declared ${what}`,
      entity,
    );
  }
  return known;
}

/** Reads `derived: {zone_size: <zone>}` (DFR-016); returns the zone id. */
function readDerived(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  refs: OwnerRefs,
  entity: string,
): string | undefined {
  const before = c.count;
  const obj = readObject(c, raw, path, ["zone_size"]);
  if (obj === undefined) return undefined;
  const zonePath = joinPath(path, "zone_size");
  if (!has(obj, "zone_size")) {
    if (c.count === before) {
      c.add(
        "SCHEMA_MISSING",
        zonePath,
        'missing required key "zone_size"',
        entity,
      );
    }
    return undefined;
  }
  const zone = readString(c, member(obj, "zone_size"), zonePath);
  if (zone === undefined) return undefined;
  if (refs.zones !== undefined && !refs.zones.has(zone)) {
    c.add(
      "UNKNOWN_REFERENCE",
      zonePath,
      `zone_size names "${zone}", which is not a declared fixed zone`,
      entity,
    );
    return undefined;
  }
  return c.count === before ? zone : undefined;
}
