import { SUPPORTED_ACTION_SCHEMA_VERSIONS } from "../definition/compile/constants.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { JsonValue } from "../session/state.js";
import { replayError } from "./replay-error.js";
import type { ReplayError } from "./replay-error.js";

/**
 * One schema-evolution step (spec PFR-050, §7.4): turns the raw JSON of a package recorded
 * under action-schema version `from` into the raw JSON of version `to` (`to = from + 1`).
 * Pure: it must not mutate `raw` and must not read the clock, randomness or the environment.
 * It may rewrite any part of the package (log actions, `initial`, `params`); the chain sets
 * `actionSchemaVersion` itself after each step.
 */
export interface PackageUpgrader {
  readonly from: number;
  readonly to: number;
  readonly upgrade: (raw: JsonValue) => Result<JsonValue, string>;
}

/** The version set and chain a replayer works with (PFR-053). */
export interface UpgradePolicy {
  readonly versions: {
    readonly current: number;
    readonly supported: readonly number[];
  };
  readonly upgraders: readonly PackageUpgrader[];
}

/**
 * The action-schema version this engine writes: the maximum of
 * `SUPPORTED_ACTION_SCHEMA_VERSIONS` (`1` at this phase, PFR-050).
 */
export const CURRENT_ACTION_SCHEMA_VERSION: number = Math.max(
  ...SUPPORTED_ACTION_SCHEMA_VERSIONS,
);

/**
 * The shipped chain, ordered by `from`. Append-only (PBR-005): a version is never dropped
 * without a later spec that declares a breaking change. Empty while only version 1 exists;
 * see CONTEXT.md ("How to add an action-schema version") for the bump checklist.
 */
export const PACKAGE_UPGRADERS: readonly PackageUpgrader[] = [];

/**
 * Validates a version set and chain (PFR-050). Returns `null` when valid, otherwise the first
 * violation as a message naming the version. Valid means: `supported` is non-empty and its
 * maximum is `current`; the upgraders, in list order, start at the lowest supported version,
 * are contiguous (one per step, `to = from + 1`) and end at `current`, so that every supported
 * version below `current` has an upgrader.
 */
export function assertUpgraderChain(
  supported: readonly number[],
  current: number,
  upgraders: readonly PackageUpgrader[],
): string | null {
  if (supported.length === 0) return "no supported action_schema_version";
  if (!supported.includes(current)) {
    return `current version ${String(current)} is not a supported version`;
  }
  const above = supported.find((v) => v > current);
  if (above !== undefined) {
    return `supported version ${String(above)} is above current version ${String(current)}`;
  }
  const lowest = Math.min(...supported);
  const seen = new Set<number>();
  for (let i = 0; i < upgraders.length; i++) {
    const u = upgraders[i];
    if (u === undefined) continue;
    const expected = lowest + i;
    if (u.to !== u.from + 1) {
      return `upgrader from version ${String(u.from)} must have to ${String(u.from + 1)}, got ${String(u.to)}`;
    }
    if (seen.has(u.from)) {
      return `duplicate upgrader from version ${String(u.from)}`;
    }
    seen.add(u.from);
    if (u.from >= current) {
      return `upgrader from version ${String(u.from)} is not below current version ${String(current)}`;
    }
    if (u.from !== expected) {
      return `no upgrader from version ${String(expected)}`;
    }
  }
  if (upgraders.length < current - lowest) {
    return `no upgrader from version ${String(lowest + upgraders.length)}`;
  }
  return null;
}

function unsupported(version: number): ReplayError {
  return replayError(
    "REPLAY_MISMATCH",
    0,
    `unsupported action_schema_version ${String(version)}`,
    { path: "actionSchemaVersion" },
  );
}

/** A deep copy of a JSON value, so an upgrader can never alias (or mutate) the caller's data. */
function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return (value as readonly JsonValue[]).map(cloneJson);
  }
  const out: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) {
    Object.defineProperty(out, key, {
      value: cloneJson(member),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** `raw.actionSchemaVersion` when `raw` is an object whose version is a safe integer. */
export function rawActionSchemaVersion(raw: JsonValue): number | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const v = (raw as { readonly [key: string]: JsonValue })[
    "actionSchemaVersion"
  ];
  return typeof v === "number" && Number.isSafeInteger(v) ? v : undefined;
}

const DEFAULT_POLICY: UpgradePolicy = {
  versions: {
    current: CURRENT_ACTION_SCHEMA_VERSION,
    supported: SUPPORTED_ACTION_SCHEMA_VERSIONS,
  },
  upgraders: PACKAGE_UPGRADERS,
};

/**
 * Upgrades the raw JSON of a package to the current action-schema version (PFR-051), running
 * the chain over the JSON before any schema decoding (the old shape cannot be decoded by the
 * current schema). Pure and non-mutating: upgraders work on a deep copy and `raw` is never
 * changed. The result carries `actionSchemaVersion` = current.
 *
 * - `raw` without an integer `actionSchemaVersion` is returned unchanged (the decoder reports it).
 * - A version equal to current is returned as is (not copied).
 * - A version outside `supported`, above current, or with no upgrader path -> `REPLAY_MISMATCH`
 *   `unsupported action_schema_version <n>` at seq 0 (PFR-052).
 * - An upgrader that returns an error string, throws, or returns a non-object ->
 *   `REPLAY_INVALID` at seq 0 carrying the message.
 */
export function upgradeToCurrent(
  raw: JsonValue,
  policy: UpgradePolicy = DEFAULT_POLICY,
): Result<JsonValue, ReplayError> {
  const version = rawActionSchemaVersion(raw);
  if (version === undefined) return ok(raw);
  const { current, supported } = policy.versions;
  if (version === current) return ok(raw);
  if (version > current || !supported.includes(version)) {
    return err(unsupported(version));
  }
  let value = cloneJson(raw);
  for (let v = version; v < current; v++) {
    const step = policy.upgraders.find((u) => u.from === v);
    if (step === undefined || step.to !== v + 1)
      return err(unsupported(version));
    let result: Result<JsonValue, string>;
    try {
      result = step.upgrade(value);
    } catch (error) {
      return err(
        replayError(
          "REPLAY_INVALID",
          0,
          `upgrader ${String(v)} -> ${String(v + 1)} threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    if (!result.ok) return err(replayError("REPLAY_INVALID", 0, result.error));
    const next = result.value;
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      return err(
        replayError(
          "REPLAY_INVALID",
          0,
          `upgrader ${String(v)} -> ${String(v + 1)} did not return a package object`,
        ),
      );
    }
    value = { ...next, actionSchemaVersion: v + 1 };
  }
  return ok(value);
}
