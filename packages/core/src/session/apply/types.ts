import type { Action } from "../actions.js";
import type { SeatId } from "../ids.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionEnded, SessionState } from "../state.js";

/** The proposal a batch derives from; absent for replay, host direct apply and hook batches (KFR-026). */
export interface ProposalDescriptor {
  readonly origin: "player" | "dealer" | "control" | "system";
  readonly kind: string;
  readonly actingSeat?: SeatId;
}

export interface ApplyOptions {
  readonly proposal?: ProposalDescriptor;
}

export interface ApplySuccess {
  readonly state: Snapshot<SessionState>;
  /** Post-expansion primitives, in order; never macros. Deep-frozen. */
  readonly committed: readonly Action[];
  readonly notifications: readonly SessionEnded[];
}
