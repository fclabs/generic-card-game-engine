import type {
  CardDecl,
  CompiledGameDefinition,
  ConservationGroupDecl,
  ControlDecl,
  CounterDecl,
  HookBindingTable,
  MetaSchemaDecl,
  PolicyDecl,
  SeatDecl,
  ZoneDecl,
  ZoneTemplateDecl,
} from "./types.js";
import type { TeamId } from "../session/ids.js";

export type CounterData = Omit<CounterDecl, "derived"> & {
  readonly derived: boolean;
};
export type MetaSchemaData = Omit<MetaSchemaDecl, "reducer"> & {
  readonly hasReducer: boolean;
};

/** The data portion of a definition: no function-valued member, no `undefined` values. */
export interface DefinitionData {
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
  readonly hasRosterReducer: boolean;
  readonly policies: PolicyDecl;
  readonly hookBindings: HookBindingTable;
}

/**
 * Data-vs-function rule (KFR-100): the only function-valued members are
 * `counters[].derived`, `metaSchemas[].reducer` and `rosterReducer`. They are
 * replaced by the booleans `derived`, `hasReducer` and `hasRosterReducer`;
 * everything else is passed through unchanged. Evaluators and reducers are
 * resolved from the definition value itself, never from this data.
 */
export function definitionData(def: CompiledGameDefinition): DefinitionData {
  return {
    schemaVersion: def.schemaVersion,
    cards: def.cards,
    zones: def.zones,
    zoneTemplates: def.zoneTemplates,
    counters: def.counters.map(({ derived, ...rest }) => ({
      ...rest,
      derived: derived !== undefined,
    })),
    conservationGroups: def.conservationGroups,
    seats: def.seats,
    teams: def.teams,
    viewKeys: def.viewKeys,
    control: def.control,
    metaSchemas: def.metaSchemas.map(({ reducer, ...rest }) => ({
      ...rest,
      hasReducer: reducer !== undefined,
    })),
    hasRosterReducer: def.rosterReducer !== undefined,
    policies: def.policies,
    hookBindings: def.hookBindings,
  };
}
