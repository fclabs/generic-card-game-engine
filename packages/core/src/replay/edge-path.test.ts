import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import {
  ROLE_CLASSES,
  buildCase,
  caseOptions,
  caseTape,
} from "../visibility/generators.testing.js";
import type { CaseStep, RoleClass } from "../visibility/generators.testing.js";
import {
  checkIndistinguishable,
  checkNoLeak,
  emptyStats,
} from "../visibility/property-checks.testing.js";
import type {
  CheckStats,
  PropertyInput,
} from "../visibility/property-checks.testing.js";
import { stateDigest } from "./canonical/state-schema.js";
import { advance } from "./replayer.js";

/**
 * VC-379 (edge path): VC-340 (no leak) and VC-343 (indistinguishability) run on states
 * produced by folding `Replayer.advance` batch by batch from the initial state, which is how a
 * Part B edge node fills and advances its cache, with results identical to the live states.
 *
 * `CGE_EDGE_RUNS` sets the generated cases per role class and property (default 500, split
 * over the fixed seeds; the live-state properties of `visibility/properties.test.ts` run 2 000).
 */
const SEEDS = [20261022, 20261023, 20261024, 20261025] as const;
const RUNS = Number(process.env.CGE_EDGE_RUNS ?? "500");
const TIMEOUT = 1_800_000;

/** The input of a generated case with its states re-derived through `advance`. */
function edgeInput(tape: readonly number[], cls: RoleClass): PropertyInput {
  const live = buildCase(tape, caseOptions(cls, true));
  const resolved = {
    definitionId: computeDefinitionId(definitionContentHash(live.def)),
    definition: live.def,
  };
  let state: Snapshot<SessionState> = live.start;
  const states: Snapshot<SessionState>[] = [state];
  const steps: CaseStep[] = [];
  for (const step of live.steps) {
    const next = advance(resolved, state, step.batch);
    if (!next.ok) throw new Error(`advance: ${next.error.detail}`);
    // Identical to what the live session saw: same digest, same state value.
    expect(stateDigest(live.def, next.value)).toBe(
      stateDigest(live.def, step.post),
    );
    expect(next.value).toEqual(step.post);
    steps.push({
      pre: state,
      post: next.value,
      batch: step.batch,
      tx: step.tx,
    });
    states.push(next.value);
    state = next.value;
  }
  return { def: live.def, states, steps, grants: true };
}

describe.each(ROLE_CLASSES)("VC-379 edge path, role class %s", (cls) => {
  const run = (
    name: string,
    check: typeof checkNoLeak,
  ): { cases: number; steps: number; stats: CheckStats } => {
    const stats = emptyStats();
    let cases = 0;
    let steps = 0;
    for (const seed of SEEDS) {
      try {
        fc.assert(
          fc.property(caseTape, (tape) => {
            const input = edgeInput(tape, cls);
            cases += 1;
            steps += input.steps.length;
            check(input, cls, stats);
          }),
          { seed, numRuns: Math.ceil(RUNS / SEEDS.length) },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[${name}] class=${cls} seed=${String(seed)} after ${String(cases)} cases\n${message.slice(0, 1500)}`,
          { cause: error },
        );
      }
    }
    return { cases, steps, stats };
  };

  it(
    "VC-340 no canary leaks on advance-folded states",
    () => {
      const { cases, steps, stats } = run("VC-379/VC-340", checkNoLeak);
      expect(stats.views).toBeGreaterThan(0);
      expect(stats.withheldTokens).toBeGreaterThan(0);
      expect(cases).toBeGreaterThanOrEqual(RUNS);
      expect(steps).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "VC-343 perturbing non-entitled data changes nothing on advance-folded states",
    () => {
      const { cases, stats } = run("VC-379/VC-343", checkIndistinguishable);
      expect(stats.perturbations).toBeGreaterThan(0);
      expect(cases).toBeGreaterThanOrEqual(RUNS);
    },
    TIMEOUT,
  );
});
