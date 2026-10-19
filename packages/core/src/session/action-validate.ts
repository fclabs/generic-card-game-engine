import { encodeUtf8 } from "../util/utf8.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import {
  isCardId,
  isCounterId,
  isGrantId,
  isPlayerId,
  isSeatId,
  isTeamId,
  isZoneId,
} from "./ids.js";
import type { SeatId, TeamId, PlayerId } from "./ids.js";
import type { Action, Macro } from "./actions.js";
import type { JsonValue } from "./state.js";

/** Payload depth limit (plan-level decision): containers nested deeper than this are malformed. */
export const MAX_PAYLOAD_DEPTH = 64;
const MAX_PRINCIPAL_BYTES = 256;

type Check<T = unknown> = (value: unknown, path: string) => Result<T>;

interface FieldDef {
  readonly name: string;
  readonly optional?: true;
  readonly check: Check;
}

function bad(path: string, what: string): Result<never> {
  return err({
    code: "MALFORMED_ACTION",
    detail: `${what} at ${path}`,
    path,
  });
}

function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own string-keyed data properties of a plain object, read once, without invoking getters. */
function entriesOf(value: unknown, path: string): Result<Map<string, unknown>> {
  if (!isPlainObject(value)) return bad(path, "expected an object");
  const out = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol")
      return bad(path, "symbol keys are not allowed");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return bad(`${path}.${key}`, "accessor properties are not allowed");
    }
    out.set(key, descriptor.value);
  }
  return ok(out);
}

// ---- field checks ---------------------------------------------------------------

function idCheck<T extends string>(
  guard: (v: unknown) => v is T,
  name: string,
): Check<T> {
  return (value, path) =>
    guard(value) ? ok(value) : bad(path, `expected a valid ${name}`);
}

const cardIdC = idCheck(isCardId, "CardId");
const zoneIdC = idCheck(isZoneId, "ZoneId");
const seatIdC = idCheck(isSeatId, "SeatId");
const counterIdC = idCheck(isCounterId, "CounterId");
const grantIdC = idCheck(isGrantId, "GrantId");
const playerIdC = idCheck(isPlayerId, "PlayerId");
const teamIdC = idCheck(isTeamId, "TeamId");
/** Owner of a template zone: a seat, team or player id (all share the id charset). */
const ownerIdC: Check<SeatId | TeamId | PlayerId> = (value, path) =>
  isSeatId(value) ? ok(value) : bad(path, "expected a valid owner id");

function isIntegerNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0)
  );
}

function intCheck(min: number): Check<number> {
  return (value, path) =>
    isIntegerNumber(value) && value >= min
      ? ok(value)
      : bad(path, `expected an integer >= ${String(min)}`);
}

const bigintC: Check<bigint> = (value, path) =>
  typeof value === "bigint" ? ok(value) : bad(path, "expected a bigint");

const stringC =
  (nonEmpty: boolean): Check<string> =>
  (value, path) => {
    if (typeof value !== "string") return bad(path, "expected a string");
    if (nonEmpty && value === "")
      return bad(path, "expected a non-empty string");
    if (!wellFormed(value)) return bad(path, "string has a lone surrogate");
    return ok(value);
  };
const anyString = stringC(false);
const nonEmptyString = stringC(true);

function enumCheck<T extends string | number>(allowed: readonly T[]): Check<T> {
  return (value, path) => {
    const hit = allowed.find((candidate) => candidate === value);
    return hit !== undefined
      ? ok(hit)
      : bad(path, `expected one of ${allowed.map(String).join(", ")}`);
  };
}

function arrayCheck<T>(item: Check<T>): Check<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return bad(path, "expected an array");
    const out: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const r = item(value[i], `${path}[${String(i)}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  };
}

/** Principal of a delegation: non-empty, at most 256 UTF-8 bytes, no lone surrogates (KFR-041). */
const principalC: Check<string> = (value, path) => {
  if (typeof value !== "string" || value === "") {
    return bad(path, "expected a non-empty string");
  }
  const bytes = encodeUtf8(value);
  if (!bytes.ok) return bad(path, "string has a lone surrogate");
  if (bytes.value.length > MAX_PRINCIPAL_BYTES) {
    return bad(path, `principal exceeds ${String(MAX_PRINCIPAL_BYTES)} bytes`);
  }
  return ok(value);
};

function cloneJson(
  value: unknown,
  path: string,
  depth: number,
): Result<JsonValue> {
  if (value === null || typeof value === "boolean") return ok(value);
  if (typeof value === "string") {
    return wellFormed(value)
      ? ok(value)
      : bad(path, "string has a lone surrogate");
  }
  if (typeof value === "number") {
    return isIntegerNumber(value)
      ? ok(value)
      : bad(path, "numbers must be safe integers (no floats, NaN or -0)");
  }
  if (typeof value !== "object") return bad(path, "not a JSON value");
  if (depth > MAX_PAYLOAD_DEPTH) {
    return bad(path, `payload deeper than ${String(MAX_PAYLOAD_DEPTH)} levels`);
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (let i = 0; i < value.length; i++) {
      const r = cloneJson(value[i], `${path}[${String(i)}]`, depth + 1);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  }
  const map = entriesOf(value, path);
  if (!map.ok) return map;
  const pairs: [string, JsonValue][] = [];
  for (const [key, item] of map.value) {
    if (!wellFormed(key)) return bad(path, "key has a lone surrogate");
    const r = cloneJson(item, `${path}.${key}`, depth + 1);
    if (!r.ok) return r;
    pairs.push([key, r.value]);
  }
  return ok(Object.fromEntries(pairs) as JsonValue);
}

/** Any canonical-JSON value (depth counted from this value = 1). */
const jsonC: Check<JsonValue> = (value, path) => cloneJson(value, path, 1);

/** A plain object whose values are canonical JSON, each counted from depth 1. */
const jsonRecordC: Check<{ readonly [name: string]: JsonValue }> = (
  value,
  path,
) => {
  const map = entriesOf(value, path);
  if (!map.ok) return map;
  const pairs: [string, JsonValue][] = [];
  for (const [key, item] of map.value) {
    if (!wellFormed(key)) return bad(path, "key has a lone surrogate");
    const r = cloneJson(item, `${path}.${key}`, 1);
    if (!r.ok) return r;
    pairs.push([key, r.value]);
  }
  return ok(Object.fromEntries(pairs));
};

function checkFields(
  value: unknown,
  path: string,
  fields: readonly FieldDef[],
  known: readonly string[],
): Result<[string, unknown][]> {
  const map = entriesOf(value, path);
  if (!map.ok) return map;
  const out: [string, unknown][] = [];
  for (const field of fields) {
    const fieldPath = `${path}.${field.name}`;
    if (!map.value.has(field.name)) {
      if (field.optional !== true) return bad(fieldPath, "missing field");
      continue;
    }
    const r = field.check(map.value.get(field.name), fieldPath);
    if (!r.ok) return r;
    out.push([field.name, r.value]);
  }
  for (const key of map.value.keys()) {
    if (!known.includes(key) && !fields.some((f) => f.name === key)) {
      return bad(`${path}.${key}`, "unexpected field");
    }
  }
  return ok(out);
}

const objectC =
  (fields: readonly FieldDef[]): Check =>
  (value, path) => {
    const r = checkFields(value, path, fields, []);
    return r.ok ? ok(Object.fromEntries(r.value)) : r;
  };

const req = (name: string, check: Check): FieldDef => ({ name, check });
const opt = (name: string, check: Check): FieldDef => ({
  name,
  optional: true,
  check,
});

const ratioC: Check = objectC([
  req("num", bigintC),
  req("den", (value, path) =>
    typeof value === "bigint" && value > 0n
      ? ok(value)
      : bad(path, "expected a bigint > 0"),
  ),
]);

const ROSTER_STATUS = enumCheck([
  "seated",
  "sitting_out",
  "eliminated",
] as const);

/** Fields per kind (roster: per op, keyed `roster:<op>`). `kind` itself is always allowed. */
const FIELDS: Readonly<Record<string, readonly FieldDef[]>> = {
  move: [
    req("card_id", cardIdC),
    req("from_zone", zoneIdC),
    req("to_zone", zoneIdC),
    opt("to_position", intCheck(0)),
  ],
  flip: [
    req("card_id", cardIdC),
    req("orientation", enumCheck(["face_up", "face_down"] as const)),
  ],
  shuffle: [req("zone", zoneIdC), req("permutation", arrayCheck(cardIdC))],
  set_metadata: [req("card_id", cardIdC), req("fields", jsonRecordC)],
  lifecycle: [
    req("to_state", enumCheck(["active", "completed", "terminated"] as const)),
    opt("outcome", jsonC),
  ],
  counter_adjust: [
    req("counter_id", counterIdC),
    req("delta", bigintC),
    opt("ratio", ratioC),
  ],
  counter_transfer: [
    req("from_counter", counterIdC),
    req("to_counter", counterIdC),
    req("amount", bigintC),
    opt("ratio", ratioC),
    opt("remainder_to", counterIdC),
  ],
  control_set: [
    opt("phase", anyString),
    opt("active_seats", arrayCheck(seatIdC)),
    opt("direction", enumCheck([1, -1] as const)),
    opt(
      "pointer",
      objectC([req("name", nonEmptyString), req("seat", seatIdC)]),
    ),
  ],
  control_advance: [
    req("steps", intCheck(1)),
    opt("pointer", nonEmptyString),
    opt("mode", enumCheck(["until_quiescent"] as const)),
  ],
  grant_view: [
    req("target", jsonC),
    req("keys", arrayCheck(anyString)),
    req("grantee", nonEmptyString),
    req("scope", jsonC),
    opt("grant_id", grantIdC),
  ],
  revoke_view: [req("grant_id", grantIdC)],
  zone_create: [
    req("template", nonEmptyString),
    opt("owner", ownerIdC),
    opt("zone_id", zoneIdC),
  ],
  zone_destroy: [req("zone_id", zoneIdC)],
  "roster:join": [
    req("player_id", playerIdC),
    opt("seat_id", seatIdC),
    opt("team_id", teamIdC),
    opt("zones_to_create", arrayCheck(nonEmptyString)),
  ],
  "roster:leave": [req("player_id", playerIdC), opt("seat_id", seatIdC)],
  "roster:substitute": [
    req("player_id", playerIdC),
    opt("seat_id", seatIdC),
    opt("team_id", teamIdC),
  ],
  "roster:set_status": [req("seat_id", seatIdC), req("status", ROSTER_STATUS)],
  "roster:delegate": [
    req("seat_id", seatIdC),
    req("grantee_principal", principalC),
    opt("scope", jsonC),
    opt("boundary", anyString),
  ],
  "roster:revoke_delegation": [
    req("seat_id", seatIdC),
    req("grantee_principal", principalC),
  ],
  meta: [req("schema_id", nonEmptyString), req("payload", jsonC)],
  draw: [
    req("from_zone", zoneIdC),
    req("count", intCheck(0)),
    req("to_zone", zoneIdC),
    opt("to_position", intCheck(0)),
  ],
  zone_merge: [req("src_zone", zoneIdC), req("dst_zone", zoneIdC)],
  reset_to_zone: [req("zones", arrayCheck(zoneIdC)), req("to_zone", zoneIdC)],
};

const ROSTER_OPS = [
  "join",
  "leave",
  "substitute",
  "set_status",
  "delegate",
  "revoke_delegation",
] as const;

/**
 * Shape validation of one untrusted action or macro (KFR-028). On success returns a
 * fresh, normalised copy that shares nothing with `raw` (known fields only; JSON payloads
 * cloned). Failure is `MALFORMED_ACTION` with `path` (`$` is the action; `$.field` a field;
 * `apply` passes `$[i]`) and the path repeated in `detail`. Pure; never throws for any input
 * short of a throwing Proxy.
 */
export function validateAction(
  raw: unknown,
  path = "$",
): Result<Action | Macro> {
  const map = entriesOf(raw, path);
  if (!map.ok) return map;
  const kind = map.value.get("kind");
  if (typeof kind !== "string")
    return bad(`${path}.kind`, "missing or non-string kind");
  let tableKey = kind;
  const extraKnown: string[] = ["kind"];
  if (kind === "roster") {
    const opR = enumCheck(ROSTER_OPS)(map.value.get("op"), `${path}.op`);
    if (!opR.ok) return opR;
    tableKey = `roster:${opR.value}`;
    extraKnown.push("op");
  }
  const fields = Object.hasOwn(FIELDS, tableKey) ? FIELDS[tableKey] : undefined;
  if (fields === undefined)
    return bad(`${path}.kind`, `unknown action kind: ${kind}`);
  const checked = checkFields(raw, path, fields, extraKnown);
  if (!checked.ok) return checked;
  const head: [string, unknown][] = [["kind", kind]];
  if (kind === "roster") head.push(["op", map.value.get("op")]);
  // The table above is the single source of truth for each kind's shape; this is the one cast.
  return ok(
    Object.fromEntries([...head, ...checked.value]) as unknown as
      Action | Macro,
  );
}
