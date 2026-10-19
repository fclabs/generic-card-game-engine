import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stateDigest } from "../replay/canonical/index.js";
import { createSession } from "./create.js";
import { apply } from "./apply/index.js";
import { structuralProblems } from "./apply/invariants.testing.js";
import { findInvariantViolation } from "./apply/invariants.js";
import { MACRO_KINDS, PRIMITIVE_KINDS } from "./actions.js";
import {
  GENERATED_KINDS,
  type GeneratedStep,
  Tape,
  buildPropertyDefinition,
  generateStream,
  propertyRoster,
  propertyStart,
  tapeArbitrary,
} from "./generators.testing.js";
import { isDeepFrozen } from "./snapshot.testing.js";

const RUNS = 1000;
const BATCHES = 6;
const def = buildPropertyDefinition();
const start = propertyStart(def);

interface Tally {
  steps: number;
  failures: number;
  successes: number;
  committedKinds: Set<string>;
  errorCodes: Set<string>;
  inputKinds: Set<string>;
}
const newTally = (): Tally => ({
  steps: 0,
  failures: 0,
  successes: 0,
  committedKinds: new Set(),
  errorCodes: new Set(),
  inputKinds: new Set(),
});
function record(tally: Tally, step: GeneratedStep): void {
  tally.steps += 1;
  for (const action of step.batch) tally.inputKinds.add(action.kind);
  if (step.result.ok) {
    tally.successes += 1;
    for (const c of step.result.value.committed)
      tally.committedKinds.add(c.kind);
  } else {
    tally.failures += 1;
    tally.errorCodes.add(step.result.error.code);
  }
}

describe("property definition fixture", () => {
  it("is a valid definition and the generator kinds list is complete", () => {
    expect(start.seq).toBe(0);
    expect(GENERATED_KINDS).toHaveLength(19);
  });
});

describe("VC-022 / VC-090 atomicity (KNFR-002, KBR-001..011)", () => {
  it(`a failing batch leaves the input reference, digest and freeze untouched (${String(RUNS)} runs)`, () => {
    const tally = newTally();
    fc.assert(
      fc.property(tapeArbitrary, (tape) => {
        const steps = generateStream(def, start, new Tape(tape), BATCHES);
        for (const step of steps) {
          record(tally, step);
          const before = stateDigest(def, step.before);
          const seqBefore = step.before.seq;
          const second = apply(def, step.before, step.batch, step.opts);
          // The input is the same object, still frozen, same digest.
          expect(isDeepFrozen(step.before)).toBe(true);
          expect(stateDigest(def, step.before)).toBe(before);
          expect(step.before.seq).toBe(seqBefore);
          // Purity: a second call gives the same outcome.
          expect(second.ok).toBe(step.result.ok);
          if (!step.result.ok) {
            expect(second.ok).toBe(false);
            if (!second.ok) {
              expect(second.error).toEqual(step.result.error);
              expect(second.error.actionIndex).toBeLessThan(
                Math.max(step.batch.length, 1),
              );
            }
          }
        }
      }),
      { numRuns: RUNS },
    );
    // Both outcomes are exercised in bulk, whatever seed fast-check picked.
    expect(tally.steps).toBe(RUNS * BATCHES);
    expect(tally.failures / tally.steps).toBeGreaterThan(0.1);
    expect(tally.successes / tally.steps).toBeGreaterThan(0.3);
  });

  it("a fixed-seed run exercises every kind and the main error codes", () => {
    const tally = newTally();
    fc.assert(
      fc.property(tapeArbitrary, (tape) => {
        for (const step of generateStream(
          def,
          start,
          new Tape(tape),
          BATCHES,
        )) {
          record(tally, step);
        }
      }),
      { numRuns: RUNS, seed: 20261019 },
    );
    for (const kind of PRIMITIVE_KINDS) {
      expect(tally.committedKinds.has(kind), `committed ${kind}`).toBe(true);
    }
    for (const kind of MACRO_KINDS) {
      expect(tally.inputKinds.has(kind), `input ${kind}`).toBe(true);
    }
    for (const code of [
      "MALFORMED_ACTION",
      "CARD_NOT_IN_ZONE",
      "EMPTY_ZONE",
      "COUNTER_BOUNDS",
      "NOT_YOUR_TURN",
      "GATE_CLOSED",
      "ZONE_LIMIT",
      "SESSION_ENDED",
      "REDUCER_ERROR",
    ]) {
      expect(tally.errorCodes.has(code), `error ${code}`).toBe(true);
    }
  });
});

describe("VC-091 every card in exactly one zone (KBR-001)", () => {
  it(`holds after every successful batch of a random stream (${String(RUNS)} runs)`, () => {
    fc.assert(
      fc.property(tapeArbitrary, (tape) => {
        const steps = generateStream(def, start, new Tape(tape), BATCHES);
        for (const step of steps) {
          if (!step.result.ok) continue;
          const state = step.result.value.state;
          expect(structuralProblems(state)).toEqual([]);
          // Independent count: each card id appears once across all zone member lists.
          const counts = new Map<string, number>();
          for (const zone of Object.values(state.zones)) {
            for (const m of zone.members) {
              counts.set(m, (counts.get(m) ?? 0) + 1);
            }
          }
          expect(counts.size).toBe(Object.keys(state.cards).length);
          for (const n of counts.values()) expect(n).toBe(1);
          // The whole-state re-check (structural rules + counter bounds) also holds.
          expect(findInvariantViolation(def, state)).toBeUndefined();
          expect(isDeepFrozen(state)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe("VC-092 replay of committed actions (KFR-024)", () => {
  it(`reaches the same digest at every step as the live run (${String(RUNS)} runs)`, () => {
    fc.assert(
      fc.property(tapeArbitrary, (tape) => {
        const steps = generateStream(def, start, new Tape(tape), BATCHES);
        const replayStart = createSession(def, start.id, propertyRoster());
        expect(replayStart.ok).toBe(true);
        if (!replayStart.ok) return;
        let replay = replayStart.value;
        expect(stateDigest(def, replay)).toBe(stateDigest(def, start));
        for (const step of steps) {
          if (!step.result.ok) continue;
          // Live digest after this batch vs the replay applying the committed primitives.
          const r = apply(def, replay, step.result.value.committed);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          replay = r.value.state;
          expect(stateDigest(def, replay)).toBe(
            stateDigest(def, step.result.value.state),
          );
          // Replaying primitives commits exactly themselves.
          expect(r.value.committed).toEqual(step.result.value.committed);
          expect(replay.seq).toBe(step.result.value.state.seq);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
