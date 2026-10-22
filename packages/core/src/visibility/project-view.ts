import type {
  CompiledGameDefinition,
  CounterDecl,
} from "../definition/types.js";
import { ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { CardId, CounterId, SeatId, ZoneId } from "../session/ids.js";
import { getOwn, setOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { JsonValue, SessionState } from "../session/state.js";
import { isEntitledToZoneKey } from "./entitlement.js";
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
  RoleRegistry,
  View,
  ViewerIdentity,
  ZoneView,
} from "./types.js";

/** Per-definition lookups, built once and reused across calls. */
interface Compiled {
  readonly registry: RoleRegistry;
  readonly policy: VisibilityPolicy;
  readonly cardTypes: ReadonlyMap<string, string | undefined>;
  readonly zoneOrdered: ReadonlyMap<string, boolean>;
  readonly templateOrdered: ReadonlyMap<string, boolean>;
  /** Counters sorted by id. */
  readonly counters: readonly CounterDecl[];
}

const cache = new WeakMap<CompiledGameDefinition, Compiled>();

function compile(def: CompiledGameDefinition): Compiled {
  const hit = cache.get(def);
  if (hit !== undefined) return hit;
  const compiled: Compiled = {
    registry: buildRoleRegistry(def),
    policy: buildVisibilityPolicy(def),
    cardTypes: new Map(def.cards.map((c) => [c.id as string, c.type])),
    zoneOrdered: new Map(def.zones.map((z) => [z.id as string, z.ordered])),
    templateOrdered: new Map(def.zoneTemplates.map((t) => [t.name, t.ordered])),
    counters: [...def.counters].sort((a, b) => compareIds(a.id, b.id)),
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

function projectFace(
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

function projectZones(
  compiled: Compiled,
  ctx: EntitlementContext,
): Record<ZoneId, ZoneView> {
  const { state, viewer } = ctx;
  const zones: Record<ZoneId, ZoneView> = {};
  for (const id of Object.keys(state.zones).sort(compareIds)) {
    const zoneId = id as ZoneId;
    if (!isEntitledToZoneKey(ctx, zoneId, "zone_membership")) continue;
    const zone = state.zones[zoneId]!;
    const ordered =
      compiled.zoneOrdered.get(id) ??
      (zone.template === undefined
        ? undefined
        : compiled.templateOrdered.get(zone.template)) ??
      false;
    const ids = ordered ? zone.members : [...zone.members].sort(compareIds);
    const members: CardView[] = ids.map((cardId) => {
      const card = getOwn(state.cards, cardId)!;
      const view: CardView = {
        id: cardId,
        orientation: card.orientation,
      };
      return isEntitledToZoneKey(ctx, zoneId, "card_face", card.orientation)
        ? {
            ...view,
            face: projectFace(compiled, cardId, card.metadata, viewer),
          }
        : view;
    });
    setOwn<ZoneView>(zones, zoneId, {
      ordered,
      ...(zone.owner !== undefined ? { owner: zone.owner } : {}),
      count: members.length,
      members,
      orderKnown: true,
    });
  }
  return zones;
}

/** PFR-015, PBR-011. */
function projectCounters(
  compiled: Compiled,
  ctx: EntitlementContext,
): Record<CounterId, string> {
  const { state, viewer } = ctx;
  const out: Record<CounterId, string> = {};
  for (const counter of compiled.counters) {
    let value: bigint | undefined;
    if (counter.derived !== undefined) value = counter.derived(state);
    else value = getOwn(state.counters, counter.id);
    if (value === undefined) continue;
    const declared = Object.keys(counter.visibility).length > 0;
    let entitled: boolean;
    if (declared || counter.derived === undefined) {
      entitled = isEntitled(
        compiled.policy.counterAudience(counter.id, viewer.role),
        counter.ownerId,
        viewer,
        state,
      );
    } else {
      // Derived without a declaration: inherit the input zone's zone_count.
      entitled =
        counter.derivedSpec !== undefined &&
        isEntitledToZoneKey(ctx, counter.derivedSpec.zone, "zone_count");
    }
    if (entitled) setOwn(out, counter.id, value.toString());
  }
  return out;
}

/**
 * Projects `state` for `viewer` (PFR-011..016, PFR-021, PFR-022): pure, never
 * mutates its inputs, plain JSON out. `meta`, `gates` and `grants` are empty
 * placeholders until Iteration 3.
 */
export function projectView(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
): Result<View> {
  const compiled = compile(def);
  const valid = validateViewer(compiled.registry, state, viewer);
  if (!valid.ok) return valid;

  const identity: ViewerIdentity =
    viewer.subject === undefined
      ? { role: viewer.role }
      : { role: viewer.role, subject: viewer.subject };
  const ctx: EntitlementContext = {
    policy: compiled.policy,
    state,
    viewer: identity,
  };

  const roster: Record<
    SeatId,
    {
      status: View["roster"][SeatId]["status"];
      team?: NonNullable<View["roster"][SeatId]["team"]>;
      player?: NonNullable<View["roster"][SeatId]["player"]>;
    }
  > = {};
  for (const seat of Object.keys(state.roster.seats).sort(compareIds)) {
    const s = state.roster.seats[seat as SeatId]!;
    setOwn(roster, seat, {
      status: s.status,
      ...(s.team !== undefined ? { team: s.team } : {}),
      ...(s.player !== undefined ? { player: s.player } : {}),
    });
  }

  const pointers: Record<string, SeatId> = {};
  for (const name of Object.keys(state.control.pointers).sort(compareIds)) {
    setOwn(pointers, name, state.control.pointers[name]!);
  }

  return ok(
    makeView({
      seq: state.seq,
      lifecycle: state.lifecycle,
      viewer: identity,
      zones: projectZones(compiled, ctx),
      counters: projectCounters(compiled, ctx),
      control: {
        phase: state.control.phase,
        turnOrder: [...state.control.turnOrder],
        activeSeats: [...state.control.activeSeats],
        direction: state.control.direction,
        pointers,
      },
      roster,
      meta: {},
      gates: { open: {}, resolved: {} },
      grants: {},
      ...(state.outcome !== undefined
        ? { outcome: cloneJson(state.outcome) }
        : {}),
    }),
  );
}
