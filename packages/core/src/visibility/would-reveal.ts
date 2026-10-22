import type { CompiledGameDefinition } from "../definition/types.js";
import type { GrantId, SeatId } from "../session/ids.js";
import { getOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { expandGrantee } from "./entitlement.js";
import { openBatch } from "./open-batch.js";
import { buildDeltaContexts, deltaFor } from "./project-delta.js";
import { compareIds, compileLookups } from "./project-view.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import type { Delta } from "./types.js";

/**
 * The exact equality behind "differs" (PFR-029): two deltas are equal iff
 * their JSON serialisations are identical. A `Delta` is plain JSON with a
 * deterministic key order (section order, ascending ids, action order), so
 * string equality is deep equality over the whole value. No section is
 * ignored: entries, counts, counters, control, roster, meta, gates, grants,
 * lifecycle and outcome all count.
 */
function sameDelta(a: Delta, b: Delta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which `once` grants would this batch reveal something through (PFR-029)?
 *
 * A grant is returned iff it is a `once` grant present in `pre` (a grant the
 * batch creates is not in `pre`, so it is never returned) and, for at least
 * one seat of its expanded grantee set (grantee expanded over `pre`),
 * evaluated as role `player` with that seat as subject, the delta of the batch
 * differs when the grant is left out of the evaluation. Both evaluations use
 * the union of the grants of `pre` and `post` (PFR-023), so a grant the batch
 * itself revokes or consumes still counts. Grants of other scopes are never
 * returned. `grantee`, when given, restricts the seats considered.
 *
 * Returns the ids sorted ascending (UTF-16). Pure: reads only its arguments.
 * A batch that does not match `pre`/`post` (`post.seq !== pre.seq + 1` or a
 * different batch seq) reveals nothing and yields `[]`.
 *
 * Cost: at most `S` baseline deltas (one per distinct seat, computed lazily
 * and shared by all grants) plus one what-if delta per (grant, seat) pair
 * with `S <= seats`, so `O(seats + onceGrants * seatsPerGrant)` delta
 * evaluations of the batch.
 */
export function wouldReveal(
  def: CompiledGameDefinition,
  pre: Snapshot<SessionState>,
  post: Snapshot<SessionState>,
  batch: PrivilegedBatch,
  grantee?: SeatId,
): readonly GrantId[] {
  const tx = openBatch(batch);
  if (post.seq !== pre.seq + 1 || tx.seq !== post.seq) return [];
  const compiled = compileLookups(def);
  const baselines = new Map<SeatId, Delta>();
  const baseline = (seat: SeatId): Delta => {
    let delta = baselines.get(seat);
    if (delta === undefined) {
      const ctxs = buildDeltaContexts(def, pre, post, {
        role: "player",
        subject: seat,
      });
      delta = deltaFor(compiled, ctxs, post.seq, tx.actions);
      baselines.set(seat, delta);
    }
    return delta;
  };

  const revealed: GrantId[] = [];
  for (const id of Object.keys(pre.grants).sort(compareIds)) {
    const grant = getOwn(pre.grants, id as GrantId);
    if (grant === undefined) continue;
    const scope = grant.scope;
    if (
      typeof scope !== "object" ||
      scope === null ||
      Array.isArray(scope) ||
      (scope as { readonly kind?: unknown }).kind !== "once"
    ) {
      continue;
    }
    const seats = [...expandGrantee(pre, grant.grantee)]
      .filter((s) => grantee === undefined || s === grantee)
      .filter((s) => getOwn(post.roster.seats, s) !== undefined)
      .sort(compareIds);
    const reveals = seats.some((seat) => {
      const without = buildDeltaContexts(
        def,
        pre,
        post,
        { role: "player", subject: seat },
        { exclude: id as GrantId },
      );
      return !sameDelta(
        baseline(seat),
        deltaFor(compiled, without, post.seq, tx.actions),
      );
    });
    if (reveals) revealed.push(id as GrantId);
  }
  return revealed;
}
