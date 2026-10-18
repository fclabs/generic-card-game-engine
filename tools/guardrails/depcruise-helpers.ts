import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cruise,
  type IConfiguration,
  type ICruiseResult,
} from "dependency-cruiser";
import extractDepcruiseConfig from "dependency-cruiser/config-utl/extract-depcruise-config";
import extractTsConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { repoRoot } from "./lint-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to fixtures/depcruise/<caseId>. */
export function fixtureCaseDir(caseId: string): string {
  return path.join(here, "fixtures", "depcruise", caseId);
}

/** Repo-relative path to fixtures/depcruise/<caseId> (cruise input). */
export function fixtureCaseRel(caseId: string): string {
  return path.relative(repoRoot, fixtureCaseDir(caseId));
}

export type CruiseViolationSummary = {
  ruleNames: Set<string>;
  violations: ReadonlyArray<{
    ruleName: string;
    from: string;
    to: string;
  }>;
};

let cachedConfig: IConfiguration | undefined;
let cachedTsConfig: ReturnType<typeof extractTsConfig> | undefined;

async function loadRealConfig(): Promise<{
  config: IConfiguration;
  tsConfig: ReturnType<typeof extractTsConfig>;
}> {
  if (cachedConfig !== undefined && cachedTsConfig !== undefined) {
    return { config: cachedConfig, tsConfig: cachedTsConfig };
  }
  cachedConfig = await extractDepcruiseConfig(
    path.join(repoRoot, ".dependency-cruiser.cjs"),
  );
  cachedTsConfig = extractTsConfig(path.join(repoRoot, "tsconfig.json"));
  return { config: cachedConfig, tsConfig: cachedTsConfig };
}

function asCruiseResult(output: unknown): ICruiseResult {
  if (typeof output === "string") {
    return JSON.parse(output) as ICruiseResult;
  }
  return output as ICruiseResult;
}

/**
 * Run dependency-cruiser's API over a fixture case tree with the **real**
 * `.dependency-cruiser.cjs` forbidden rules.
 *
 * CRITICAL (D-014 / Iteration 4): override `exclude` so paths under
 * `tools/guardrails/fixtures/` are not skipped by the production exclude.
 */
export async function cruiseFixtureCase(
  caseId: string,
): Promise<CruiseViolationSummary> {
  const { config, tsConfig } = await loadRealConfig();
  const caseRel = fixtureCaseRel(caseId);

  const result = await cruise(
    [caseRel],
    {
      ...config.options,
      // Keep coverage/tsbuildinfo out; do NOT exclude fixtures (N7 override).
      exclude: { path: "coverage|\\.tsbuildinfo$" },
      ruleSet: { forbidden: config.forbidden ?? [] },
      validate: true,
    },
    undefined,
    { tsConfig },
  );

  const parsed = asCruiseResult(result.output);
  const raw = parsed.summary.violations;
  const violations = raw
    .map((v) => ({
      ruleName: v.rule.name,
      from: v.from,
      to: "to" in v ? String(v.to) : "",
    }))
    .filter((v) => v.ruleName.length > 0);

  return {
    ruleNames: new Set(violations.map((v) => v.ruleName)),
    violations,
  };
}

/** Stable sorted list for assertion messages. */
export function sortedRuleNames(names: Iterable<string>): string[] {
  return [...names].sort();
}
