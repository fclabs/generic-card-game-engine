import type { CompiledGameDefinition } from "../definition/types.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { Action } from "../session/actions.js";
import type {
  CardId,
  CounterId,
  GateId,
  GrantId,
  SeatId,
  ZoneId,
} from "../session/ids.js";
import { getOwn, hasOwn, setOwn } from "../session/records.js";
import type { Snapshot } from "../session/snapshot.js";
import type { Grant, JsonValue, SessionState } from "../session/state.js";
import {
  buildEntitlementContext,
  isEntitledToCardKey,
  isEntitledToZoneKey,
} from "./entitlement.js";
import type { EntitlementContext } from "./entitlement.js";
import { makeDelta } from "./make-delta.js";
import { openBatch } from "./open-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import {
  cloneJson,
  compareIds,
  compileLookups,
  counterValue,
  isCounterVisible,
  isGrantVisible,
  isZoneOrdered,
  projectControl,
  projectFace,
  projectGates,
  projectGrantView,
  projectMeta,
  projectSeat,
} from "./project-view.js";
import type { Compiled } from "./project-view.js";
import { validateViewer } from "./roles.js";
import type {
  Delta,
  DeltaEntry,
  DeltaSections,
  GateView,
  GrantView,
  View,
  ViewerIdentity,
} from "./types.js";

/** The union of the grants in `pre` and `post` (a grant id is immutable, so `post` wins ties). */
export function mergeGrants(
  pre: Snapshot<SessionState>,
  post: Snapshot<SessionState>,
): Record<GrantId, Grant> {
  const out: Record<GrantId, Grant> = {};
  for (const source of [pre.grants, post.grants]) {
    for (const id of Object.keys(source)) {
      setOwn(out, id, source[id as GrantId]!);
    }
  }
  return out;
}

/** The two entitlement contexts of a delta evaluation (PFR-023, PFR-024). */
export interface DeltaContexts {
  /** Source-side facts: `pre` state, union of grants. */
  readonly pre: EntitlementContext;
  /** Destination-side facts: `post` state, union of grants. */
  readonly post: EntitlementContext;
}

/**
 * The helper that evaluates entitlements for a `(pre, post)` pair: both
 * contexts see the union of the grants of `pre` and `post`, so a `once` grant
 * consumed by the batch still applies to it. `opts.exclude` drops one grant
 * id from the evaluation (what-if for `wouldReveal`). `viewer` must already be
 * validated.
 */
export function buildDeltaContexts(
  def: CompiledGameDefinition,
  pre: Snapshot<SessionState>,
  post: Snapshot<SessionState>,
  viewer: ViewerIdentity,
  opts: { readonly exclude?: GrantId } = {},
): DeltaContexts {
  const { policy } = compileLookups(def);
  const grants = mergeGrants(pre, post);
  const sel =
    opts.exclude === undefined ? { grants } : { grants, exclude: opts.exclude };
  return {
    pre: buildEntitlementContext(policy, pre, viewer, sel),
    post: buildEntitlementContext(policy, post, viewer, sel),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Working zone memberships, copied from `pre` on first touch, to give move positions. */
class Members {
  private readonly zones = new Map<string, CardId[]>();
  constructor(private readonly pre: Snapshot<SessionState>) {}
  get(zone: string): CardId[] {
    let list = this.zones.get(zone);
    if (list === undefined) {
      const z = getOwn(this.pre.zones, zone);
      this.zones.set(zone, (list = z === undefined ? [] : [...z.members]));
    }
    return list;
  }
  set(zone: string, members: CardId[]): void {
    this.zones.set(zone, members);
  }
}

function entriesOf(
  compiled: Compiled,
  ctxs: DeltaContexts,
  tx: readonly Action[],
): DeltaEntry[] {
  const { pre, post } = ctxs;
  const viewer = post.viewer;
  const members = new Members(pre.state);
  const entries: DeltaEntry[] = [];

  // Source-side zone facts come from `pre`, destination-side from `post`; a
  // zone that exists in only one of them is evaluated where it exists.
  const srcCtx = (zone: string): EntitlementContext =>
    hasOwn(pre.state.zones, zone) ? pre : post;
  const dstCtx = (zone: string): EntitlementContext =>
    hasOwn(post.state.zones, zone) ? post : pre;
  const cardGranted = (ctx: EntitlementContext, card: CardId): boolean => {
    const keys = ctx.cardKeys.get(card);
    return (
      keys !== undefined &&
      (keys.has("zone_membership") || keys.has("card_face"))
    );
  };
  const member = (
    ctx: EntitlementContext,
    zone: ZoneId,
    card: CardId,
  ): boolean =>
    isEntitledToZoneKey(ctx, zone, "zone_membership") || cardGranted(ctx, card);
  const ordered = (zone: ZoneId): boolean => {
    const z = getOwn(post.state.zones, zone) ?? getOwn(pre.state.zones, zone);
    return z !== undefined && isZoneOrdered(compiled, zone, z.template);
  };
  const faceOf = (card: CardId): ReturnType<typeof projectFace> | undefined => {
    const c = getOwn(post.state.cards, card);
    return c !== undefined && isEntitledToCardKey(post, card, "card_face")
      ? projectFace(compiled, card, c.metadata, viewer)
      : undefined;
  };

  tx.forEach((action, i) => {
    switch (action.kind) {
      case "move": {
        const from = action.from_zone;
        const to = action.to_zone;
        const fromCtx = srcCtx(from);
        const toCtx = dstCtx(to);
        const fromMember = member(fromCtx, from, action.card_id);
        const toMember = member(toCtx, to, action.card_id);
        const fromList = members.get(from);
        const at = fromList.indexOf(action.card_id);
        const rest = fromList.filter((c) => c !== action.card_id);
        const target = from === to ? rest : members.get(to);
        const position = action.to_position ?? target.length;
        const next = [...target];
        next.splice(position, 0, action.card_id);
        members.set(from, rest);
        members.set(to, next);
        if (!fromMember && !toMember) break;
        const face = faceOf(action.card_id);
        entries.push({
          i,
          kind: "move",
          card_id: action.card_id,
          ...(fromMember ? { from_zone: from } : {}),
          ...(toMember ? { to_zone: to } : {}),
          ...(fromMember &&
          ordered(from) &&
          at >= 0 &&
          isEntitledToZoneKey(fromCtx, from, "zone_order")
            ? { from_position: at }
            : {}),
          ...(toMember &&
          ordered(to) &&
          isEntitledToZoneKey(toCtx, to, "zone_order")
            ? { to_position: position }
            : {}),
          ...(face !== undefined ? { face } : {}),
        });
        break;
      }
      case "flip": {
        const card = getOwn(post.state.cards, action.card_id);
        if (card === undefined || !member(post, card.zone, action.card_id)) {
          break;
        }
        const face = faceOf(action.card_id);
        entries.push({
          i,
          kind: "flip",
          card_id: action.card_id,
          orientation: action.orientation,
          ...(face !== undefined ? { face } : {}),
        });
        break;
      }
      case "set_metadata": {
        const card = getOwn(post.state.cards, action.card_id);
        if (card === undefined || !member(post, card.zone, action.card_id)) {
          break;
        }
        if (!isEntitledToCardKey(post, action.card_id, "card_face")) break;
        const changed: Record<string, JsonValue> = {};
        for (const field of Object.keys(action.fields)) {
          if (hasOwn(card.metadata, field)) {
            setOwn(changed, field, card.metadata[field]!);
          }
        }
        const fields = projectFace(
          compiled,
          action.card_id,
          changed,
          viewer,
        ).metadata;
        if (Object.keys(fields).length === 0) break;
        entries.push({
          i,
          kind: "set_metadata",
          card_id: action.card_id,
          fields,
        });
        break;
      }
      case "shuffle": {
        const ctx = dstCtx(action.zone);
        members.set(action.zone, [...action.permutation]);
        if (!isEntitledToZoneKey(ctx, action.zone, "zone_membership")) break;
        entries.push({
          i,
          kind: "shuffle",
          zone: action.zone,
          ...(isEntitledToZoneKey(ctx, action.zone, "zone_order")
            ? { permutation: [...action.permutation] }
            : {}),
        });
        break;
      }
      case "zone_create": {
        if (action.zone_id === undefined) break;
        members.set(action.zone_id, []);
        if (
          isEntitledToZoneKey(
            dstCtx(action.zone_id),
            action.zone_id,
            "zone_membership",
          )
        ) {
          entries.push({ i, kind: "zone_create", zone_id: action.zone_id });
        }
        break;
      }
      case "zone_destroy": {
        if (
          isEntitledToZoneKey(
            srcCtx(action.zone_id),
            action.zone_id,
            "zone_membership",
          )
        ) {
          entries.push({ i, kind: "zone_destroy", zone_id: action.zone_id });
        }
        break;
      }
      default:
        break;
    }
  });
  return entries;
}

function zoneCountsOf(ctxs: DeltaContexts): Record<ZoneId, number> {
  const { pre, post } = ctxs;
  const out: Record<ZoneId, number> = {};
  for (const id of Object.keys(post.state.zones).sort(compareIds)) {
    const count = post.state.zones[id as ZoneId]!.members.length;
    const before = getOwn(pre.state.zones, id);
    if (before !== undefined && before.members.length === count) continue;
    if (isEntitledToZoneKey(post, id as ZoneId, "zone_count")) {
      setOwn(out, id, count);
    }
  }
  return out;
}

function countersOf(
  compiled: Compiled,
  ctxs: DeltaContexts,
): Record<CounterId, string> {
  const { pre, post } = ctxs;
  const out: Record<CounterId, string> = {};
  for (const counter of compiled.counters) {
    const after = counterValue(counter, post.state);
    if (after === undefined || after === counterValue(counter, pre.state))
      continue;
    if (isCounterVisible(compiled, post, counter)) {
      setOwn(out, counter.id, after.toString());
    }
  }
  return out;
}

function rosterOf(ctxs: DeltaContexts): DeltaSections["roster"] {
  const pre = ctxs.pre.state.roster.seats;
  const post = ctxs.post.state.roster.seats;
  const out: Record<SeatId, View["roster"][SeatId] | null> = {};
  const ids = [...new Set([...Object.keys(pre), ...Object.keys(post)])].sort(
    compareIds,
  );
  for (const id of ids) {
    const a = getOwn(pre, id);
    const b = getOwn(post, id);
    const va = a === undefined ? null : projectSeat(a);
    const vb = b === undefined ? null : projectSeat(b);
    if (!same(va, vb)) setOwn(out, id, vb);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function metaOf(
  compiled: Compiled,
  ctxs: DeltaContexts,
): DeltaSections["meta"] {
  const { viewer } = ctxs.post;
  const a = projectMeta(compiled, ctxs.pre.state, viewer);
  const b = projectMeta(compiled, ctxs.post.state, viewer);
  const out: Record<string, JsonValue | null> = {};
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
    compareIds,
  );
  for (const id of ids) {
    const va = getOwn(a, id) ?? null;
    const vb = getOwn(b, id) ?? null;
    if (!same(va, vb)) setOwn(out, id, vb);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function gatesOf(ctxs: DeltaContexts): DeltaSections["gates"] {
  const { viewer } = ctxs.post;
  const flat = (
    state: Snapshot<SessionState>,
  ): Map<string, { open: boolean; view: GateView }> => {
    const g = projectGates(state, viewer);
    const m = new Map<string, { open: boolean; view: GateView }>();
    for (const id of Object.keys(g.open))
      m.set(id, { open: true, view: g.open[id as GateId]! });
    for (const id of Object.keys(g.resolved)) {
      m.set(id, { open: false, view: g.resolved[id as GateId]! });
    }
    return m;
  };
  const a = flat(ctxs.pre.state);
  const b = flat(ctxs.post.state);
  const out: Record<GateId, GateView | null> = {};
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort(compareIds)) {
    const va = a.get(id);
    const vb = b.get(id);
    if (!same(va ?? null, vb ?? null))
      setOwn(out, id, vb === undefined ? null : vb.view);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function grantsOf(ctxs: DeltaContexts): DeltaSections["grants"] {
  const { pre, post } = ctxs;
  const out: Record<GrantId, GrantView | null> = {};
  const ids = [
    ...new Set([
      ...Object.keys(pre.state.grants),
      ...Object.keys(post.state.grants),
    ]),
  ].sort(compareIds);
  for (const id of ids) {
    const before = getOwn(pre.state.grants, id);
    const after = getOwn(post.state.grants, id);
    if (before === undefined && after !== undefined) {
      if (isGrantVisible(post, after)) setOwn(out, id, projectGrantView(after));
    } else if (before !== undefined && after === undefined) {
      if (isGrantVisible(pre, before)) setOwn(out, id, null);
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * The delta of a batch for a validated viewer, evaluated with the given
 * contexts (PFR-024..027). Internal building block shared with `wouldReveal`.
 */
export function deltaFor(
  compiled: Compiled,
  ctxs: DeltaContexts,
  seq: number,
  actions: readonly Action[],
): Delta {
  const { pre, post } = ctxs;
  const control = same(projectControl(pre.state), projectControl(post.state))
    ? undefined
    : projectControl(post.state);
  const roster = rosterOf(ctxs);
  const meta = metaOf(compiled, ctxs);
  const gates = gatesOf(ctxs);
  const grants = grantsOf(ctxs);
  return makeDelta({
    seq,
    entries: entriesOf(compiled, ctxs, actions),
    zoneCounts: zoneCountsOf(ctxs),
    counters: countersOf(compiled, ctxs),
    ...(control !== undefined ? { control } : {}),
    ...(roster !== undefined ? { roster } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(gates !== undefined ? { gates } : {}),
    ...(grants !== undefined ? { grants } : {}),
    ...(pre.state.lifecycle !== post.state.lifecycle
      ? { lifecycle: post.state.lifecycle }
      : {}),
    ...(post.state.outcome !== undefined &&
    !same(pre.state.outcome ?? null, post.state.outcome)
      ? { outcome: cloneJson(post.state.outcome) }
      : {}),
  });
}

/**
 * Projects the batch that took `pre` to `post` for `viewer` (PFR-023..027):
 * entries for card movement, the post-batch visible value of every changed
 * section. Entitlements use the union of the grants of `pre` and `post`;
 * source facts come from `pre`, destination facts from `post`. Pure; the batch
 * is not re-applied. Never emits principal, event id or receipts.
 */
export function projectDelta(
  def: CompiledGameDefinition,
  pre: Snapshot<SessionState>,
  post: Snapshot<SessionState>,
  batch: PrivilegedBatch,
  viewer: ViewerIdentity,
): Result<Delta> {
  const compiled = compileLookups(def);
  const valid = validateViewer(compiled.registry, post, viewer);
  if (!valid.ok) return valid;
  const tx = openBatch(batch);
  if (post.seq !== pre.seq + 1 || tx.seq !== post.seq) {
    return err({
      code: "REPLAY_INVALID",
      detail: "batch does not match pre/post",
    });
  }
  const identity: ViewerIdentity =
    viewer.subject === undefined
      ? { role: viewer.role }
      : { role: viewer.role, subject: viewer.subject };
  return ok(
    deltaFor(
      compiled,
      buildDeltaContexts(def, pre, post, identity),
      post.seq,
      tx.actions,
    ),
  );
}

/** The role-filtered log entry of a batch (PFR-028): exactly `projectDelta`'s result. */
export function projectLogEntry(
  def: CompiledGameDefinition,
  pre: Snapshot<SessionState>,
  post: Snapshot<SessionState>,
  batch: PrivilegedBatch,
  viewer: ViewerIdentity,
): Result<Delta> {
  return projectDelta(def, pre, post, batch, viewer);
}
