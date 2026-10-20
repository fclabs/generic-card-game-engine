import type {
  CardDecl,
  CompiledGameDefinition,
  ConservationGroupDecl,
  ControlDecl,
  CounterDecl,
  HookBindingTable,
  MetaSchemaDecl,
  PolicyDecl,
  RoleDecl,
  SeatDecl,
  ZoneDecl,
  ZoneTemplateDecl,
} from "./types.js";
import type { TeamId } from "../session/ids.js";

export type CounterData = Omit<CounterDecl, "derived">;
export type MetaSchemaData = Omit<MetaSchemaDecl, "reducer">;

/** The data portion of a definition: no function-valued member, no `undefined` values. */
export interface DefinitionData {
  readonly gameId: string;
  readonly roles: readonly RoleDecl[];
  readonly schemaVersion: number;
  readonly cards: readonly CardDecl[];
  readonly zones: readonly ZoneDecl[];
  readonly zoneTemplates: readonly ZoneTemplateDecl[];
  readonly counters: readonly CounterData[];
  readonly conservationGroups: readonly ConservationGroupDecl[];
  readonly seats: readonly SeatDecl[];
  readonly teams: readonly TeamId[];
  readonly viewKeys: readonly string[];
  readonly control: ControlDecl;
  readonly metaSchemas: readonly MetaSchemaData[];
  readonly rosterReducerRef?: string;
  readonly policies: PolicyDecl;
  readonly hookBindings: HookBindingTable;
}

/**
 * Data-vs-function rule (KFR-100, DFR-066): the only function-valued members are
 * `counters[].derived`, `metaSchemas[].reducer` and `rosterReducer`. They are dropped;
 * identity is carried by `derivedSpec`, `reducerRef` and `rosterReducerRef`, so binding
 * functions never changes the data. Everything else is passed through unchanged.
 */
export function definitionData(def: CompiledGameDefinition): DefinitionData {
  return {
    gameId: def.gameId,
    roles: def.roles,
    schemaVersion: def.schemaVersion,
    cards: def.cards,
    zones: def.zones,
    zoneTemplates: def.zoneTemplates,
    counters: def.counters.map((counter) => {
      const { derived, ...rest } = counter;
      void derived;
      return rest;
    }),
    conservationGroups: def.conservationGroups,
    seats: def.seats,
    teams: def.teams,
    viewKeys: def.viewKeys,
    control: def.control,
    metaSchemas: def.metaSchemas.map((schema) => {
      const { reducer, ...rest } = schema;
      void reducer;
      return rest;
    }),
    ...(def.rosterReducerRef !== undefined
      ? { rosterReducerRef: def.rosterReducerRef }
      : {}),
    policies: def.policies,
    hookBindings: def.hookBindings,
  };
}
