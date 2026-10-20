import type {
  CompiledGameDefinition,
  ControlDecl,
  MetaSchemaDecl,
  PolicyDecl,
  RoleDecl,
} from "../types.js";
import {
  GRANTABLE_VIEW_KEYS,
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
} from "./constants.js";
import type { DefinitionError } from "./errors.js";
import { createErrorCollector } from "./errors.js";
import { isValidGameId } from "./ids.js";
import { DEFAULT_DEFINITION_LIMITS } from "./limits.js";
import { compileControl } from "./control.js";
import { verifyCompiled } from "./finalize.js";
import { compileHooks } from "./hooks.js";
import type { CompiledHooks } from "./hooks.js";
import { compileMetaSchemas, readExportName } from "./meta.js";
import { compilePolicies, DEFAULT_CASCADE_CAP } from "./policies.js";
import { BUILT_IN_ROLES, compileRoles } from "./roles.js";
import { checkBundle } from "./references.js";
import type { HookBundleInfo } from "./references.js";
import { compileViewKeys } from "./view-keys.js";
import type { DefinitionLimits } from "./limits.js";
import { compileCards } from "./cards.js";
import type { CompiledCards } from "./cards.js";
import { compileConservationGroups } from "./groups.js";
import type { CompiledGroups } from "./groups.js";
import { compileCounters } from "./counters.js";
import type { CompiledCounters } from "./counters.js";
import type { ForEachScope } from "./foreach.js";
import { compileSeats } from "./seats.js";
import { compileZones } from "./zones.js";
import type { CompiledZones } from "./zones.js";
import { has, member, readInteger, readObject, readString } from "./strict.js";

export type { HookBundleInfo } from "./references.js";

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
 * Sections accepted as absent but not yet compiled. Empty since iteration 4:
 * every section of spec section 7.1 is compiled.
 */
export const UNIMPLEMENTED_SECTIONS: readonly SectionKey[] = [];

const REQUIRED_SECTIONS: readonly SectionKey[] = [
  "id",
  "action_schema_version",
  "seats",
];

const EMPTY_ZONES: CompiledZones = { zones: [], zoneTemplates: [] };
const EMPTY_CARDS: CompiledCards = { cards: [] };
const EMPTY_COUNTERS: CompiledCounters = { counters: [] };
const EMPTY_GROUPS: CompiledGroups = { conservationGroups: [] };

/**
 * Compiles a parsed `game.yaml` value (spec DFR-010). Pure and total: never
 * throws, whatever `raw` is. Errors are collected in section order (at most
 * 100; `truncated` when more existed).
 */
export function compileDefinition(
  raw: unknown,
  ctx: CompileContext = {},
): CompileResult {
  const limits = ctx.limits ?? DEFAULT_DEFINITION_LIMITS;
  const c = createErrorCollector();
  try {
    const root = readObject(c, raw, "", SECTION_ORDER, REQUIRED_SECTIONS);
    let gameId: string | undefined;
    let schemaVersion: number | undefined;
    let seats: ReturnType<typeof compileSeats>;
    let roles: readonly RoleDecl[] | undefined = [];
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
      if (has(root, "roles")) {
        roles = compileRoles(c, member(root, "roles"), "roles");
      }
      if (has(root, "seats")) {
        seats = compileSeats(c, member(root, "seats"), "seats");
      }
    }
    // Sections that depend on the seat layout are skipped when it failed:
    // every reference they made would be reported spuriously.
    const scope: ForEachScope | undefined =
      seats === undefined
        ? undefined
        : {
            seats: seats.seats.map((s) => s.id),
            teams: seats.teams,
            ...(roles === undefined
              ? {}
              : {
                  roles: [...BUILT_IN_ROLES, ...roles.map((r) => r.id)],
                }),
          };
    let zones: CompiledZones | undefined = EMPTY_ZONES;
    let cards: CompiledCards | undefined = EMPTY_CARDS;
    let counters: CompiledCounters | undefined = EMPTY_COUNTERS;
    let groups: CompiledGroups | undefined = EMPTY_GROUPS;
    if (root !== undefined) {
      if (has(root, "zones")) {
        zones =
          scope === undefined
            ? undefined
            : compileZones(c, member(root, "zones"), "zones", scope);
      }
      const zoneIds =
        zones === undefined
          ? undefined
          : new Set<string>(zones.zones.map((z) => z.id));
      if (has(root, "cards")) {
        cards = compileCards(c, member(root, "cards"), "cards", zoneIds);
      }
      if (has(root, "counters")) {
        counters =
          scope === undefined
            ? undefined
            : compileCounters(c, member(root, "counters"), "counters", scope, {
                zones: zoneIds,
                cards:
                  cards === undefined
                    ? undefined
                    : new Set<string>(cards.cards.map((k) => k.id)),
              });
      }
      if (has(root, "conservation_groups")) {
        groups =
          scope === undefined
            ? undefined
            : compileConservationGroups(
                c,
                member(root, "conservation_groups"),
                "conservation_groups",
                scope,
                counters?.counters,
              );
      }
    }
    let control: ControlDecl | undefined;
    let metaSchemas: readonly MetaSchemaDecl[] | undefined = [];
    let rosterReducerRef: string | undefined;
    let viewKeys: readonly string[] | undefined = [...GRANTABLE_VIEW_KEYS];
    let hooks: CompiledHooks | undefined = { hookBindings: {} };
    let policies: PolicyDecl | undefined = {
      cascadeCap: DEFAULT_CASCADE_CAP,
      costBudgets: {},
    };
    if (root !== undefined) {
      control = compileControl(
        c,
        has(root, "control") ? member(root, "control") : {},
        "control",
        scope?.seats,
      );
      if (has(root, "meta_schemas")) {
        metaSchemas = compileMetaSchemas(
          c,
          member(root, "meta_schemas"),
          "meta_schemas",
        );
      }
      if (has(root, "roster_reducer")) {
        const before = c.count;
        const ref = readExportName(
          c,
          member(root, "roster_reducer"),
          "roster_reducer",
        );
        if (ref === undefined || c.count !== before) metaSchemas = undefined;
        else rosterReducerRef = ref;
      }
      if (has(root, "view_keys")) {
        viewKeys = compileViewKeys(c, member(root, "view_keys"), "view_keys");
      }
      if (has(root, "hooks")) {
        hooks = compileHooks(
          c,
          member(root, "hooks"),
          "hooks",
          control?.phases,
        );
      }
      if (has(root, "policies")) {
        policies = compilePolicies(
          c,
          member(root, "policies"),
          "policies",
          limits,
        );
      }
      checkBundle(c, root, ctx.bundle);
    }
    if (
      c.count > 0 ||
      gameId === undefined ||
      roles === undefined ||
      control === undefined ||
      metaSchemas === undefined ||
      viewKeys === undefined ||
      hooks === undefined ||
      policies === undefined ||
      schemaVersion === undefined ||
      seats === undefined ||
      zones === undefined ||
      cards === undefined ||
      counters === undefined ||
      groups === undefined
    ) {
      return { ok: false, errors: c.errors(), truncated: c.truncated };
    }
    const value: CompiledGameDefinition = {
      gameId,
      roles,
      schemaVersion,
      cards: cards.cards,
      zones: zones.zones,
      zoneTemplates: zones.zoneTemplates,
      counters: counters.counters,
      conservationGroups: groups.conservationGroups,
      seats: seats.seats,
      teams: seats.teams,
      viewKeys,
      control,
      metaSchemas,
      ...(rosterReducerRef === undefined ? {} : { rosterReducerRef }),
      policies,
      hookBindings: hooks.hookBindings,
    };
    if (!verifyCompiled(c, value)) {
      return { ok: false, errors: c.errors(), truncated: c.truncated };
    }
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
