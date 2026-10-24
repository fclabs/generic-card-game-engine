import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import {
  ROLE_CLASSES,
  buildCase,
  caseOptions,
  caseTape,
} from "./generators.testing.js";
import type { RoleClass, VisibilityCase } from "./generators.testing.js";
import {
  checkCompleteness,
  checkConsistency,
  checkErrorDetails,
  checkIndistinguishable,
  checkMutationGuard,
  checkNoLeak,
  emptyStats,
} from "./property-checks.testing.js";
import type { CheckStats, PropertyInput } from "./property-checks.testing.js";

/**
 * Phase 3 visibility properties (PNFR-001, PBR-008, PBR-010; VC-340..344, VC-376).
 *
 * Knobs (environment):
 * - `CGE_VISIBILITY_RUNS`: generated cases per role class and property (default 2000, the
 *   PNFR-001 floor), split evenly over the fixed seed list. VC-344 and VC-376, which check
 *   one fixed behaviour per case, run at most 500 cases per class by default.
 * - `CGE_VISIBILITY_SEED`: run one seed of the list only (use it to re-run a failing seed;
 *   the failure message names the seed, the role class and the property).
 *
 * Every failure is rethrown with `property`, `class` and `seed`, so
 * `CGE_VISIBILITY_SEED=<seed> pnpm exec vitest run packages/core/src/visibility/properties.test.ts`
 * reproduces it deterministically.
 */
export const SEEDS: readonly number[] = [
  20261022, 20261023, 20261024, 20261025,
];
const RUNS = Number(process.env.CGE_VISIBILITY_RUNS ?? "2000");
const ONLY = process.env.CGE_VISIBILITY_SEED;
const seeds =
  ONLY === undefined ? SEEDS : SEEDS.filter((s) => String(s) === ONLY);

type Check = (input: PropertyInput, cls: RoleClass, stats: CheckStats) => void;

const report: string[] = [];

function run(
  name: string,
  cls: RoleClass,
  check: Check,
  options: { grants: boolean; runs?: number },
): { cases: number; stats: CheckStats } {
  const stats = emptyStats();
  let cases = 0;
  const perSeed = Math.ceil((options.runs ?? RUNS) / SEEDS.length);
  for (const seed of seeds) {
    try {
      fc.assert(
        fc.property(caseTape, (tape) => {
          const c: VisibilityCase = buildCase(
            tape,
            caseOptions(cls, options.grants),
          );
          cases += 1;
          check(
            {
              def: c.def,
              states: c.states,
              steps: c.steps,
              grants: options.grants,
            },
            cls,
            stats,
          );
        }),
        { seed, numRuns: perSeed },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const inner = error instanceof Error ? error.cause : undefined;
      const cause = inner instanceof Error ? inner.message : message;
      const tape = /Counterexample: \[(\[.*\])\]/.exec(message)?.[1] ?? "";
      throw new Error(
        `[${name}] class=${cls} seed=${String(seed)} after ${String(cases)} cases (grants=${String(options.grants)})\n${cause.slice(0, 1500)}\nshrunk tape: ${tape.slice(0, 1200)}`,
        { cause: error },
      );
    }
  }
  report.push(
    `${name} class=${cls} grants=${String(options.grants)} cases=${String(cases)} views=${String(stats.views)} deltas=${String(stats.deltas)} withheld=${String(stats.withheldTokens)} perturbations=${String(stats.perturbations)} facts=${JSON.stringify(stats.facts)} grantFacts=${String(stats.grantFacts)}`,
  );
  return { cases, stats };
}

const floorOf = (runs: number): number =>
  Math.floor(runs / SEEDS.length) * seeds.length;
const floor = floorOf(RUNS);
/** The cheap guards (VC-344, VC-376) run at most this many cases per class by default. */
const GUARD_RUNS = Math.min(RUNS, 500);

afterAll(() => {
  console.info(
    `visibility properties (runs/class=${String(RUNS)}, seeds=${seeds.join(",")})\n${report.join("\n")}`,
  );
});

const TIMEOUT = 1_800_000;

describe.each(ROLE_CLASSES)("role class %s", (cls) => {
  it(
    "VC-340 no canary leaks through View, Delta or log entry",
    () => {
      const { cases, stats } = run("VC-340", cls, checkNoLeak, {
        grants: true,
      });
      expect(cases).toBeGreaterThanOrEqual(floor);
      expect(stats.views).toBeGreaterThan(0);
      expect(stats.deltas).toBeGreaterThan(0);
      // Not vacuous: the data held canaries the outputs withheld.
      expect(stats.withheldTokens).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "VC-341 the view is exactly the oracle's entitlement",
    () => {
      const { cases, stats } = run("VC-341", cls, checkCompleteness, {
        grants: true,
      });
      expect(cases).toBeGreaterThanOrEqual(floor);
      // Not vacuous: the oracle predicted real content, not an empty view.
      for (const kind of ["zone", "counter", "meta", "gate"]) {
        expect(stats.facts[kind] ?? 0, `${kind} facts`).toBeGreaterThan(0);
      }
      if (cls !== "dealer" && cls !== "auditor") {
        expect(stats.grantFacts).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    "VC-342 deltas fold onto views (whole stream without grants)",
    () => {
      const strict = run("VC-342", cls, checkConsistency, { grants: false });
      expect(strict.cases).toBeGreaterThanOrEqual(floor);
    },
    TIMEOUT,
  );

  it(
    "VC-342 deltas fold onto views (per step, static facts, with grants)",
    () => {
      const { cases } = run("VC-342", cls, checkConsistency, { grants: true });
      expect(cases).toBeGreaterThanOrEqual(floor);
    },
    TIMEOUT,
  );

  it(
    "VC-343 perturbing non-entitled data changes nothing",
    () => {
      const { cases, stats } = run("VC-343", cls, checkIndistinguishable, {
        grants: true,
      });
      expect(cases).toBeGreaterThanOrEqual(floor);
      expect(stats.perturbations).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "VC-344 mutating an output leaves state and later projections intact",
    () => {
      const { cases } = run("VC-344", cls, checkMutationGuard, {
        grants: true,
        runs: GUARD_RUNS,
      });
      expect(cases).toBeGreaterThanOrEqual(floorOf(GUARD_RUNS));
    },
    TIMEOUT,
  );

  it(
    "VC-376 errors name only what the caller supplied",
    () => {
      const { cases } = run("VC-376", cls, checkErrorDetails, {
        grants: true,
        runs: GUARD_RUNS,
      });
      expect(cases).toBeGreaterThanOrEqual(floorOf(GUARD_RUNS));
    },
    TIMEOUT,
  );
});
