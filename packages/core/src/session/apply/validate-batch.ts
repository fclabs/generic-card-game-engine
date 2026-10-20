import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import { validateAction } from "../action-validate.js";
import type { Action, Macro } from "../actions.js";

/**
 * Stage 2: shape validation of the whole input batch (KFR-028), before any state work.
 * Returns fresh normalised copies of every action (the input is never retained). A `lifecycle`
 * that is not the last input action is malformed (KBR-004). Errors carry the input index and `$[i]…` path.
 */
export function validateBatch(
  rawBatch: unknown,
): Result<readonly (Action | Macro)[]> {
  if (!Array.isArray(rawBatch)) {
    return err({
      code: "MALFORMED_ACTION",
      detail: "batch must be an array at $",
      actionIndex: 0,
      path: "$",
    });
  }
  const out: (Action | Macro)[] = [];
  for (let i = 0; i < rawBatch.length; i++) {
    const r = validateAction(rawBatch[i], `$[${String(i)}]`);
    if (!r.ok) return err({ ...r.error, actionIndex: i });
    out.push(r.value);
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i]?.kind === "lifecycle") {
      return err({
        code: "MALFORMED_ACTION",
        detail: `lifecycle must be the last action of its batch at $[${String(i)}]`,
        actionIndex: i,
        path: `$[${String(i)}]`,
      });
    }
  }
  return ok(out);
}
