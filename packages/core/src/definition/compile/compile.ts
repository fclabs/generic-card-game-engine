import type { CompiledGameDefinition } from "../types.js";
import {
  GRANTABLE_VIEW_KEYS,
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
} from "./constants.js";
import type { DefinitionError } from "./errors.js";
import { createErrorCollector } from "./errors.js";
import { isValidGameId } from "./ids.js";
import type { DefinitionLimits } from "./limits.js";
import { compileSeats } from "./seats.js";
import { has, member, readInteger, readObject, readString } from "./strict.js";

/** Bundle facts the compiler needs (spec §7.3); used from iteration 4. */
export interface HookBundleInfo {
  readonly hash: string;
  readonly exports: readonly string[];
}

export interface CompileContext {
  readonly bundle?: HookBundleInfo;
  readonly limits?: DefinitionLimits;
}

export type CompileResult =
  | { readonly ok: true; readonly value: CompiledGameDefinition }
  | {
      readonly ok: false;
      readonly errors: readonly DefinitionError[];
      readonly truncated: boolean;
    };

/** Top-level keys in the order their sections are validated (spec §7.1). */
export const SECTION_ORDER = [
  "id",
  "action_schema_version",
  "roles",
  "seats",
  "zones",
  "cards",
  "counters",
  "conservation_groups",
  "control",
  "meta_schemas",
  "roster_reducer",
  "view_keys",
  "hooks",
  "policies",
] as const;

export type SectionKey = (typeof SECTION_ORDER)[number];

/**
 * Sections still accepted as absent and compiled to their defaults (their
 * content is not yet read). Iterations 3 and 4 remove entries as they land.
 */
export const UNIMPLEMENTED_SECTIONS: readonly SectionKey[] = [
  "roles",
  "zones",
  "cards",
  "counters",
  "conservation_groups",
  "control",
  "meta_schemas",
  "roster_reducer",
  "view_keys",
  "hooks",
  "policies",
];

const REQUIRED_SECTIONS: readonly SectionKey[] = [
  "id",
  "action_schema_version",
  "seats",
];

/**
 * Compiles a parsed `game.yaml` value (spec DFR-010). Pure and total: never
 * throws, whatever `raw` is. Errors are collected in section order (at most
 * 100; `truncated` when more existed).
 */
export function compileDefinition(
  raw: unknown,
  // Read by sections added in iterations 3-4 (limits, bundle).
  ctx: CompileContext = {},
): CompileResult {
  void ctx;
  const c = createErrorCollector();
  try {
    const root = readObject(c, raw, "", SECTION_ORDER, REQUIRED_SECTIONS);
    let gameId: string | undefined;
    let schemaVersion: number | undefined;
    let seats: ReturnType<typeof compileSeats>;
    if (root !== undefined) {
      if (has(root, "id")) {
        const id = readString(c, member(root, "id"), "id");
        if (id !== undefined) {
          if (isValidGameId(id)) gameId = id;
          else {
            c.add(
              "INVALID_VALUE",
              "id",
              "id must match ^[a-z0-9][a-z0-9_-]{0,63}$",
              id,
            );
          }
        }
      }
      if (has(root, "action_schema_version")) {
        const v = readInteger(
          c,
          member(root, "action_schema_version"),
          "action_schema_version",
        );
        if (v !== undefined) {
          if (SUPPORTED_ACTION_SCHEMA_VERSIONS.includes(v)) schemaVersion = v;
          else {
            c.add(
              "UNSUPPORTED_SCHEMA_VERSION",
              "action_schema_version",
              `unsupported action_schema_version ${v}; supported: ${SUPPORTED_ACTION_SCHEMA_VERSIONS.join(", ")}`,
            );
          }
        }
      }
      if (has(root, "seats")) {
        seats = compileSeats(c, member(root, "seats"), "seats");
      }
    }
    if (
      c.count > 0 ||
      gameId === undefined ||
      schemaVersion === undefined ||
      seats === undefined
    ) {
      return { ok: false, errors: c.errors(), truncated: c.truncated };
    }
    const seatIds = seats.seats.map((s) => s.id);
    const first = seatIds[0];
    const value: CompiledGameDefinition = {
      gameId,
      roles: [],
      schemaVersion,
      cards: [],
      zones: [],
      zoneTemplates: [],
      counters: [],
      conservationGroups: [],
      seats: seats.seats,
      teams: seats.teams,
      viewKeys: [...GRANTABLE_VIEW_KEYS],
      control: {
        phases: ["main"],
        initialPhase: "main",
        turnOrder: seatIds,
        initialActiveSeats: first === undefined ? [] : [first],
        pointerNames: [],
        enforceActiveSeats: false,
        outOfTurnKinds: [],
      },
      metaSchemas: [],
      policies: { cascadeCap: 16, costBudgets: {} },
      hookBindings: {},
    };
    return { ok: true, value };
  } catch (error) {
    // Total by contract: an internal fault is reported, never thrown.
    c.add(
      "INVALID_VALUE",
      "",
      `internal compiler error: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return { ok: false, errors: c.errors(), truncated: c.truncated };
  }
}
