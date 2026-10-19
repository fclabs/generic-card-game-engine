import type { Snapshot } from "../snapshot.js";
import type { SessionState } from "../state.js";

/** KBR-001: every card is in exactly one zone's members and `card.zone` agrees. Returns problems. */
export function structuralProblems(state: Snapshot<SessionState>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    for (const member of zone.members) {
      const earlier = seen.get(member);
      if (earlier !== undefined) {
        problems.push(`card ${member} is in zones ${earlier} and ${zoneId}`);
      }
      seen.set(member, zoneId);
      if (state.cards[member]?.zone !== zoneId) {
        problems.push(
          `card ${member} listed in ${zoneId} but card.zone differs`,
        );
      }
    }
  }
  for (const cardId of Object.keys(state.cards)) {
    if (!seen.has(cardId)) problems.push(`card ${cardId} is in no zone`);
  }
  return problems;
}
