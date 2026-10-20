import { getOwn } from "../../session/records.js";
import type { DerivedEvaluator } from "../types.js";

/**
 * Evaluator of `derived: {zone_size: <zone>}` (DFR-016): the current member
 * count of the zone as a `bigint` (`0n` when the zone has no state). Pure; a
 * fresh closure per compile, with no state shared between compiles.
 */
export function zoneSizeEvaluator(zone: string): DerivedEvaluator {
  return (snapshot) =>
    BigInt(getOwn(snapshot.zones, zone)?.members.length ?? 0);
}
