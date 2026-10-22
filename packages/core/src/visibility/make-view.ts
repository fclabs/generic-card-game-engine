import type { View } from "./types.js";

/**
 * Section order of a `View` (PFR-011, PFR-021). `outcome` is last and present
 * only once the session has one.
 */
export const VIEW_SECTION_ORDER = [
  "seq",
  "lifecycle",
  "viewer",
  "zones",
  "counters",
  "control",
  "roster",
  "meta",
  "gates",
  "grants",
  "outcome",
] as const;

/**
 * The single place a `View` value is created. Keys are inserted in
 * `VIEW_SECTION_ORDER`; `outcome` is omitted when undefined (never an
 * `undefined` property, PFR-021).
 */
export function makeView(sections: View): View {
  const view: Record<string, unknown> = {};
  for (const key of VIEW_SECTION_ORDER) {
    const value = sections[key];
    if (value !== undefined) view[key] = value;
  }
  return view as unknown as View;
}
