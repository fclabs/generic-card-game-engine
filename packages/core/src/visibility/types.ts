import type {
  CardId,
  CounterId,
  GateId,
  GrantId,
  PlayerId,
  SeatId,
  TeamId,
  ZoneId,
} from "../session/ids.js";
import type {
  JsonValue,
  Lifecycle,
  Orientation,
  SeatStatus,
} from "../session/state.js";

/** The four roles every game has (PFR-001). */
export type BuiltInRole = "player" | "dealer" | "auditor" | "render";

/** A privileged built-in role: denied until the definition registers it (PBR-003). */
export type PrivilegedRole = "dealer" | "auditor";

/** The role and optional subject a query is projected for (spec §7.1). */
export interface ViewerIdentity {
  readonly role: string;
  readonly subject?: SeatId;
}

export type SubjectRule = "required" | "optional" | "forbidden";

export interface RoleEntry {
  readonly id: string;
  readonly subject: SubjectRule;
  readonly builtIn: boolean;
}

/** Roles of a definition and which privileged roles it registers (PFR-001). Deeply frozen. */
export interface RoleRegistry {
  readonly roles: readonly RoleEntry[];
  readonly registeredPrivileged: readonly PrivilegedRole[];
}

/** A card as a viewer sees it (spec §7.2). `face` only when the viewer has `card_face`. */
export interface CardView {
  readonly id: CardId;
  readonly orientation: Orientation;
  readonly face?: {
    readonly type?: string;
    readonly metadata: Readonly<Record<string, JsonValue>>;
  };
}

/** A zone as a viewer sees it; each member of the entitlement appears only when entitled. */
export interface ZoneView {
  readonly ordered: boolean;
  readonly owner?: string;
  readonly count?: number;
  readonly members?: readonly CardView[];
  readonly orderKnown?: boolean;
}

export interface GateView {
  readonly schemaId: string;
  readonly expectedSeats: readonly SeatId[];
  readonly submitted?: readonly SeatId[];
  readonly submissions?: Readonly<Record<SeatId, JsonValue>>;
}

export interface GrantView {
  readonly target: JsonValue;
  readonly keys: readonly string[];
  readonly grantee: string;
  readonly scope: JsonValue;
}

/**
 * The projection of a session state for one viewer (spec §7.2). Plain JSON.
 * Only `makeView` (make-view.ts) creates values of this type.
 */
export interface View {
  readonly seq: number;
  readonly lifecycle: Lifecycle;
  readonly viewer: ViewerIdentity;
  readonly zones: Readonly<Record<ZoneId, ZoneView>>;
  /** Decimal strings (PFR-021). */
  readonly counters: Readonly<Record<CounterId, string>>;
  readonly control: {
    readonly phase: string;
    readonly turnOrder: readonly SeatId[];
    readonly activeSeats: readonly SeatId[];
    readonly direction: 1 | -1;
    readonly pointers: Readonly<Record<string, SeatId>>;
  };
  readonly roster: Readonly<
    Record<
      SeatId,
      {
        readonly status: SeatStatus;
        readonly team?: TeamId;
        readonly player?: PlayerId;
      }
    >
  >;
  readonly meta: Readonly<Record<string, JsonValue>>;
  readonly gates: {
    readonly open: Readonly<Record<GateId, GateView>>;
    readonly resolved: Readonly<Record<GateId, GateView>>;
  };
  readonly grants: Readonly<Record<GrantId, GrantView>>;
  readonly outcome?: JsonValue;
}
