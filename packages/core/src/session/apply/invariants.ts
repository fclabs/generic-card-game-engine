import type { CompiledGameDefinition } from "../../definition/types.js";
import { getOwn, hasOwn } from "../records.js";
import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";

/**
 * Re-check of the structural rules and counter bounds on a whole state (KBR-010): run after
 * every reducer output so a reducer cannot bypass structural validation. Covers KBR-001
 * (every card in exactly one zone), KBR-006 (template zones: declared template, live count
 * within `maxInstances`, owner valid for the rule), KBR-007 (open-gate submissions only from
 * expected seats), KBR-008 (phase and seats of the control state) and the counter bounds of
 * KBR-011. KBR-002/003 concern single actions and hold by construction for a state in which
 * every ordered zone lists distinct members (part of KBR-001). Returns the first problem
 * (a message naming the offending entity) or `undefined`.
 */
export function findInvariantViolation(
  def: CompiledGameDefinition,
  state: Snapshot<SessionState>,
): string | undefined {
  // KBR-001
  const zoneOf = new Map<string, string>();
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    for (const member of zone.members) {
      const earlier = zoneOf.get(member);
      if (earlier !== undefined) {
        return `card ${member} is in zones ${earlier} and ${zoneId} (KBR-001)`;
      }
      zoneOf.set(member, zoneId);
      if (getOwn(state.cards, member)?.zone !== zoneId) {
        return `card ${member} is listed in zone ${zoneId} but its zone differs (KBR-001)`;
      }
    }
  }
  for (const cardId of Object.keys(state.cards)) {
    if (!zoneOf.has(cardId)) return `card ${cardId} is in no zone (KBR-001)`;
  }

  // KBR-006
  const live = new Map<string, number>();
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    if (zone.template === undefined) continue;
    const template = def.zoneTemplates.find((t) => t.name === zone.template);
    if (template === undefined) {
      return `zone ${zoneId} names unknown template ${zone.template} (KBR-006)`;
    }
    live.set(template.name, (live.get(template.name) ?? 0) + 1);
    const owner = zone.owner;
    const seats = Object.values(state.roster.seats);
    const ownerOk =
      template.ownerRule === "none"
        ? owner === undefined
        : owner !== undefined &&
          (template.ownerRule === "seat"
            ? hasOwn(state.roster.seats, owner)
            : template.ownerRule === "team"
              ? def.teams.some((t) => t === owner)
              : seats.some((s) => s.player === owner));
    if (!ownerOk) {
      return `zone ${zoneId} has an owner that violates the ${template.ownerRule} rule of ${template.name} (KBR-006)`;
    }
  }
  for (const template of def.zoneTemplates) {
    if ((live.get(template.name) ?? 0) > template.maxInstances) {
      return `template ${template.name} exceeds max_instances ${String(template.maxInstances)} (KBR-006)`;
    }
  }

  // KBR-007
  for (const [gateId, gate] of Object.entries(state.gates.open)) {
    for (const seat of Object.keys(gate.submissions)) {
      if (!gate.expectedSeats.includes(seat as never)) {
        return `gate ${gateId} holds a submission from unexpected seat ${seat} (KBR-007)`;
      }
    }
  }

  // KBR-008
  const { control, roster } = state;
  if (!def.control.phases.includes(control.phase)) {
    return `control phase ${control.phase} is outside the declared set (KBR-008)`;
  }
  const referenced: [string, string][] = [
    ...control.turnOrder.map((s): [string, string] => ["turn order", s]),
    ...control.activeSeats.map((s): [string, string] => ["active seats", s]),
    ...Object.entries(control.pointers).map(([name, s]): [string, string] => [
      `pointer ${name}`,
      s,
    ]),
    ...state.delegations.map((d): [string, string] => ["delegation", d.seat]),
    ...Object.values({ ...state.gates.open, ...state.gates.resolved }).flatMap(
      (g) => g.expectedSeats.map((s): [string, string] => ["gate", s]),
    ),
  ];
  for (const [what, seat] of referenced) {
    if (!hasOwn(roster.seats, seat)) {
      return `${what} names seat ${seat} which is not in the roster (KBR-008)`;
    }
  }

  // Counter bounds (KBR-011, re-checked per KBR-010)
  for (const counter of def.counters) {
    if (counter.derived !== undefined) continue;
    const value = getOwn(state.counters, counter.id);
    if (value === undefined) return `counter ${counter.id} is missing`;
    if (
      value < counter.min ||
      (counter.max !== undefined && value > counter.max)
    ) {
      return `counter ${counter.id} = ${String(value)} is outside its bounds (KBR-011)`;
    }
  }
  return undefined;
}
