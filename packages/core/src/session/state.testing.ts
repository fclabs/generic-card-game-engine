import { deepFreeze } from "./snapshot.js";
import type { Snapshot } from "./snapshot.js";
import type { SessionState } from "./state.js";

/** Strips `readonly` recursively so a test can edit a cloned draft. */
export type Mutable<T> = T extends
  string | number | boolean | bigint | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : { -readonly [K in keyof T]: Mutable<T[K]> };

/** Deep clone of plain data (objects, arrays, primitives incl. bigint). */
export function cloneData<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => cloneData(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = cloneData(item);
  return out as T;
}

/**
 * Test helper: a deep-frozen copy of `state` after `edit` ran on a mutable clone.
 * The input is never touched. Used to hand-construct modified states.
 */
export function variant(
  state: Snapshot<SessionState>,
  edit: (draft: Mutable<SessionState>) => void,
): Snapshot<SessionState> {
  const draft = cloneData(state) as Mutable<SessionState>;
  edit(draft);
  return deepFreeze(draft as SessionState);
}
