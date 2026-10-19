import type { Result } from "../../../errors/result.js";
import type { Action } from "../../actions.js";
import type { ApplyContext } from "../context.js";
import { applyFlip } from "./flip.js";
import { applyLifecycle } from "./lifecycle.js";
import { applyMove } from "./move.js";
import { applySetMetadata } from "./set-metadata.js";
import { applyShuffle } from "./shuffle.js";

/**
 * Stage 3b: applies one validated primitive to the working state and returns the action to
 * log (normally the action itself; iterations 8+ return it with derived ids filled in).
 * Each later action kind plugs in as one `case` below plus one file in this folder.
 */
export function applyPrimitive(
  ctx: ApplyContext,
  action: Action,
): Result<Action> {
  switch (action.kind) {
    case "move":
      return applyMove(ctx, action);
    case "flip":
      return applyFlip(ctx, action);
    case "shuffle":
      return applyShuffle(ctx, action);
    case "set_metadata":
      return applySetMetadata(ctx, action);
    case "lifecycle":
      return applyLifecycle(ctx, action);
    case "counter_adjust":
    case "counter_transfer":
    case "control_set":
    case "control_advance":
    case "grant_view":
    case "revoke_view":
    case "zone_create":
    case "zone_destroy":
    case "roster":
    case "meta":
      return ctx.fail(
        "MALFORMED_ACTION",
        `action kind ${action.kind} is not yet supported`,
        ctx.path(".kind"),
      );
  }
}
