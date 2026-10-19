import { ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { Action } from "../actions.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";

/** A primitive that was committed, with the input action it stems from. */
export interface CommittedEntry {
  readonly action: Action;
  readonly inputIndex: number;
}

/**
 * Stage 4: end-of-batch conservation (KBR-011). Hook point only until iteration 7.
 * It receives the base and final states and the committed entries so it can report the
 * last input index that touched a group member (KFR-003).
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- hook point; parameters are used from iteration 7 */
export function checkConservation(
  _def: CompiledGameDefinition,
  _base: Snapshot<SessionState>,
  _final: Snapshot<SessionState>,
  _committed: readonly CommittedEntry[],
): Result<void> {
  return ok(undefined);
}
