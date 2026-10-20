import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type {
  Action,
  ZoneCreateAction,
  ZoneDestroyAction,
} from "../../actions.js";
import { getOwn, hasOwn } from "../../records.js";
import { deriveZoneId, ordinalKey } from "../../zone-ids.js";
import type { ApplyContext } from "../context.js";

const MAX_ID_LENGTH = 128;

/** Whether `owner` exists for a template of the given rule (layout seat, declared team, rostered player). */
function ownerExists(
  ctx: ApplyContext,
  rule: "seat" | "team" | "player",
  owner: string,
): boolean {
  switch (rule) {
    case "seat":
      return hasOwn(ctx.work.state.roster.seats, owner);
    case "team":
      return ctx.def.teams.includes(owner as never);
    case "player":
      return Object.values(ctx.work.state.roster.seats).some(
        (seat) => seat.player === owner,
      );
  }
}

/**
 * `zone_create` (KFR-039, KBR-006). Checks: template, owner rule, `zone_id` equals the derived id,
 * derived id length, collision, then `max_instances` (live zones of the template, all owners;
 * `ZONE_LIMIT`). The logged action records the derived id.
 */
export function applyZoneCreate(
  ctx: ApplyContext,
  action: ZoneCreateAction,
): Result<Action> {
  const template = ctx.index.template(action.template);
  if (template === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown zone template: ${action.template}`,
      ctx.path(".template"),
    );
  }
  if (template.ownerRule === "none") {
    if (action.owner !== undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `template ${template.name} has no owner (owner rule none), got ${action.owner}`,
        ctx.path(".owner"),
      );
    }
  } else if (action.owner === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `template ${template.name} requires a ${template.ownerRule} owner`,
      ctx.path(".owner"),
    );
  } else if (!ownerExists(ctx, template.ownerRule, action.owner)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown ${template.ownerRule} owner: ${action.owner}`,
      ctx.path(".owner"),
    );
  }

  const key = ordinalKey(template.name, action.owner);
  const ordinal = (getOwn(ctx.work.state.zoneOrdinals, key) ?? 0) + 1;
  const derived = deriveZoneId(template.name, action.owner, ordinal);
  if (action.zone_id !== undefined && action.zone_id !== derived) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `zone_id ${action.zone_id} differs from the derived id ${derived}`,
      ctx.path(".zone_id"),
    );
  }
  if (derived.length > MAX_ID_LENGTH) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `derived zone id exceeds ${String(MAX_ID_LENGTH)} characters: ${derived}`,
      ctx.path(".owner"),
    );
  }
  if (ctx.work.zone(derived) !== undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `derived zone id collides with an existing zone: ${derived}`,
      ctx.path(".template"),
    );
  }
  let live = 0;
  for (const zone of Object.values(ctx.work.state.zones)) {
    if (zone.template === template.name) live++;
  }
  if (live >= template.maxInstances) {
    return ctx.fail(
      "ZONE_LIMIT",
      `template ${template.name} already has ${String(live)} of at most ${String(template.maxInstances)} instances`,
      ctx.path(".template"),
    );
  }

  ctx.work.putZone(derived, {
    template: template.name,
    ...(action.owner !== undefined ? { owner: action.owner } : {}),
    members: [],
  });
  ctx.work.patch("zoneOrdinals", key, ordinal);
  return ok({ ...action, zone_id: derived });
}

/** `zone_destroy` (KFR-039): an empty template zone only; its ordinal is never reused. */
export function applyZoneDestroy(
  ctx: ApplyContext,
  action: ZoneDestroyAction,
): Result<Action> {
  const zone = ctx.work.zone(action.zone_id);
  if (zone === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown zone: ${action.zone_id}`,
      ctx.path(".zone_id"),
    );
  }
  if (zone.template === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `zone ${action.zone_id} is not template-instantiated`,
      ctx.path(".zone_id"),
    );
  }
  if (zone.members.length > 0) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `zone ${action.zone_id} is not empty`,
      ctx.path(".zone_id"),
    );
  }
  ctx.work.patch("zones", action.zone_id, undefined);
  return ok(action);
}
