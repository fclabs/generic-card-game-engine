import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, MoveAction } from "../../actions.js";
import type { ApplyContext } from "../context.js";

/**
 * `move` (KFR-030, KBR-001/002). Position 0 is the top of an ordered zone. For a same-zone
 * move the position is read after the card is removed. Keeps KBR-001 by construction: the
 * card leaves one `members` list and enters exactly one, and `card.zone` follows.
 */
export function applyMove(
  ctx: ApplyContext,
  action: MoveAction,
): Result<Action> {
  const { work, index } = ctx;
  const card = work.card(action.card_id);
  if (card === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown card: ${action.card_id}`,
      ctx.path(".card_id"),
    );
  }
  const to = work.zone(action.to_zone);
  if (to === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown zone: ${action.to_zone}`,
      ctx.path(".to_zone"),
    );
  }
  const from = work.zone(action.from_zone);
  const at = from === undefined ? -1 : from.members.indexOf(action.card_id);
  if (from === undefined || card.zone !== action.from_zone || at < 0) {
    return ctx.fail(
      "CARD_NOT_IN_ZONE",
      `card ${action.card_id} is not in zone ${action.from_zone}`,
    );
  }
  const rest = [...from.members.slice(0, at), ...from.members.slice(at + 1)];
  const same = action.from_zone === action.to_zone;
  const target = same ? rest : to.members;
  const position = action.to_position;
  let members;
  if (index.isOrdered(action.to_zone, to)) {
    if (position === undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `to_position is required for ordered zone ${action.to_zone}`,
        ctx.path(".to_position"),
      );
    }
    if (position > target.length) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `to_position ${String(position)} is out of bounds for zone ${action.to_zone} (max ${String(target.length)})`,
        ctx.path(".to_position"),
      );
    }
    members = [
      ...target.slice(0, position),
      action.card_id,
      ...target.slice(position),
    ];
  } else {
    if (position !== undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `to_position is not allowed for unordered zone ${action.to_zone}`,
        ctx.path(".to_position"),
      );
    }
    members = [...target, action.card_id];
  }
  if (same) {
    work.putZone(action.to_zone, { ...to, members });
  } else {
    work.putZone(action.from_zone, { ...from, members: rest });
    work.putZone(action.to_zone, { ...to, members });
    work.putCard(action.card_id, { ...card, zone: action.to_zone });
  }
  return ok(action);
}
