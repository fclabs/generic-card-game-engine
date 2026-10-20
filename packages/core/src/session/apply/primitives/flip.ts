import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, FlipAction } from "../../actions.js";
import type { ApplyContext } from "../context.js";

/** `flip` (KFR-031). Flipping to the current orientation leaves the card record untouched (`===`). */
export function applyFlip(
  ctx: ApplyContext,
  action: FlipAction,
): Result<Action> {
  const card = ctx.work.card(action.card_id);
  if (card === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown card: ${action.card_id}`,
      ctx.path(".card_id"),
    );
  }
  if (card.orientation !== action.orientation) {
    ctx.work.putCard(action.card_id, {
      ...card,
      orientation: action.orientation,
    });
  }
  return ok(action);
}
