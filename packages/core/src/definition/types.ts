import type {
  CardId,
  CounterId,
  SeatId,
  TeamId,
  ZoneId,
} from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";

/**
 * Compiled game definition (spec KFR-100). All members are plain data except
 * three function-valued kinds: `CounterDecl.derived`, `MetaSchemaDecl.reducer`
 * and `CompiledGameDefinition.rosterReducer`. `definitionData` (data.ts)
 * strips exactly those.
 */

/** Type of a card-metadata or meta-schema field. `json` accepts any JsonValue. */
export type FieldType = "string" | "int" | "bool" | "json";

/** Field name -> field type. */
export type FieldSchema = Readonly<Record<string, FieldType>>;

/**
 * Pure function over a partition. Placeholder shapes until the SPI
 * `Reducer<S>` (iteration 11) and the state types (iteration 4) exist.
 */
export type PartitionReducer = (partition: never, payload: unknown) => unknown;

/** Pure derived-counter evaluator `(snapshot) -> bigint` (KFR-063). */
export type DerivedEvaluator = (snapshot: Snapshot<SessionState>) => bigint;

export interface CardDecl {
  readonly id: CardId;
  readonly type?: string;
  readonly metadataSchema: FieldSchema;
  readonly startingZone: ZoneId;
}

export interface ZoneDecl {
  readonly id: ZoneId;
  readonly ordered: boolean;
}

export type OwnerRule = "seat" | "team" | "player" | "none";

export interface ZoneTemplateDecl {
  /** No `/`, at most 48 characters (KFR-101). */
  readonly name: string;
  readonly ownerRule: OwnerRule;
  readonly ordered: boolean;
  readonly maxInstances: number;
}

export type CounterOwner = "table" | "player" | "team" | "zone" | "card";
export type RoundingMode = "floor" | "half_up" | "half_even";
export type SupplyRole = "mint" | "burn";

export interface CounterDecl {
  readonly id: CounterId;
  readonly owner: CounterOwner;
  readonly min: bigint;
  readonly max?: bigint;
  readonly initial: bigint;
  /** Descriptive only; never enters arithmetic (KFR-061). */
  readonly scale?: number;
  readonly rounding?: RoundingMode;
  readonly supplyRole?: SupplyRole;
  /** Present for derived counters: computed on demand, never stored. */
  readonly derived?: DerivedEvaluator;
}

export interface ConservationGroupDecl {
  readonly id: string;
  readonly counters: readonly CounterId[];
}

export interface SeatDecl {
  readonly id: SeatId;
  readonly team?: TeamId;
}

export interface ControlDecl {
  readonly phases: readonly string[];
  readonly initialPhase: string;
  /** A permutation of the declared seats. */
  readonly turnOrder: readonly SeatId[];
  readonly initialActiveSeats: readonly SeatId[];
  readonly pointerNames: readonly string[];
  readonly enforceActiveSeats: boolean;
  readonly outOfTurnKinds: readonly string[];
}

export interface MetaSchemaDecl {
  /** `schema_id`; the `engine.` prefix is reserved. */
  readonly id: string;
  readonly fields: FieldSchema;
  /** Required; absence is a structural violation. */
  readonly reducer?: PartitionReducer;
}

export interface PolicyDecl {
  /** Default 16. */
  readonly cascadeCap: number;
  readonly costBudgets: Readonly<Record<string, number>>;
}

/** Routing key -> hook ids (data only). */
export type HookBindingTable = Readonly<Record<string, readonly string[]>>;

export interface CompiledGameDefinition {
  /** Action-schema version. */
  readonly schemaVersion: number;
  readonly cards: readonly CardDecl[];
  readonly zones: readonly ZoneDecl[];
  readonly zoneTemplates: readonly ZoneTemplateDecl[];
  readonly counters: readonly CounterDecl[];
  readonly conservationGroups: readonly ConservationGroupDecl[];
  /** In declaration order (turn order lives in `control.turnOrder`). */
  readonly seats: readonly SeatDecl[];
  readonly teams: readonly TeamId[];
  /** Vocabulary valid in `grant_view.keys`. */
  readonly viewKeys: readonly string[];
  readonly control: ControlDecl;
  readonly metaSchemas: readonly MetaSchemaDecl[];
  readonly rosterReducer?: PartitionReducer;
  readonly policies: PolicyDecl;
  readonly hookBindings: HookBindingTable;
}
