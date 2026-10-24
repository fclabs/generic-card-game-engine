import type {
  Audience,
  CompiledGameDefinition,
  FieldVisibility,
  VisibilityRules,
} from "../definition/types.js";
import type { CardId, CounterId, ZoneId } from "../session/ids.js";
import { getOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { isPrivilegedRole } from "./roles.js";
import type { ViewerIdentity } from "./types.js";

/**
 * The audience of `rules` for `role` (PFR-008): the entry keyed by the role;
 * otherwise `default` for non-privileged roles only; otherwise `undefined`
 * ("not declared", which hides, PFR-010).
 */
export function resolveAudience(
  rules: VisibilityRules,
  role: string,
): Audience | undefined {
  const own = getOwn(rules, role);
  if (own !== undefined) return own;
  if (isPrivilegedRole(role)) return undefined;
  return getOwn(rules, "default");
}

/** Precompiled visibility lookups of one definition (PFR-008). Opaque to callers. */
export interface VisibilityPolicy {
  /**
   * Audience of a zone for `role`. A configured zone uses its own declaration;
   * a template-created zone (`template` is `ZoneState.template`) uses the
   * template's. `undefined` when undeclared or the zone is unknown.
   */
  zoneAudience(
    zone: ZoneId,
    template: string | undefined,
    role: string,
  ): Audience | undefined;
  /** Audience of a stored or derived counter for `role`. */
  counterAudience(counter: CounterId, role: string): Audience | undefined;
  /** Declared visibility of a card-metadata field (`undefined`: undeclared, never shown). */
  cardFieldVisibility(card: CardId, field: string): FieldVisibility | undefined;
  /** Declared visibility of a `meta` schema field. */
  metaFieldVisibility(
    schemaId: string,
    field: string,
  ): FieldVisibility | undefined;
}

export function buildVisibilityPolicy(
  def: CompiledGameDefinition,
): VisibilityPolicy {
  const zones = new Map(def.zones.map((z) => [z.id as string, z.visibility]));
  const templates = new Map(
    def.zoneTemplates.map((t) => [t.name, t.visibility]),
  );
  const counters = new Map(
    def.counters.map((c) => [c.id as string, c.visibility]),
  );
  const cards = new Map(
    def.cards.map((c) => [c.id as string, c.metadataVisibility]),
  );
  const schemas = new Map(
    def.metaSchemas.map((s) => [s.id, s.fieldVisibility]),
  );
  const policy: VisibilityPolicy = {
    zoneAudience(zone, template, role) {
      const rules =
        zones.get(zone) ??
        (template === undefined ? undefined : templates.get(template));
      return rules === undefined ? undefined : resolveAudience(rules, role);
    },
    counterAudience(counter, role) {
      const rules = counters.get(counter);
      return rules === undefined ? undefined : resolveAudience(rules, role);
    },
    cardFieldVisibility(card, field) {
      const rules = cards.get(card);
      return rules === undefined ? undefined : getOwn(rules, field);
    },
    metaFieldVisibility(schemaId, field) {
      const rules = schemas.get(schemaId);
      return rules === undefined ? undefined : getOwn(rules, field);
    },
  };
  return Object.freeze(policy);
}

/**
 * PFR-009/PFR-010: is `viewer` entitled by `audience` on an entity with owner
 * `owner` (a seat, team or player id; `undefined` for unowned entities)?
 * `undefined` audience: never. `owner`/`team` never entitle a viewer without a
 * subject seat. Roster data comes from `state.roster`.
 */
export function isEntitled(
  audience: Audience | undefined,
  owner: string | undefined,
  viewer: ViewerIdentity,
  state: Snapshot<SessionState>,
): boolean {
  switch (audience) {
    case "public":
      return true;
    case "owner":
      return ownsEntity(owner, viewer, state);
    case "team":
      return sharesTeam(owner, viewer, state);
    default:
      return false;
  }
}

/** `owner` is the viewer's seat, the viewer's team, or the player seated at the viewer's seat. */
function ownsEntity(
  owner: string | undefined,
  viewer: ViewerIdentity,
  state: Snapshot<SessionState>,
): boolean {
  if (owner === undefined || viewer.subject === undefined) return false;
  const seat = getOwn(state.roster.seats, viewer.subject);
  if (seat === undefined) return false;
  return (
    owner === viewer.subject || owner === seat.team || owner === seat.player
  );
}

/**
 * The viewer's seat is on the team of the owner's seat, or the owner is that
 * team. A seat without a team has no teammates (fail closed).
 */
function sharesTeam(
  owner: string | undefined,
  viewer: ViewerIdentity,
  state: Snapshot<SessionState>,
): boolean {
  if (owner === undefined || viewer.subject === undefined) return false;
  const seat = getOwn(state.roster.seats, viewer.subject);
  const team = seat?.team;
  if (team === undefined) return false;
  if (owner === team) return true;
  return Object.entries(state.roster.seats).some(
    ([id, s]) => (id === owner || s.player === owner) && s.team === team,
  );
}
