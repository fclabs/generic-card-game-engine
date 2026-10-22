import type {
  CompiledGameDefinition,
  CounterDecl,
  MetaSchemaDecl,
} from "../definition/types.js";
import { ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type {
  CardId,
  CounterId,
  GateId,
  GrantId,
  SeatId,
  ZoneId,
} from "../session/ids.js";
import { getOwn, hasOwn, setOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { Grant, JsonValue, SessionState } from "../session/state.js";
import {
  buildEntitlementContext,
  isEntitledToCardKey,
  isEntitledToZoneKey,
  isGrantee,
  isStaticallyEntitledToGrant,
} from "./entitlement.js";
import type { EntitlementContext } from "./entitlement.js";
import { makeView } from "./make-view.js";
import { buildVisibilityPolicy, isEntitled } from "./policy.js";
import type { VisibilityPolicy } from "./policy.js";
import {
  buildRoleRegistry,
  isPrivilegedRole,
  validateViewer,
} from "./roles.js";
import type {
  CardView,
  GateView,
  GrantView,
  RoleRegistry,
  View,
  ViewerIdentity,
  ZoneView,
} from "./types.js";

/** Per-definition lookups, built once and reused across calls. */
export interface Compiled {
  readonly registry: RoleRegistry;
  readonly policy: VisibilityPolicy;
  readonly cardTypes: ReadonlyMap<string, string | undefined>;
  readonly zoneOrdered: ReadonlyMap<string, boolean>;
  readonly templateOrdered: ReadonlyMap<string, boolean>;
  /** Counters sorted by id. */
  readonly counters: readonly CounterDecl[];
  /** Declared meta schemas sorted by id. */
  readonly metaSchemas: readonly MetaSchemaDecl[];
}

const cache = new WeakMap<CompiledGameDefinition, Compiled>();

/** The per-definition lookups (cached per definition object). */
export function compileLookups(def: CompiledGameDefinition): Compiled {
  const hit = cache.get(def);
  if (hit !== undefined) return hit;
  const compiled: Compiled = {
    registry: buildRoleRegistry(def),
    policy: buildVisibilityPolicy(def),
    cardTypes: new Map(def.cards.map((c) => [c.id as string, c.type])),
    zoneOrdered: new Map(def.zones.map((z) => [z.id as string, z.ordered])),
    templateOrdered: new Map(def.zoneTemplates.map((t) => [t.name, t.ordered])),
    counters: [...def.counters].sort((a, b) => compareIds(a.id, b.id)),
    metaSchemas: [...def.metaSchemas].sort((a, b) => compareIds(a.id, b.id)),
  };
  cache.set(def, compiled);
  return compiled;
}

/** Ascending UTF-16 code-unit order (PFR-021). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deep copy of a JSON value into fresh plain objects (safe for `__proto__` keys). */
export function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((v) => cloneJson(v as JsonValue));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      setOwn(out, key, cloneJson((value as Record<string, JsonValue>)[key]!));
    }
    return out;
  }
  return value;
}

export function projectFace(
  compiled: Compiled,
  card: CardId,
  metadata: Readonly<Record<string, JsonValue>>,
  viewer: ViewerIdentity,
): NonNullable<CardView["face"]> {
  const fields: Record<string, JsonValue> = {};
  for (const field of Object.keys(metadata).sort(compareIds)) {
    const visibility = compiled.policy.cardFieldVisibility(card, field);
    const shown =
      visibility === "public" ||
      (visibility === "subject" && viewer.subject !== undefined) ||
      (visibility === "secret" && isPrivilegedRole(viewer.role));
    if (shown) setOwn(fields, field, cloneJson(metadata[field]!));
  }
  const type = compiled.cardTypes.get(card);
  return type === undefined ? { metadata: fields } : { type, metadata: fields };
}

/** Whether zone `id` (of template `template`, if any) is ordered. */
export function isZoneOrdered(
  compiled: Compiled,
  id: string,
  template: string | undefined,
): boolean {
  return (
    compiled.zoneOrdered.get(id) ??
    (template === undefined
      ? undefined
      : compiled.templateOrdered.get(template)) ??
    false
  );
}

function projectZones(
  compiled: Compiled,
  ctx: EntitlementContext,
): Record<ZoneId, ZoneView> {
  const { state, viewer } = ctx;
  const zones: Record<ZoneId, ZoneView> = {};
  for (const id of Object.keys(state.zones).sort(compareIds)) {
    const zoneId = id as ZoneId;
    const zone = state.zones[zoneId]!;
    const count = isEntitledToZoneKey(ctx, zoneId, "zone_count");
    const full = isEntitledToZoneKey(ctx, zoneId, "zone_membership");
    const orderKnown = full && isEntitledToZoneKey(ctx, zoneId, "zone_order");
    const ordered = isZoneOrdered(compiled, id, zone.template);
    // Whole-zone membership lists every member; otherwise only the cards a
    // card-level grant entitles (PFR-012, PFR-019). A zone-level `card_face`
    // grant alone adds the faces of listed cards, never the listing itself.
    const listed = full
      ? zone.members
      : zone.members.filter((cardId) => {
          const keys = ctx.cardKeys.get(cardId);
          return keys?.has("zone_membership") || keys?.has("card_face");
        });
    if (!count && listed.length === 0) continue;
    const members: CardView[] | undefined =
      listed.length === 0 && !full
        ? undefined
        : (ordered && orderKnown ? listed : [...listed].sort(compareIds)).map(
            (cardId) => {
              const card = getOwn(state.cards, cardId)!;
              const view: CardView = {
                id: cardId,
                orientation: card.orientation,
              };
              return isEntitledToCardKey(ctx, cardId, "card_face")
                ? {
                    ...view,
                    face: projectFace(compiled, cardId, card.metadata, viewer),
                  }
                : view;
            },
          );
    setOwn<ZoneView>(zones, zoneId, {
      ordered,
      ...(zone.owner !== undefined ? { owner: zone.owner } : {}),
      ...(count ? { count: zone.members.length } : {}),
      ...(members !== undefined ? { members, orderKnown } : {}),
    });
  }
  return zones;
}

/** PFR-017. */
export function projectMeta(
  compiled: Compiled,
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  const seats = state.roster.seats;
  for (const schema of compiled.metaSchemas) {
    const partition = getOwn(state.meta, schema.id);
    if (
      typeof partition !== "object" ||
      partition === null ||
      Array.isArray(partition)
    ) {
      continue;
    }
    const fields: Record<string, JsonValue> = {};
    const record = partition as { readonly [key: string]: JsonValue };
    for (const field of Object.keys(record).sort(compareIds)) {
      const visibility = compiled.policy.metaFieldVisibility(schema.id, field);
      const value = record[field]!;
      if (visibility === "public") {
        setOwn(fields, field, cloneJson(value));
      } else if (visibility === "secret") {
        if (isPrivilegedRole(viewer.role)) {
          setOwn(fields, field, cloneJson(value));
        }
      } else if (visibility === "subject") {
        const own = subjectEntries(value, seats, viewer);
        if (own !== undefined) setOwn(fields, field, own);
      }
    }
    if (Object.keys(fields).length > 0) setOwn(out, schema.id, fields);
  }
  return out;
}

/**
 * A `subject` field value: an object whose keys are all seat ids, projected
 * to the viewer's own entry (a registered auditor gets all). Other shapes and
 * an empty projection are omitted (D-010).
 */
function subjectEntries(
  value: JsonValue,
  seats: Snapshot<SessionState>["roster"]["seats"],
  viewer: ViewerIdentity,
): JsonValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(record);
  if (!keys.every((k) => getOwn(seats, k) !== undefined)) return undefined;
  const shown =
    viewer.role === "auditor"
      ? keys
      : viewer.subject !== undefined && keys.includes(viewer.subject)
        ? [viewer.subject as string]
        : [];
  if (shown.length === 0) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const key of [...shown].sort(compareIds)) {
    setOwn(out, key, cloneJson(record[key]!));
  }
  return out;
}

/** PFR-018. */
export function projectGates(
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
): View["gates"] {
  const seeAll = viewer.role === "auditor";
  const visible = (
    submissions: Readonly<Record<SeatId, JsonValue>>,
  ): Record<SeatId, JsonValue> | undefined => {
    const out: Record<SeatId, JsonValue> = {};
    for (const seat of Object.keys(submissions).sort(compareIds)) {
      if (seeAll || seat === viewer.subject) {
        setOwn(out, seat, cloneJson(submissions[seat as SeatId]!));
      }
    }
    return Object.keys(out).length === 0 ? undefined : out;
  };
  const open: Record<GateId, GateView> = {};
  for (const id of Object.keys(state.gates.open).sort(compareIds)) {
    const gate = state.gates.open[id as GateId]!;
    const submissions = visible(gate.submissions);
    setOwn<GateView>(open, id, {
      schemaId: gate.schemaId,
      expectedSeats: [...gate.expectedSeats],
      submitted: gate.expectedSeats.filter((seat) =>
        hasOwn(gate.submissions, seat),
      ),
      ...(submissions !== undefined ? { submissions } : {}),
    });
  }
  const resolved: Record<GateId, GateView> = {};
  for (const id of Object.keys(state.gates.resolved).sort(compareIds)) {
    const gate = state.gates.resolved[id as GateId]!;
    const submissions = visible(gate.submissions);
    setOwn<GateView>(resolved, id, {
      schemaId: gate.schemaId,
      expectedSeats: [...gate.expectedSeats],
      ...(submissions !== undefined ? { submissions } : {}),
    });
  }
  return { open, resolved };
}

/** PFR-020: is `grant` listed for the viewer of `ctx` (grantee or statically entitled)? */
export function isGrantVisible(ctx: EntitlementContext, grant: Grant): boolean {
  return (
    isGrantee(ctx.state, grant, ctx.viewer) ||
    isStaticallyEntitledToGrant(ctx, grant)
  );
}

/** The `GrantView` of a stored grant (JSON clones). */
export function projectGrantView(grant: Grant): GrantView {
  return {
    target: cloneJson(grant.target),
    keys: [...grant.keys],
    grantee: grant.grantee,
    scope: cloneJson(grant.scope),
  };
}

function projectGrants(ctx: EntitlementContext): Record<GrantId, GrantView> {
  const { state } = ctx;
  const out: Record<GrantId, GrantView> = {};
  for (const id of Object.keys(state.grants).sort(compareIds)) {
    const grant = state.grants[id as GrantId]!;
    if (isGrantVisible(ctx, grant)) {
      setOwn<GrantView>(out, id, projectGrantView(grant));
    }
  }
  return out;
}

/** The current value of a stored or derived counter in `state`, if it has one. */
export function counterValue(
  counter: CounterDecl,
  state: Snapshot<SessionState>,
): bigint | undefined {
  return counter.derived !== undefined
    ? counter.derived(state)
    : getOwn(state.counters, counter.id);
}

/** PFR-015, PBR-011: is the viewer of `ctx` entitled to `counter`? */
export function isCounterVisible(
  compiled: Compiled,
  ctx: EntitlementContext,
  counter: CounterDecl,
): boolean {
  const { state, viewer } = ctx;
  const declared = Object.keys(counter.visibility).length > 0;
  if (declared || counter.derived === undefined) {
    return isEntitled(
      compiled.policy.counterAudience(counter.id, viewer.role),
      counter.ownerId,
      viewer,
      state,
    );
  }
  // Derived without a declaration: inherit the input zone's zone_count.
  return (
    counter.derivedSpec !== undefined &&
    isEntitledToZoneKey(ctx, counter.derivedSpec.zone, "zone_count")
  );
}

function projectCounters(
  compiled: Compiled,
  ctx: EntitlementContext,
): Record<CounterId, string> {
  const out: Record<CounterId, string> = {};
  for (const counter of compiled.counters) {
    const value = counterValue(counter, ctx.state);
    if (value !== undefined && isCounterVisible(compiled, ctx, counter)) {
      setOwn(out, counter.id, value.toString());
    }
  }
  return out;
}

export type SeatView = View["roster"][SeatId];

/** PFR-016: a roster seat as every viewer sees it. */
export function projectSeat(
  seat: SessionState["roster"]["seats"][SeatId],
): SeatView {
  return {
    status: seat.status,
    ...(seat.team !== undefined ? { team: seat.team } : {}),
    ...(seat.player !== undefined ? { player: seat.player } : {}),
  };
}

/** PFR-016: the control section as every viewer sees it. */
export function projectControl(state: Snapshot<SessionState>): View["control"] {
  const pointers: Record<string, SeatId> = {};
  for (const name of Object.keys(state.control.pointers).sort(compareIds)) {
    setOwn(pointers, name, state.control.pointers[name]!);
  }
  return {
    phase: state.control.phase,
    turnOrder: [...state.control.turnOrder],
    activeSeats: [...state.control.activeSeats],
    direction: state.control.direction,
    pointers,
  };
}

/**
 * Projects `state` for `viewer` (PFR-011..016, PFR-021, PFR-022): pure, never
 * mutates its inputs, plain JSON out. Meta partitions (PFR-017), gates
 * (PFR-018) and grants (PFR-019, PFR-020) included.
 */
export function projectView(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
): Result<View> {
  const compiled = compileLookups(def);
  const valid = validateViewer(compiled.registry, state, viewer);
  if (!valid.ok) return valid;

  const identity: ViewerIdentity =
    viewer.subject === undefined
      ? { role: viewer.role }
      : { role: viewer.role, subject: viewer.subject };
  const ctx = buildEntitlementContext(compiled.policy, state, identity);

  const roster: Record<SeatId, SeatView> = {};
  for (const seat of Object.keys(state.roster.seats).sort(compareIds)) {
    setOwn(roster, seat, projectSeat(state.roster.seats[seat as SeatId]!));
  }

  return ok(
    makeView({
      seq: state.seq,
      lifecycle: state.lifecycle,
      viewer: identity,
      zones: projectZones(compiled, ctx),
      counters: projectCounters(compiled, ctx),
      control: projectControl(state),
      roster,
      meta: projectMeta(compiled, state, identity),
      gates: projectGates(state, identity),
      grants: projectGrants(ctx),
      ...(state.outcome !== undefined
        ? { outcome: cloneJson(state.outcome) }
        : {}),
    }),
  );
}
