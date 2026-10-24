import type { CardId, GrantId, SeatId, ZoneId } from "../session/ids.js";
import { getOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type {
  Grant,
  JsonValue,
  Orientation,
  SessionState,
} from "../session/state.js";
import type { VisibilityPolicy } from "./policy.js";
import { isEntitled } from "./policy.js";
import type { ViewerIdentity } from "./types.js";

/** The zone-level view keys (spec §7.3 entitlement table). */
export type ZoneKey =
  "zone_count" | "zone_membership" | "zone_order" | "card_face";

/** Keys a card-level (card or top-of-zone) grant can carry meaning for. */
export type CardKey = "card_face" | "zone_membership";

type KeySet = ReadonlySet<string>;

/**
 * Everything an entitlement question needs: the declared policy, the state,
 * the viewer and the grants that apply to this viewer, already resolved to
 * per-zone and per-card key sets (PFR-019). Build it with
 * `buildEntitlementContext`; grants only ever add (PBR-002).
 */
export interface EntitlementContext {
  readonly policy: VisibilityPolicy;
  readonly state: Snapshot<SessionState>;
  readonly viewer: ViewerIdentity;
  /** Keys granted to this viewer on a whole zone (`zone` target). */
  readonly zoneKeys: ReadonlyMap<string, KeySet>;
  /** Keys granted to this viewer on one card (`card` and resolved `top` targets). */
  readonly cardKeys: ReadonlyMap<string, KeySet>;
}

/** Options of `buildEntitlementContext`. */
export interface GrantSelection {
  /** Explicit grant set; default `state.grants`. Deltas pass the union of `pre` and `post`. */
  readonly grants?: Readonly<Record<GrantId, Grant>>;
  /** A grant id to leave out (what-if evaluation for `wouldReveal`). */
  readonly exclude?: GrantId;
}

const ZONE_KEYS: readonly string[] = [
  "zone_count",
  "zone_membership",
  "zone_order",
  "card_face",
];
const CARD_KEYS: readonly string[] = ["card_face", "zone_membership"];

function plain(
  value: JsonValue,
): { readonly [key: string]: JsonValue } | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : undefined;
}

/**
 * Grantee expansion at projection time (PFR-019): a seat id is that seat (if
 * declared); `all_seated` is every seat whose status is `seated`; `team:<id>`
 * is every seat of that team (whatever its status). Unknown seats and teams
 * expand to nothing.
 */
export function expandGrantee(
  state: Snapshot<SessionState>,
  grantee: string,
): ReadonlySet<SeatId> {
  const out = new Set<SeatId>();
  const seats = state.roster.seats;
  if (grantee === "all_seated") {
    for (const seat of Object.keys(seats)) {
      if (seats[seat as SeatId]!.status === "seated") out.add(seat as SeatId);
    }
  } else if (grantee.startsWith("team:")) {
    const team = grantee.slice("team:".length);
    for (const seat of Object.keys(seats)) {
      if (seats[seat as SeatId]!.team === team) out.add(seat as SeatId);
    }
  } else if (getOwn(seats, grantee) !== undefined) {
    out.add(grantee as SeatId);
  }
  return out;
}

/**
 * Is `viewer` a grantee of `grant` (PFR-019/020)? The viewer needs a subject
 * seat in the expanded set and a role that is not `dealer`/`auditor`
 * (PBR-002). The scope is not looked at.
 */
export function isGrantee(
  state: Snapshot<SessionState>,
  grant: Grant,
  viewer: ViewerIdentity,
): boolean {
  if (viewer.subject === undefined) return false;
  if (viewer.role === "dealer" || viewer.role === "auditor") return false;
  return expandGrantee(state, grant.grantee).has(viewer.subject);
}

/** `until_revoked` and `once` apply while present; `until_seq(n)` while `state.seq < n`. */
export function isGrantInScope(
  state: Snapshot<SessionState>,
  grant: Grant,
): boolean {
  const scope = plain(grant.scope);
  switch (scope?.kind) {
    case "until_revoked":
    case "once":
      return true;
    case "until_seq":
      return typeof scope.n === "number" && state.seq < scope.n;
    default:
      return false;
  }
}

/**
 * Resolves a grant target against `state`: a card target is that card, a zone
 * target that zone, a top target the card at position 0 of the zone (none when
 * the zone is empty or unknown, so the grant has no effect). Other shapes
 * resolve to nothing.
 */
export function resolveGrantTarget(
  state: Snapshot<SessionState>,
  target: JsonValue,
):
  | { readonly kind: "card"; readonly card: CardId }
  | { readonly kind: "zone"; readonly zone: ZoneId }
  | undefined {
  const t = plain(target);
  if (t === undefined) return undefined;
  if (t.kind === "card" && typeof t.card_id === "string") {
    return getOwn(state.cards, t.card_id) === undefined
      ? undefined
      : { kind: "card", card: t.card_id as CardId };
  }
  if (typeof t.zone_id !== "string") return undefined;
  const zone = getOwn(state.zones, t.zone_id);
  if (zone === undefined) return undefined;
  if (t.kind === "zone") return { kind: "zone", zone: t.zone_id as ZoneId };
  if (t.kind === "top") {
    const top = zone.members[0];
    return top === undefined ? undefined : { kind: "card", card: top };
  }
  return undefined;
}

function addKeys(
  into: Map<string, Set<string>>,
  id: string,
  keys: readonly string[],
  meaningful: readonly string[],
): void {
  for (const key of keys) {
    if (!meaningful.includes(key)) continue;
    let set = into.get(id);
    if (set === undefined) into.set(id, (set = new Set()));
    set.add(key);
  }
}

/**
 * The composition helper: static policy plus the grants that apply to
 * `viewer` (PFR-019). A grant applies only if the viewer is a grantee (a
 * subject seat in the expanded set, role not `dealer`/`auditor`) and its scope
 * is active at `state.seq`; keys without meaning for the target are dropped.
 * `opts.grants` supplies an explicit set; `opts.exclude` removes one grant id.
 * Grants are only ever unioned with the static rule, never subtracted.
 */
export function buildEntitlementContext(
  policy: VisibilityPolicy,
  state: Snapshot<SessionState>,
  viewer: ViewerIdentity,
  opts: GrantSelection = {},
): EntitlementContext {
  const zoneKeys = new Map<string, Set<string>>();
  const cardKeys = new Map<string, Set<string>>();
  const grants = opts.grants ?? state.grants;
  for (const id of Object.keys(grants)) {
    if (id === opts.exclude) continue;
    const grant = grants[id as GrantId]!;
    if (!isGrantee(state, grant, viewer) || !isGrantInScope(state, grant)) {
      continue;
    }
    const target = resolveGrantTarget(state, grant.target);
    if (target === undefined) continue;
    if (target.kind === "zone") {
      addKeys(zoneKeys, target.zone, grant.keys, ZONE_KEYS);
    } else {
      addKeys(cardKeys, target.card, grant.keys, CARD_KEYS);
    }
  }
  return { policy, state, viewer, zoneKeys, cardKeys };
}

/** The same context with every grant dropped (static entitlement only). */
export function withoutGrants(ctx: EntitlementContext): EntitlementContext {
  return { ...ctx, zoneKeys: new Map(), cardKeys: new Map() };
}

/**
 * Is the viewer *statically* (by the declared rule of the zone, PFR-009; no
 * grants) entitled to key `key` of zone `zone`? `zone_count`, `zone_membership`
 * and `zone_order` are entitled together. `card_face` is entitled for an
 * `owner`/`team` audience always and for a `public` one only when
 * `orientation` is `face_up` (PFR-013); `orientation` defaults to face down
 * (fail closed). An unknown zone is never entitled.
 */
export function isStaticallyEntitledToZoneKey(
  ctx: EntitlementContext,
  zone: ZoneId,
  key: ZoneKey,
  orientation: Orientation = "face_down",
): boolean {
  const zoneState = getOwn(ctx.state.zones, zone);
  if (zoneState === undefined) return false;
  const audience = ctx.policy.zoneAudience(
    zone,
    zoneState.template,
    ctx.viewer.role,
  );
  if (!isEntitled(audience, zoneState.owner, ctx.viewer, ctx.state)) {
    return false;
  }
  if (key === "card_face") {
    return audience !== "public" || orientation === "face_up";
  }
  return true;
}

/**
 * Entitlement to a zone key: the static rule or a zone-target grant naming the
 * key (union, PBR-002). A `zone_order` grant counts only together with
 * membership; a `card_face` grant on a zone covers its cards in any
 * orientation. Card-level grants are `isEntitledToCardKey`.
 */
export function isEntitledToZoneKey(
  ctx: EntitlementContext,
  zone: ZoneId,
  key: ZoneKey,
  orientation: Orientation = "face_down",
): boolean {
  if (isStaticallyEntitledToZoneKey(ctx, zone, key, orientation)) return true;
  if (getOwn(ctx.state.zones, zone) === undefined) return false;
  if (ctx.zoneKeys.get(zone)?.has(key) !== true) return false;
  return (
    key !== "zone_order" || isEntitledToZoneKey(ctx, zone, "zone_membership")
  );
}

/**
 * Entitlement to `card_face` or `zone_membership` of one card: the zone rule
 * (static or zone grant, with the card's orientation) or a card-level grant.
 */
export function isEntitledToCardKey(
  ctx: EntitlementContext,
  card: CardId,
  key: CardKey,
): boolean {
  const cardState = getOwn(ctx.state.cards, card);
  if (cardState === undefined) return false;
  if (isEntitledToZoneKey(ctx, cardState.zone, key, cardState.orientation)) {
    return true;
  }
  return ctx.cardKeys.get(card)?.has(key) === true;
}

/**
 * PFR-020: is the viewer statically entitled (ignoring all grants) to every
 * key `grant` names on its target? Keys with no meaning for the target, and
 * targets that do not resolve (unknown card/zone, empty top), are not
 * entitled (fail closed). A zone target's `card_face` needs every current
 * member face-entitled (vacuously true for an empty zone).
 */
export function isStaticallyEntitledToGrant(
  ctx: EntitlementContext,
  grant: Grant,
): boolean {
  const target = resolveGrantTarget(ctx.state, grant.target);
  if (target === undefined || grant.keys.length === 0) return false;
  const plainCtx = withoutGrants(ctx);
  return grant.keys.every((key) => {
    if (target.kind === "card") {
      if (!CARD_KEYS.includes(key)) return false;
      const card = getOwn(ctx.state.cards, target.card)!;
      return isStaticallyEntitledToZoneKey(
        plainCtx,
        card.zone,
        key as CardKey,
        card.orientation,
      );
    }
    if (!ZONE_KEYS.includes(key)) return false;
    if (key !== "card_face") {
      return isStaticallyEntitledToZoneKey(
        plainCtx,
        target.zone,
        key as ZoneKey,
      );
    }
    const zone = getOwn(ctx.state.zones, target.zone)!;
    return zone.members.every((member) =>
      isStaticallyEntitledToZoneKey(
        plainCtx,
        target.zone,
        "card_face",
        getOwn(ctx.state.cards, member)!.orientation,
      ),
    );
  });
}
