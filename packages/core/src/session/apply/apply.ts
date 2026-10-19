import type { CompiledGameDefinition } from "../../definition/types.js";
import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { Action, Macro } from "../actions.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";
import { admit } from "./admission.js";
import { commit, emptyResult } from "./commit.js";
import { checkConservation } from "./conservation.js";
import type { CommittedEntry } from "./conservation.js";
import { makeContext } from "./context.js";
import { indexDefinition } from "./def-index.js";
import { expand } from "./expand.js";
import { applyPrimitive } from "./primitives/index.js";
import type { ApplyOptions, ApplySuccess } from "./types.js";
import { validateBatch } from "./validate-batch.js";
import { WorkingState } from "./working-state.js";

/**
 * The state transition (KFR-020..028): synchronous, pure, atomic. Stages: (1) admission on the
 * input state, (2) shape validation of the whole batch, (3) sequential expansion and primitive
 * application over a copy-on-write working state, (4) end-of-batch conservation, (5) commit.
 * Any failure returns `Err` (`actionIndex` = input index) and the input is never touched.
 * Never throws for caller-triggerable input (KFR-004). `state` must be deep-frozen.
 */
export function apply(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  batch: readonly (Action | Macro)[],
  opts: ApplyOptions = {},
): Result<ApplySuccess> {
  const raw: unknown = batch;

  const admitted = admit(def, state, raw, opts);
  if (!admitted.ok) return admitted;

  const validated = validateBatch(raw);
  if (!validated.ok) return validated;

  const work = new WorkingState(state);
  const shared = { def, index: indexDefinition(def), work, seq: state.seq + 1 };
  const committed: CommittedEntry[] = [];
  for (let inputIndex = 0; inputIndex < validated.value.length; inputIndex++) {
    const action = validated.value[inputIndex];
    if (action === undefined) continue;
    const expanded = expand(
      makeContext(shared, inputIndex, committed.length),
      action,
    );
    if (!expanded.ok) return expanded;
    for (const primitive of expanded.value) {
      const ctx = makeContext(shared, inputIndex, committed.length);
      const applied = applyPrimitive(ctx, primitive);
      if (!applied.ok) return applied;
      committed.push({ action: applied.value, inputIndex });
    }
  }

  if (committed.length === 0) return ok(emptyResult(state));

  const conserved = checkConservation(def, state, work.state, committed);
  if (!conserved.ok) return err(conserved.error);

  return ok(commit(work, committed));
}
