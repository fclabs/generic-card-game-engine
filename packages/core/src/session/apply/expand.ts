import { ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import { isMacro } from "../actions.js";
import type { Action, Macro } from "../actions.js";
import type { ApplyContext } from "./context.js";

/**
 * Stage 3a: expansion hook. Primitives expand to themselves; macros expand against the
 * working state (KFR-048) in iteration 10. Until then a macro is rejected.
 */
export function expand(
  ctx: ApplyContext,
  action: Action | Macro,
): Result<readonly Action[]> {
  if (isMacro(action)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `macro ${action.kind} is not yet supported`,
      ctx.path(".kind"),
    );
  }
  return ok([action]);
}
