/**
 * Load-time definition errors (spec DFR-030). These are NOT `EngineError`
 * codes: the closed union of KFR-002 is unchanged.
 */

/** Every code a definition failure can carry (22). */
export const DEFINITION_ERROR_CODES = [
  "YAML_SYNTAX",
  "YAML_TOO_LARGE",
  "YAML_DUPLICATE_KEY",
  "YAML_FORBIDDEN_FEATURE",
  "SCHEMA_UNKNOWN_KEY",
  "SCHEMA_TYPE",
  "SCHEMA_MISSING",
  "INVALID_VALUE",
  "DUPLICATE_ID",
  "UNKNOWN_REFERENCE",
  "INVALID_VISIBILITY",
  "RESERVED_NAME",
  "MISSING_REDUCER",
  "MISSING_HOOK_MODULE",
  "UNKNOWN_HOOK_EXPORT",
  "BUNDLE_MISSING",
  "BUNDLE_INVALID",
  "UNSUPPORTED_SCHEMA_VERSION",
  "LIMIT_EXCEEDED",
  "GAME_YAML_MISSING",
  "GAME_ID_MISMATCH",
  "SEARCH_PATH_MISSING",
] as const;

export type DefinitionErrorCode = (typeof DEFINITION_ERROR_CODES)[number];

export interface DefinitionError {
  readonly code: DefinitionErrorCode;
  /** Path of the offending node (`zones[2].id`); `""` is the document root. */
  readonly path: string;
  readonly detail: string;
  /** The offending entity id, where one exists. */
  readonly entity?: string;
}

/** At most this many errors are kept; further ones set `truncated`. */
export const MAX_DEFINITION_ERRORS = 100;

/**
 * Collects errors in the order they are reported (sections are validated in
 * document order, so this is document order). Later sections call `add`.
 */
export interface ErrorCollector {
  add(
    code: DefinitionErrorCode,
    path: string,
    detail: string,
    entity?: string,
  ): void;
  /** Number of errors kept so far (at most 100). */
  readonly count: number;
  /** True once an error beyond the cap was dropped. */
  readonly truncated: boolean;
  /** Snapshot of the kept errors. */
  errors(): readonly DefinitionError[];
}

export function createErrorCollector(
  max: number = MAX_DEFINITION_ERRORS,
): ErrorCollector {
  const kept: DefinitionError[] = [];
  let truncated = false;
  return {
    add(code, path, detail, entity) {
      if (kept.length >= max) {
        truncated = true;
        return;
      }
      kept.push(
        entity === undefined
          ? { code, path, detail }
          : { code, path, detail, entity },
      );
    },
    get count() {
      return kept.length;
    },
    get truncated() {
      return truncated;
    },
    errors() {
      return kept.slice();
    },
  };
}
