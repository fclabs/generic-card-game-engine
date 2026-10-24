import type { Delta, DeltaSections } from "./types.js";

/**
 * Section order of a `Delta` (spec §7.2). Optional sections are present only
 * when something changed.
 */
export const DELTA_SECTION_ORDER = [
  "seq",
  "entries",
  "zoneCounts",
  "counters",
  "control",
  "roster",
  "meta",
  "gates",
  "grants",
  "lifecycle",
  "outcome",
] as const;

/**
 * The single place a `Delta` value is created. Keys are inserted in
 * `DELTA_SECTION_ORDER`; an `undefined` section is omitted (never an
 * `undefined` property).
 */
export function makeDelta(sections: DeltaSections): Delta {
  const delta: Record<string, unknown> = {};
  for (const key of DELTA_SECTION_ORDER) {
    const value = sections[key];
    if (value !== undefined) delta[key] = value;
  }
  return delta as unknown as Delta;
}
