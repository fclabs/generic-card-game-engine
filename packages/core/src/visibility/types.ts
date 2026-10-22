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

declare const viewBrand: unique symbol;
declare const deltaBrand: unique symbol;

/**
 * The projection of a session state for one viewer (spec §7.2). Plain JSON.
 * Carries a type-only unique-symbol brand (PFR-031): a `Snapshot` or an object
 * literal is not assignable. Only `makeView` (make-view.ts) creates values of
 * this type; the brand has no runtime representation.
 */
export interface View {
  readonly [viewBrand]: true;
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

/** A `View` without its brand: the sections `makeView` accepts. */
export type ViewSections = Omit<View, typeof viewBrand>;

/** One card-movement event of a `Delta`; fields present only when entitled (PFR-024, PFR-025). */
export type DeltaEntry =
  | {
      readonly i: number;
      readonly kind: "move";
      readonly card_id?: CardId;
      readonly from_zone?: ZoneId;
      readonly to_zone?: ZoneId;
      readonly from_position?: number;
      readonly to_position?: number;
      readonly face?: CardView["face"];
    }
  | {
      readonly i: number;
      readonly kind: "flip";
      readonly card_id: CardId;
      readonly orientation: Orientation;
      readonly face?: CardView["face"];
    }
  | {
      readonly i: number;
      readonly kind: "shuffle";
      readonly zone: ZoneId;
      readonly permutation?: readonly CardId[];
    }
  | {
      readonly i: number;
      readonly kind: "set_metadata";
      readonly card_id: CardId;
      readonly fields: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly i: number;
      readonly kind: "zone_create" | "zone_destroy";
      readonly zone_id: ZoneId;
    };

/**
 * The visible effect of one committed batch for one viewer (spec §7.2).
 * Branded like `View`; produced only by the projector (Iteration 5).
 */
export interface Delta {
  readonly [deltaBrand]: true;
  readonly seq: number;
  readonly entries: readonly DeltaEntry[];
  readonly zoneCounts: Readonly<Record<ZoneId, number>>;
  readonly counters: Readonly<Record<CounterId, string>>;
  readonly control?: View["control"];
  readonly roster?: Readonly<Record<SeatId, View["roster"][SeatId] | null>>;
  readonly meta?: Readonly<Record<string, JsonValue | null>>;
  readonly gates?: Readonly<Record<GateId, GateView | null>>;
  readonly grants?: Readonly<Record<GrantId, GrantView | null>>;
  readonly lifecycle?: Lifecycle;
  readonly outcome?: JsonValue;
}

/** A `Delta` without its brand. */
export type DeltaSections = Omit<Delta, typeof deltaBrand>;
