/** Action-schema versions this build supports (DFR-011). */
export const SUPPORTED_ACTION_SCHEMA_VERSIONS: readonly number[] = [1];

/** Keys valid in `grant_view.keys` and in `view_keys` (DFR-022). */
export const GRANTABLE_VIEW_KEYS: readonly string[] = [
  "card_face",
  "zone_membership",
  "zone_count",
  "zone_order",
];
