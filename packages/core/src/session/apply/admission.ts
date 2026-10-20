import type { CompiledGameDefinition } from "../../definition/types.js";
import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";
import type { ApplyOptions } from "./types.js";

/** A property of an untrusted value, read without invoking getters. */
function peek(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function ended(state: Snapshot<SessionState>) {
  return err({
    code: "SESSION_ENDED" as const,
    detail: `session ${state.id} is ${state.lifecycle}`,
    actionIndex: 0,
  });
}

/**
 * Stage 1: admission against the input state, before any validation or expansion.
 * Lifecycle (KBR-004/009), then turn enforcement (KBR-005). Failures carry `actionIndex 0`.
 */
export function admit(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  rawBatch: unknown,
  opts: ApplyOptions,
): Result<void> {
  if (state.lifecycle === "terminated") return ended(state);
  if (state.lifecycle === "completed") {
    const onlyTerminate =
      Array.isArray(rawBatch) &&
      rawBatch.length === 1 &&
      peek(rawBatch[0], "kind") === "lifecycle" &&
      peek(rawBatch[0], "to_state") === "terminated";
    if (!onlyTerminate) return ended(state);
  }
  const proposal = opts.proposal;
  if (
    proposal !== undefined &&
    def.control.enforceActiveSeats &&
    proposal.origin === "player" &&
    !def.control.outOfTurnKinds.includes(proposal.kind)
  ) {
    const seat = proposal.actingSeat;
    if (seat === undefined) {
      return err({
        code: "NOT_YOUR_TURN",
        detail: `player proposal ${proposal.kind} names no acting seat while active seats are enforced`,
        actionIndex: 0,
      });
    }
    if (!state.control.activeSeats.includes(seat)) {
      return err({
        code: "NOT_YOUR_TURN",
        detail: `seat ${seat} is not an active seat`,
        actionIndex: 0,
      });
    }
  }
  return ok(undefined);
}
