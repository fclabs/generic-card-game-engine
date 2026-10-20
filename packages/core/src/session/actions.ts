import type {
  CardId,
  CounterId,
  GrantId,
  PlayerId,
  SeatId,
  TeamId,
  ZoneId,
} from "./ids.js";
import type { JsonValue, Lifecycle, Orientation, SeatStatus } from "./state.js";

/**
 * Action wire types (spec KFR-030..049, `docs/requirements.md` §5.6.3). Payload field
 * names are snake_case exactly as on the wire. Counter amounts and ratio terms are
 * `bigint` (exact arithmetic, D-014). Every field is `readonly`; validated actions are
 * deep-frozen once committed.
 */

export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

export interface MoveAction {
  readonly kind: "move";
  readonly card_id: CardId;
  readonly from_zone: ZoneId;
  readonly to_zone: ZoneId;
  readonly to_position?: number;
}
export interface FlipAction {
  readonly kind: "flip";
  readonly card_id: CardId;
  readonly orientation: Orientation;
}
export interface ShuffleAction {
  readonly kind: "shuffle";
  readonly zone: ZoneId;
  readonly permutation: readonly CardId[];
}
export interface SetMetadataAction {
  readonly kind: "set_metadata";
  readonly card_id: CardId;
  readonly fields: { readonly [name: string]: JsonValue };
}
export interface LifecycleAction {
  readonly kind: "lifecycle";
  readonly to_state: Lifecycle;
  readonly outcome?: JsonValue;
}
export interface CounterAdjustAction {
  readonly kind: "counter_adjust";
  readonly counter_id: CounterId;
  readonly delta: bigint;
  readonly ratio?: Ratio;
}
export interface CounterTransferAction {
  readonly kind: "counter_transfer";
  readonly from_counter: CounterId;
  readonly to_counter: CounterId;
  readonly amount: bigint;
  readonly ratio?: Ratio;
  readonly remainder_to?: CounterId;
}
export interface ControlSetAction {
  readonly kind: "control_set";
  readonly phase?: string;
  readonly active_seats?: readonly SeatId[];
  readonly direction?: 1 | -1;
  readonly pointer?: { readonly name: string; readonly seat: SeatId };
}
export interface ControlAdvanceAction {
  readonly kind: "control_advance";
  readonly steps: number;
  readonly pointer?: string;
  /** Only `until_quiescent` is a known mode; the applier rejects it (out of P1 scope). */
  readonly mode?: "until_quiescent";
}
export interface GrantViewAction {
  readonly kind: "grant_view";
  readonly target: JsonValue;
  readonly keys: readonly string[];
  readonly grantee: string;
  readonly scope: JsonValue;
  /** Recorded by `apply` in the committed action (KFR-040); optional on input. */
  readonly grant_id?: GrantId;
}
export interface RevokeViewAction {
  readonly kind: "revoke_view";
  readonly grant_id: GrantId;
}
export interface ZoneCreateAction {
  readonly kind: "zone_create";
  readonly template: string;
  readonly owner?: SeatId | TeamId | PlayerId;
  /** Must equal the derived id when given; recorded by `apply` (KFR-039). */
  readonly zone_id?: ZoneId;
}
export interface ZoneDestroyAction {
  readonly kind: "zone_destroy";
  readonly zone_id: ZoneId;
}
/** Roster ops other than delegation go to the roster reducer (KFR-042). */
export type RosterAction =
  | {
      readonly kind: "roster";
      readonly op: "join";
      readonly player_id: PlayerId;
      readonly seat_id?: SeatId;
      readonly team_id?: TeamId;
      readonly zones_to_create?: readonly string[];
    }
  | {
      readonly kind: "roster";
      readonly op: "leave";
      readonly player_id: PlayerId;
      readonly seat_id?: SeatId;
    }
  | {
      readonly kind: "roster";
      readonly op: "substitute";
      readonly player_id: PlayerId;
      readonly seat_id?: SeatId;
      readonly team_id?: TeamId;
    }
  | {
      readonly kind: "roster";
      readonly op: "set_status";
      readonly seat_id: SeatId;
      readonly status: SeatStatus;
    }
  | {
      readonly kind: "roster";
      readonly op: "delegate";
      readonly seat_id: SeatId;
      readonly grantee_principal: string;
      readonly scope?: JsonValue;
      readonly boundary?: string;
    }
  | {
      readonly kind: "roster";
      readonly op: "revoke_delegation";
      readonly seat_id: SeatId;
      readonly grantee_principal: string;
    };
export interface MetaAction {
  readonly kind: "meta";
  readonly schema_id: string;
  readonly payload: JsonValue;
}

/** Logged primitives. Macros never appear in a committed list (KFR-025). */
export type Action =
  | MoveAction
  | FlipAction
  | ShuffleAction
  | SetMetadataAction
  | LifecycleAction
  | CounterAdjustAction
  | CounterTransferAction
  | ControlSetAction
  | ControlAdvanceAction
  | GrantViewAction
  | RevokeViewAction
  | ZoneCreateAction
  | ZoneDestroyAction
  | RosterAction
  | MetaAction;

export interface DrawMacro {
  readonly kind: "draw";
  readonly from_zone: ZoneId;
  readonly count: number;
  readonly to_zone: ZoneId;
  readonly to_position?: number;
}
export interface ZoneMergeMacro {
  readonly kind: "zone_merge";
  readonly src_zone: ZoneId;
  readonly dst_zone: ZoneId;
}
export interface ResetToZoneMacro {
  readonly kind: "reset_to_zone";
  readonly zones: readonly ZoneId[];
  readonly to_zone: ZoneId;
}
export type Macro = DrawMacro | ZoneMergeMacro | ResetToZoneMacro;

export type ActionKind = Action["kind"];
export type MacroKind = Macro["kind"];

export const PRIMITIVE_KINDS: readonly ActionKind[] = Object.freeze([
  "move",
  "flip",
  "shuffle",
  "set_metadata",
  "lifecycle",
  "counter_adjust",
  "counter_transfer",
  "control_set",
  "control_advance",
  "grant_view",
  "revoke_view",
  "zone_create",
  "zone_destroy",
  "roster",
  "meta",
]);
export const MACRO_KINDS: readonly MacroKind[] = Object.freeze([
  "draw",
  "zone_merge",
  "reset_to_zone",
]);

export function isMacro(action: Action | Macro): action is Macro {
  return (MACRO_KINDS as readonly string[]).includes(action.kind);
}
