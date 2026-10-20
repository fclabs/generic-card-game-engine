import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, ShuffleAction } from "../../actions.js";
import type { ApplyContext } from "../context.js";

/**
 * `shuffle` (KFR-032, KBR-003): the zone's order becomes exactly the logged permutation.
 * This module, like the whole of `apply`, never imports or consults the PRNG (KFR-082).
 */
export function applyShuffle(
  ctx: ApplyContext,
  action: ShuffleAction,
): Result<Action> {
  const zone = ctx.work.zone(action.zone);
  if (zone === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown zone: ${action.zone}`,
      ctx.path(".zone"),
    );
  }
  if (!ctx.index.isOrdered(action.zone, zone)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `zone ${action.zone} is unordered and cannot be shuffled`,
      ctx.path(".zone"),
    );
  }
  const { permutation } = action;
  if (permutation.length !== zone.members.length) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `permutation of zone ${action.zone} has ${String(permutation.length)} ids, the zone holds ${String(zone.members.length)}`,
      ctx.path(".permutation"),
    );
  }
  const members = new Set<string>(zone.members);
  const seen = new Set<string>();
  for (let i = 0; i < permutation.length; i++) {
    const id = permutation[i];
    if (id === undefined) continue;
    if (!members.has(id)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `permutation names card ${id}, which is not in zone ${action.zone}`,
        ctx.path(`.permutation[${String(i)}]`),
      );
    }
    if (seen.has(id)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `permutation repeats card ${id}`,
        ctx.path(`.permutation[${String(i)}]`),
      );
    }
    seen.add(id);
  }
  ctx.work.putZone(action.zone, { ...zone, members: [...permutation] });
  return ok(action);
}
