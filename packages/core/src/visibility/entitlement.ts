import type { ZoneId } from "../session/ids.js";
import { getOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { Orientation, SessionState } from "../session/state.js";
import type { VisibilityPolicy } from "./policy.js";
import { isEntitled } from "./policy.js";
import type { ViewerIdentity } from "./types.js";

/** The zone-level view keys (spec §7.3 entitlement table). */
export type ZoneKey =
  "zone_count" | "zone_membership" | "zone_order" | "card_face";

/** Everything an entitlement question needs. */
export interface EntitlementContext {
  readonly policy: VisibilityPolicy;
  readonly state: Snapshot<SessionState>;
  readonly viewer: ViewerIdentity;
}

/**
 * Is the viewer *statically* (by the declared rule of the zone, PFR-009; no
 * grants) entitled to key `key` of zone `zone`? `zone_count`, `zone_membership`
 * and `zone_order` are entitled together. `card_face` is entitled for an
 * `owner`/`team` audience always and for a `public` one only when
 * `orientation` is `face_up` (PFR-013); `orientation` defaults to face down
 * (fail closed). An unknown zone is never entitled.
 *
 * Grant-aware entitlement (Iteration 3) and delta projection (Iteration 5)
 * build on this function; they must not re-derive the static rule.
 */
export function isEntitledToZoneKey(
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
