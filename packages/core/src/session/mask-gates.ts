import type { SeatId } from "./ids.js";
import { setOwn } from "./records.js";
import type { Snapshot } from "./snapshot.js";
import type { GateMaskedSnapshot, MaskedGate, SessionState } from "./state.js";

/**
 * Replaces every open gate by `{schemaId, expectedSeats, submitted}` (KFR-092):
 * `submitted` lists, in `expectedSeats` order, the seats holding a submission, and no
 * payload remains. Resolved gates and every other member are the input's own references.
 * Only the new objects are frozen (the rest of the input is already frozen).
 */
export function maskGates(
  snapshot: Snapshot<SessionState>,
): GateMaskedSnapshot {
  const open: Record<string, MaskedGate> = {};
  for (const [gateId, gate] of Object.entries(snapshot.gates.open)) {
    const submitted: SeatId[] = gate.expectedSeats.filter((seat) =>
      Object.hasOwn(gate.submissions, seat),
    );
    setOwn(
      open,
      gateId,
      Object.freeze({
        schemaId: gate.schemaId,
        expectedSeats: gate.expectedSeats,
        submitted: Object.freeze(submitted),
      }),
    );
  }
  const gates = Object.freeze({
    open: Object.freeze(open),
    resolved: snapshot.gates.resolved,
  });
  return Object.freeze({ ...snapshot, gates });
}
