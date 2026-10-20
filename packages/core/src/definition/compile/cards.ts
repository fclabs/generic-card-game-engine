import type { CardId, ZoneId } from "../../session/ids.js";
import { setOwn } from "../../session/records.js";
import type { JsonValue } from "../../session/state.js";
import type { CardDecl, FieldType, FieldVisibility } from "../types.js";
import type { Axis } from "./axes.js";
import { readAxes } from "./axes.js";
import type { ErrorCollector } from "./errors.js";
import { readFieldMap } from "./fields.js";
import { checkId } from "./ids.js";
import { validateJsonValue } from "./json-value.js";
import { MAX_CARDS } from "./limits.js";
import {
  describeType,
  has,
  indexPath,
  isPlainObject,
  joinPath,
  member,
  readArray,
  readObject,
  readString,
} from "./strict.js";
import type { Segment } from "./template.js";
import {
  hasPlaceholder,
  lonePlaceholder,
  parseTemplate,
  renderTemplate,
} from "./template.js";

export interface CompiledCards {
  /** In expanded order: this order is the initial zone order (semantic). */
  readonly cards: readonly CardDecl[];
}

interface State {
  readonly cards: CardDecl[];
  readonly ids: Set<string>;
  /** Declared fixed zone ids, or `undefined` when the zones section failed. */
  readonly zones: ReadonlySet<string> | undefined;
  limitHit: boolean;
}

const SPEC_KEYS = ["id", "type", "zone", "metadata", "metadata_schema"];

type MetaPlan =
  | { readonly kind: "lit"; readonly value: unknown }
  | { readonly kind: "lone"; readonly axis: number }
  | { readonly kind: "mixed"; readonly segments: readonly Segment[] };

/**
 * Compiles `cards` (DFR-014, DFR-026): explicit cards and generators, in
 * declaration order. A generator expands to the cartesian product of its
 * ordered `axes`, the FIRST axis varying slowest. `zones` is the set of
 * declared fixed zone ids (`undefined` skips the zone-reference check).
 * Returns `undefined` when anything was reported.
 */
export function compileCards(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  zones: ReadonlySet<string> | undefined,
): CompiledCards | undefined {
  const before = c.count;
  const items = readArray(c, raw, path);
  if (items === undefined) return undefined;
  const state: State = { cards: [], ids: new Set(), zones, limitHit: false };
  items.forEach((item, i) => {
    if (state.limitHit) return;
    compileEntry(c, item, indexPath(path, i), state);
  });
  return c.count === before ? { cards: state.cards } : undefined;
}

function compileEntry(
  c: ErrorCollector,
  item: unknown,
  p: string,
  state: State,
): void {
  if (isPlainObject(item) && has(item, "generate")) {
    const wrapper = readObject(c, item, p, ["generate"], ["generate"]);
    if (wrapper === undefined) return;
    const gp = joinPath(p, "generate");
    const obj = readObject(
      c,
      member(wrapper, "generate"),
      gp,
      ["axes", ...SPEC_KEYS],
      ["axes", "id", "zone"],
    );
    if (obj === undefined) return;
    const axes = has(obj, "axes")
      ? readAxes(c, member(obj, "axes"), joinPath(gp, "axes"))
      : undefined;
    // Placeholders cannot be checked without the axes.
    if (axes === undefined) return;
    compileSpec(c, obj, gp, axes, true, state);
    return;
  }
  const obj = readObject(c, item, p, SPEC_KEYS, ["id", "zone"]);
  if (obj === undefined) return;
  compileSpec(c, obj, p, [], false, state);
}

function compileSpec(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  base: string,
  axes: readonly Axis[],
  generator: boolean,
  state: State,
): void {
  const before = c.count;
  const names = axes.map((a) => a.name);
  const idText = has(obj, "id")
    ? readString(c, member(obj, "id"), joinPath(base, "id"))
    : undefined;
  const entity = idText ?? "";
  const template = (
    text: string | undefined,
    key: string,
  ): readonly Segment[] | undefined => {
    if (text === undefined) return undefined;
    return generator
      ? parseTemplate(c, text, names, joinPath(base, key), entity)
      : [text];
  };
  const idSegs = template(idText, "id");
  const typeText = has(obj, "type")
    ? readString(c, member(obj, "type"), joinPath(base, "type"))
    : undefined;
  const typeSegs = template(typeText, "type");
  const zoneText = has(obj, "zone")
    ? readString(c, member(obj, "zone"), joinPath(base, "zone"))
    : undefined;
  const zoneSegs = template(zoneText, "zone");

  const fieldMap = has(obj, "metadata_schema")
    ? readFieldMap(
        c,
        member(obj, "metadata_schema"),
        joinPath(base, "metadata_schema"),
        entity,
      )
    : { types: {}, visibility: {} };
  const plans = readMetadata(
    c,
    obj,
    base,
    names,
    entity,
    generator,
    fieldMap?.types,
    axes,
  );

  const product = productOf(axes);
  if (state.cards.length + product > MAX_CARDS) {
    c.add(
      "LIMIT_EXCEEDED",
      base,
      `expansion would exceed ${MAX_CARDS} cards in total (${state.cards.length} before this entry, ${product > MAX_CARDS ? `more than ${MAX_CARDS}` : product} from it)`,
      entity,
    );
    state.limitHit = true;
    return;
  }
  if (
    c.count !== before ||
    idSegs === undefined ||
    zoneSegs === undefined ||
    fieldMap === undefined ||
    plans === undefined ||
    (has(obj, "type") && typeSegs === undefined)
  ) {
    return;
  }
  expand(c, base, axes, product, state, {
    idSegs,
    typeSegs,
    zoneSegs,
    plans,
    fieldMap,
    entity,
  });
}

function productOf(axes: readonly Axis[]): number {
  let product = 1;
  for (const a of axes) {
    product *= a.length;
    if (product > MAX_CARDS) return product;
  }
  return product;
}

/**
 * Reads `metadata`, classifies each value (literal, lone placeholder, mixed
 * template) and type-checks it once against `metadata_schema` (not per card).
 */
function readMetadata(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  base: string,
  axisNames: readonly string[],
  entity: string,
  generator: boolean,
  types: Readonly<Record<string, FieldType>> | undefined,
  axes: readonly Axis[],
): Readonly<Record<string, MetaPlan>> | undefined {
  if (!has(obj, "metadata")) return {};
  const mp = joinPath(base, "metadata");
  const raw = member(obj, "metadata");
  const meta = readObject(
    c,
    raw,
    mp,
    isPlainObject(raw) ? Object.keys(raw) : [],
  );
  if (meta === undefined) return undefined;
  const before = c.count;
  const plans: Record<string, MetaPlan> = {};
  for (const field of Object.keys(meta)) {
    const fp = joinPath(mp, field);
    const value = member(meta, field);
    let plan: MetaPlan = { kind: "lit", value };
    if (generator && typeof value === "string") {
      const segs = parseTemplate(c, value, axisNames, fp, entity);
      if (segs === undefined) continue;
      const lone = lonePlaceholder(segs);
      if (lone !== undefined) plan = { kind: "lone", axis: lone };
      else if (hasPlaceholder(segs)) plan = { kind: "mixed", segments: segs };
      else plan = { kind: "lit", value: renderTemplate(segs, []) };
    }
    if (types !== undefined) {
      const type = Object.hasOwn(types, field) ? types[field] : undefined;
      if (type === undefined) {
        c.add(
          "INVALID_VALUE",
          fp,
          `metadata field "${field}" is not declared in metadata_schema`,
          entity,
        );
        continue;
      }
      checkPlan(c, plan, type, fp, entity, axes);
    }
    setOwn(plans, field, plan);
  }
  return c.count === before ? plans : undefined;
}

function checkPlan(
  c: ErrorCollector,
  plan: MetaPlan,
  type: FieldType,
  path: string,
  entity: string,
  axes: readonly Axis[],
): void {
  if (plan.kind === "lit") {
    checkLiteral(c, plan.value, type, path, entity);
    return;
  }
  const wantsString = type === "string" || type === "json";
  if (plan.kind === "mixed") {
    if (!wantsString) {
      c.add(
        "SCHEMA_TYPE",
        path,
        `a template string yields a string, but the field is declared ${type}`,
        entity,
      );
    }
    return;
  }
  const axis = axes[plan.axis];
  if (axis === undefined) return;
  const wantsInt = type === "int" || type === "json";
  if ((axis.hasStrings && !wantsString) || (axis.hasInts && !wantsInt)) {
    c.add(
      "SCHEMA_TYPE",
      path,
      `axis "${axis.name}" yields ${axis.hasStrings && !wantsString ? "strings" : "integers"}, but the field is declared ${type}`,
      entity,
    );
  }
}

function checkLiteral(
  c: ErrorCollector,
  value: unknown,
  type: FieldType,
  path: string,
  entity: string,
): void {
  switch (type) {
    case "json":
      validateJsonValue(c, value, path, entity);
      return;
    case "string":
      if (typeof value !== "string") typeError(c, path, entity, type, value);
      return;
    case "bool":
      if (typeof value !== "boolean") typeError(c, path, entity, type, value);
      return;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        typeError(c, path, entity, type, value);
      } else if (!Number.isSafeInteger(value)) {
        c.add(
          "INVALID_VALUE",
          path,
          "integer is outside the safe range",
          entity,
        );
      }
  }
}

function typeError(
  c: ErrorCollector,
  path: string,
  entity: string,
  type: FieldType,
  value: unknown,
): void {
  c.add(
    "SCHEMA_TYPE",
    path,
    `expected ${type}, got ${describeType(value)}`,
    entity,
  );
}

interface Plan {
  readonly idSegs: readonly Segment[];
  readonly typeSegs: readonly Segment[] | undefined;
  readonly zoneSegs: readonly Segment[];
  readonly plans: Readonly<Record<string, MetaPlan>>;
  readonly fieldMap: {
    readonly types: Readonly<Record<string, FieldType>>;
    readonly visibility: Readonly<Record<string, FieldVisibility>>;
  };
  readonly entity: string;
}

/** Odometer expansion: the last axis varies fastest, the first slowest. */
function expand(
  c: ErrorCollector,
  base: string,
  axes: readonly Axis[],
  total: number,
  state: State,
  plan: Plan,
): void {
  const idPath = joinPath(base, "id");
  const zonePath = joinPath(base, "zone");
  const index = axes.map(() => 0);
  const out: CardDecl[] = [];
  for (let n = 0; n < total; n += 1) {
    const values = axes.map((a, k) => a.at(index[k] ?? 0));
    const id = renderTemplate(plan.idSegs, values);
    // Generated ids are reported once, against the producing path.
    if (!checkId(c, id, idPath, "card id")) return;
    if (state.ids.has(id)) {
      c.add("DUPLICATE_ID", idPath, `duplicate card id "${id}"`, id);
      return;
    }
    state.ids.add(id);
    const zone = renderTemplate(plan.zoneSegs, values);
    if (state.zones !== undefined && !state.zones.has(zone)) {
      c.add(
        "UNKNOWN_REFERENCE",
        zonePath,
        `card "${id}" starts in "${zone}", which is not a declared fixed zone`,
        id,
      );
      return;
    }
    const initialMetadata: Record<string, JsonValue> = {};
    for (const [field, p] of Object.entries(plan.plans)) {
      setOwn(initialMetadata, field, metadataValue(p, values));
    }
    out.push({
      id: id as CardId,
      ...(plan.typeSegs !== undefined
        ? { type: renderTemplate(plan.typeSegs, values) }
        : {}),
      metadataSchema: plan.fieldMap.types,
      startingZone: zone as ZoneId,
      initialMetadata,
      metadataVisibility: plan.fieldMap.visibility,
    });
    for (let k = axes.length - 1; k >= 0; k -= 1) {
      const next = (index[k] ?? 0) + 1;
      const axis = axes[k];
      if (axis !== undefined && next < axis.length) {
        index[k] = next;
        break;
      }
      index[k] = 0;
    }
  }
  for (const card of out) state.cards.push(card);
}

function metadataValue(
  plan: MetaPlan,
  values: readonly (string | number)[],
): JsonValue {
  switch (plan.kind) {
    case "lit":
      return cloneJson(plan.value);
    case "lone":
      return values[plan.axis] as JsonValue;
    case "mixed":
      return renderTemplate(plan.segments, values);
  }
}

/** Deep copy of a validated JSON value (cards must not share nested objects). */
function cloneJson(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) setOwn(out, k, cloneJson(v));
    return out;
  }
  return value as JsonValue;
}
