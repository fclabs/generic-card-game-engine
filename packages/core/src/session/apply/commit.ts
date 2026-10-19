import { deepFreeze } from "../snapshot.js";
import type { Seq } from "../ids.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionEnded, SessionState } from "../state.js";
import type { CommittedEntry } from "./conservation.js";
import type { ApplySuccess } from "./types.js";
import type { WorkingState } from "./working-state.js";

/** `SessionEnded` notifications, one per committed `lifecycle` action (KFR-027). */
function notificationsOf(committed: readonly CommittedEntry[]): SessionEnded[] {
  const out: SessionEnded[] = [];
  for (const { action } of committed) {
    if (action.kind !== "lifecycle" || action.to_state === "active") continue;
    out.push({
      to: action.to_state,
      ...(action.outcome !== undefined ? { outcome: action.outcome } : {}),
    });
  }
  return out;
}

/** Stage 5: `seq + 1`, freeze the new objects only, build the result. */
export function commit(
  work: WorkingState,
  committed: readonly CommittedEntry[],
): ApplySuccess {
  const nextSeq = work.base.seq + 1;
  if (!Number.isSafeInteger(nextSeq)) {
    throw new RangeError("seq would exceed Number.MAX_SAFE_INTEGER (spec A8)");
  }
  const state: Snapshot<SessionState> = work.commit(nextSeq as Seq);
  return Object.freeze({
    state,
    committed: deepFreeze(committed.map((entry) => entry.action)),
    notifications: deepFreeze(notificationsOf(committed)),
  });
}

/** Result of an empty batch: the input state itself, nothing committed (KFR-023). */
export function emptyResult(state: Snapshot<SessionState>): ApplySuccess {
  return Object.freeze({
    state,
    committed: Object.freeze([]),
    notifications: Object.freeze([]),
  });
}
