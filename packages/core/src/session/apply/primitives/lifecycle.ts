import { ok } from "../../../errors/result.js";
import type { Result } from "../../../errors/result.js";
import type { Action, LifecycleAction } from "../../actions.js";
import type { ApplyContext } from "../context.js";

/**
 * `lifecycle` (KFR-038, KBR-004): active -> completed | terminated, completed -> terminated.
 * "Last in batch" is enforced by batch validation; ended-session admission runs earlier.
 * An `outcome` is stored (overwriting any earlier one); without it the stored outcome is kept (D-016).
 */
export function applyLifecycle(
  ctx: ApplyContext,
  action: LifecycleAction,
): Result<Action> {
  const from = ctx.work.state.lifecycle;
  const to = action.to_state;
  const legal =
    (from === "active" && (to === "completed" || to === "terminated")) ||
    (from === "completed" && to === "terminated");
  if (!legal) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `illegal lifecycle transition ${from} -> ${to}`,
      ctx.path(".to_state"),
    );
  }
  ctx.work.replace("lifecycle", to);
  if (action.outcome !== undefined) ctx.work.replace("outcome", action.outcome);
  return ok(action);
}
