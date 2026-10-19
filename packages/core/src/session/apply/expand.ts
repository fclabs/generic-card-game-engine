import { ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { Action, Macro } from "../actions.js";
import type { ApplyContext } from "./context.js";
import { expandDraw, expandResetToZone, expandZoneMerge } from "./macros.js";

/**
 * Stage 3a: expansion. Primitives expand to themselves; a macro expands to explicit primitives
 * against the working state as it stands now (KFR-048). `apply` applies the result before it
 * expands the next input action. Never writes to the working state.
 */
export function expand(
  ctx: ApplyContext,
  action: Action | Macro,
): Result<readonly Action[]> {
  switch (action.kind) {
    case "draw":
      return expandDraw(ctx, action);
    case "zone_merge":
      return expandZoneMerge(ctx, action);
    case "reset_to_zone":
      return expandResetToZone(ctx, action);
    default:
      return ok([action]);
  }
}
