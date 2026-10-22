/**
 * Test-only schema evolution used by `upgrade.test.ts` (never shipped, never in
 * `PACKAGE_UPGRADERS`): a pretend version-1 shape in which `counter_adjust` named its amount
 * `by`, and the 1 -> 2 upgrader that renames it to `delta`. `legacy-v1-package.json` is the
 * committed golden package rewritten in that shape; upgrading it must give back
 * `golden-package.json` with only `actionSchemaVersion` changed.
 */
import { err, ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type { JsonValue } from "../../session/state.js";
import type { PackageUpgrader } from "../upgrade.js";

type Obj = { [key: string]: JsonValue };

function rewriteCounterAdjust(
  raw: JsonValue,
  from: string,
  to: string,
): Result<JsonValue, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err("package is not an object");
  }
  const pkg = raw as Obj;
  const log = pkg["log"];
  if (!Array.isArray(log)) return err("package has no log");
  const newLog: JsonValue[] = [];
  for (const tx of log as readonly JsonValue[]) {
    const entry = tx as Obj;
    const actions = entry["actions"];
    if (!Array.isArray(actions)) return err("transaction has no actions");
    newLog.push({
      ...entry,
      actions: (actions as readonly JsonValue[]).map((a) => {
        const action = a as Obj;
        if (action["kind"] !== "counter_adjust") return a;
        const { [from]: amount, ...rest } = action;
        return amount === undefined ? a : { ...rest, [to]: amount };
      }),
    });
  }
  return ok({ ...pkg, log: newLog });
}

/** Pure: builds new objects, never touches its input. */
export const TEST_UPGRADER_1_TO_2: PackageUpgrader = {
  from: 1,
  to: 2,
  upgrade: (raw) => rewriteCounterAdjust(raw, "by", "delta"),
};

/** The inverse rewrite, used to prove the legacy fixture is exactly the golden package, aged. */
export function ageToLegacyV1(raw: JsonValue): JsonValue {
  const r = rewriteCounterAdjust(raw, "delta", "by");
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** A 2 -> 3 and 3 -> 4 step that only bump the version, for chain-order tests. */
export function bumpUpgrader(from: number): PackageUpgrader {
  return {
    from,
    to: from + 1,
    upgrade: (raw) => {
      const pkg = raw as Obj;
      const old = pkg["trail"];
      const trail: JsonValue[] = Array.isArray(old)
        ? [...(old as readonly JsonValue[])]
        : [];
      return ok({ ...pkg, trail: [...trail, from] });
    },
  };
}
