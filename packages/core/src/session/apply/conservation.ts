import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { Action } from "../actions.js";
import type { CompiledGameDefinition } from "../../definition/types.js";
import { getOwn } from "../records.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";
import { adjustApplied, transferChanges } from "./primitives/counters.js";

/** A primitive that was committed, with the input action it stems from. */
export interface CommittedEntry {
  readonly action: Action;
  readonly inputIndex: number;
}

/**
 * Stage 4: end-of-batch conservation (KFR-062, KBR-011), over the working state. For every
 * group the sum after the batch must equal the sum before plus the net `applied` amounts of
 * `counter_adjust` on members that declare a `supply_role` (direction is not enforced in P1).
 * A violation is `COUNTER_BOUNDS` whose `actionIndex` is the last input action whose
 * expansion changed a member of the group (KFR-003).
 */
export function checkConservation(
  def: CompiledGameDefinition,
  base: Snapshot<SessionState>,
  final: Snapshot<SessionState>,
  committed: readonly CommittedEntry[],
): Result<void> {
  if (def.conservationGroups.length === 0) return ok(undefined);
  const decls = new Map(def.counters.map((c) => [c.id as string, c]));
  const changes = committed.map(({ action, inputIndex }) => {
    const list: [string, bigint][] = [];
    if (action.kind === "counter_adjust") {
      const mode = decls.get(action.counter_id)?.rounding;
      list.push([action.counter_id, adjustApplied(action, mode)]);
    } else if (action.kind === "counter_transfer") {
      const mode = decls.get(action.from_counter)?.rounding;
      list.push(...transferChanges(action, mode));
    }
    return { action, inputIndex, list };
  });
  const sum = (state: Snapshot<SessionState>, ids: readonly string[]) =>
    ids.reduce((acc, id) => acc + (getOwn(state.counters, id) ?? 0n), 0n);

  for (const group of def.conservationGroups) {
    const members: ReadonlySet<string> = new Set(group.counters);
    let allowed = 0n;
    let lastChanged = -1;
    for (const { action, inputIndex, list } of changes) {
      for (const [id, by] of list) {
        if (!members.has(id) || by === 0n) continue;
        lastChanged = Math.max(lastChanged, inputIndex);
        if (
          action.kind === "counter_adjust" &&
          decls.get(id)?.supplyRole !== undefined
        ) {
          allowed += by;
        }
      }
    }
    const before = sum(base, group.counters);
    const after = sum(final, group.counters);
    if (after !== before + allowed) {
      return err({
        code: "COUNTER_BOUNDS",
        detail: `conservation group ${group.id} sum changed from ${before.toString()} to ${after.toString()}, expected ${(before + allowed).toString()} (counters: ${group.counters.join(", ")})`,
        actionIndex: Math.max(lastChanged, 0),
      });
    }
  }
  return ok(undefined);
}
