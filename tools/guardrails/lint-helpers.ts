import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, type Linter } from "eslint";
import { determinismConfig } from "../../eslint/determinism.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (worktree). */
export const repoRoot = path.resolve(here, "../..");

const languageOptionsBlock: Linter.Config = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
};

/**
 * ESLint instance for FR-040 lintText checks (N3):
 * overrideConfig = determinismConfig only (syntactic rules; virtual paths OK).
 */
export function createDeterminismLinter(): ESLint {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [languageOptionsBlock, ...determinismConfig],
  });
}

/** ESLint instance loaded from the real eslint.config.mjs (wiring checks). */
export function createRepoLinter(): ESLint {
  return new ESLint({
    cwd: repoRoot,
  });
}

/**
 * Absolute path for calculateConfigForFile.
 * lintText uses repo-relative paths (ESLint matches `files` globs against those).
 */
export function absoluteVirtualPath(virtualFilePath: string): string {
  return path.join(repoRoot, virtualFilePath);
}

/** Repo-relative virtual path for lintText. */
export function relativeVirtualPath(virtualFilePath: string): string {
  return virtualFilePath.replace(/^\.\//, "");
}

/** Narrow calculateConfigForFile result for rule-severity assertions. */
export type CalculatedConfig = {
  rules?: Record<string, Linter.RuleEntry | undefined>;
};

export async function calculatedConfigFor(
  linter: ESLint,
  virtualFilePath: string,
): Promise<CalculatedConfig> {
  const raw: unknown = await linter.calculateConfigForFile(
    absoluteVirtualPath(virtualFilePath),
  );
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const rulesUnknown = (raw as { rules?: unknown }).rules;
  if (typeof rulesUnknown !== "object" || rulesUnknown === null) {
    return {};
  }
  const result: CalculatedConfig = {
    rules: rulesUnknown as NonNullable<CalculatedConfig["rules"]>,
  };
  return result;
}
