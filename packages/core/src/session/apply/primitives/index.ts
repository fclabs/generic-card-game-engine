import type { Result } from "../../../errors/result.js";
import type { Action } from "../../actions.js";
import type { ApplyContext } from "../context.js";
import { applyCounterAdjust, applyCounterTransfer } from "./counters.js";
import { applyControlAdvance, applyControlSet } from "./control.js";
import { applyFlip } from "./flip.js";
import { applyGrantView, applyRevokeView } from "./grants.js";
import { applyLifecycle } from "./lifecycle.js";
import { applyMove } from "./move.js";
import { applyMeta } from "./meta.js";
import { applyDelegation, applyRosterReducer } from "./roster.js";
import { applySetMetadata } from "./set-metadata.js";
import { applyShuffle } from "./shuffle.js";
import { applyZoneCreate, applyZoneDestroy } from "./zones.js";

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
      return applyCounterAdjust(ctx, action);
    case "counter_transfer":
      return applyCounterTransfer(ctx, action);
    case "control_set":
      return applyControlSet(ctx, action);
    case "control_advance":
      return applyControlAdvance(ctx, action);
    case "grant_view":
      return applyGrantView(ctx, action);
    case "revoke_view":
      return applyRevokeView(ctx, action);
    case "zone_create":
      return applyZoneCreate(ctx, action);
    case "zone_destroy":
      return applyZoneDestroy(ctx, action);
    case "roster":
      return action.op === "delegate" || action.op === "revoke_delegation"
        ? applyDelegation(ctx, action)
        : applyRosterReducer(ctx, action);
    case "meta":
      return applyMeta(ctx, action);
  }
}
