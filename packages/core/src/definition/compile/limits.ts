/** Ceilings that depend on the engine configuration (spec §7.4). */
export interface DefinitionLimits {
  /** Ceiling for `policies.cascade_cap`. Default 256. */
  readonly cascadeCapMax: number;
  /** Ceiling for each `policies.cost_budgets` value, when set. */
  readonly costBudgetMax?: number;
}

export const DEFAULT_DEFINITION_LIMITS: DefinitionLimits = {
  cascadeCapMax: 256,
};

/** Structural limits of spec §7.1 (overflow is `LIMIT_EXCEEDED`). */
export const MAX_SEATS = 64;
export const MAX_TEAMS = 32;
export const MAX_ZONES = 1000;
export const MAX_CARDS = 10000;
export const MAX_COUNTERS = 5000;
export const MAX_PHASES = 64;
export const MAX_TEMPLATE_INSTANCES = 256;
/** Template names: no `/`, at most this many characters (DFR-013). */
export const MAX_TEMPLATE_NAME_LENGTH = 48;
/** Maximum length of any id (P1 charset, DFR-027). */
export const MAX_ID_LENGTH = 128;
