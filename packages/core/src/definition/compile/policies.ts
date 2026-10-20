import type { PolicyDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import type { DefinitionLimits } from "./limits.js";
import {
  has,
  joinPath,
  member,
  readInteger,
  readIntegerInRange,
  readObject,
} from "./strict.js";

export const DEFAULT_CASCADE_CAP = 16;
const COST_BUDGET_KEYS = [
  "validation",
  "reaction",
  "gate_resolve",
  "authorization",
] as const;

/**
 * Compiles `policies` (DFR-025). `cascade_cap` is an integer in `[1, 256]`
 * (default 16) not above `limits.cascadeCapMax`; `cost_budgets` values are
 * positive integers not above `limits.costBudgetMax`. A value above a ceiling
 * is `LIMIT_EXCEEDED`. Returns `undefined` when anything was reported.
 */
export function compilePolicies(
  c: ErrorCollector,
  raw: unknown,
  path: string,
  limits: DefinitionLimits,
): PolicyDecl | undefined {
  const before = c.count;
  const obj = readObject(c, raw, path, ["cascade_cap", "cost_budgets"]);
  if (obj === undefined) return undefined;
  let cascadeCap = DEFAULT_CASCADE_CAP;
  if (has(obj, "cascade_cap")) {
    const p = joinPath(path, "cascade_cap");
    const v = readIntegerInRange(c, member(obj, "cascade_cap"), p, 1, 256);
    if (v !== undefined) {
      if (v > limits.cascadeCapMax) {
        c.add(
          "LIMIT_EXCEEDED",
          p,
          `cascade_cap ${v} exceeds the engine ceiling ${limits.cascadeCapMax}`,
        );
      } else cascadeCap = v;
    }
  }
  const costBudgets: Record<string, number> = {};
  if (has(obj, "cost_budgets")) {
    const bp = joinPath(path, "cost_budgets");
    const budgets = readObject(c, member(obj, "cost_budgets"), bp, [
      ...COST_BUDGET_KEYS,
    ]);
    if (budgets !== undefined) {
      for (const key of COST_BUDGET_KEYS) {
        if (!has(budgets, key)) continue;
        const p = joinPath(bp, key);
        const v = readInteger(c, member(budgets, key), p);
        if (v === undefined) continue;
        if (v < 1) {
          c.add("INVALID_VALUE", p, `cost budget must be positive, got ${v}`);
        } else if (
          limits.costBudgetMax !== undefined &&
          v > limits.costBudgetMax
        ) {
          c.add(
            "LIMIT_EXCEEDED",
            p,
            `cost budget ${v} exceeds the engine ceiling ${limits.costBudgetMax}`,
          );
        } else costBudgets[key] = v;
      }
    }
  }
  return c.count === before ? { cascadeCap, costBudgets } : undefined;
}
