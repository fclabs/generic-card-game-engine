import { ok } from "../../errors/result.js";
import type { Result } from "../../errors/result.js";
import type {
  Action,
  DrawMacro,
  ResetToZoneMacro,
  ZoneMergeMacro,
} from "../actions.js";
import type { CardId, ZoneId } from "../ids.js";
import type { Snapshot } from "../snapshot.js";
import type { ZoneState } from "../state.js";
import type { ApplyContext } from "./context.js";

/**
 * Macro expansion (KFR-045..048). Each expander reads the *working state* as it stands when the
 * macro's turn comes (earlier actions of the batch are already applied) and returns explicit
 * primitives only; it never writes. Failures carry the macro's input index.
 */

function lookup(
  ctx: ApplyContext,
  id: ZoneId,
  field: string,
): Result<Snapshot<ZoneState>> {
  const zone = ctx.work.zone(id);
  if (zone === undefined) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `unknown zone: ${id}`,
      ctx.path(`.${field}`),
    );
  }
  return ok(zone);
}

/**
 * Moves of `cards` (all currently in `from`) into `to`, appended in order. An ordered `to` gets
 * explicit positions `base + i` (`base` = `explicit` or the current length plus `offset`); an
 * unordered `to` gets none (KFR-045).
 */
function moves(
  ctx: ApplyContext,
  cards: readonly CardId[],
  from: ZoneId,
  to: ZoneId,
  toZone: Snapshot<ZoneState>,
  explicit: number | undefined,
  offset = 0,
): Action[] {
  const ordered = ctx.index.isOrdered(to, toZone);
  const base = explicit ?? toZone.members.length + offset;
  return cards.map((card_id, i) => ({
    kind: "move",
    card_id,
    from_zone: from,
    to_zone: to,
    ...(ordered ? { to_position: base + i } : {}),
  }));
}

export function expandDraw(
  ctx: ApplyContext,
  macro: DrawMacro,
): Result<readonly Action[]> {
  const from = lookup(ctx, macro.from_zone, "from_zone");
  if (!from.ok) return from;
  const to = lookup(ctx, macro.to_zone, "to_zone");
  if (!to.ok) return to;
  if (macro.from_zone === macro.to_zone) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `draw from_zone and to_zone are the same zone: ${macro.from_zone}`,
      ctx.path(".to_zone"),
    );
  }
  if (!ctx.index.isOrdered(macro.from_zone, from.value)) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `draw from unordered zone ${macro.from_zone}`,
      ctx.path(".from_zone"),
    );
  }
  if (from.value.members.length < macro.count) {
    return ctx.fail(
      "EMPTY_ZONE",
      `zone ${macro.from_zone} holds ${String(from.value.members.length)} cards, cannot draw ${String(macro.count)}`,
      ctx.path(".count"),
    );
  }
  const top = from.value.members.slice(0, macro.count);
  return ok(
    moves(
      ctx,
      top,
      macro.from_zone,
      macro.to_zone,
      to.value,
      macro.to_position,
    ),
  );
}

export function expandZoneMerge(
  ctx: ApplyContext,
  macro: ZoneMergeMacro,
): Result<readonly Action[]> {
  const src = lookup(ctx, macro.src_zone, "src_zone");
  if (!src.ok) return src;
  const dst = lookup(ctx, macro.dst_zone, "dst_zone");
  if (!dst.ok) return dst;
  if (macro.src_zone === macro.dst_zone) {
    return ctx.fail(
      "MALFORMED_ACTION",
      `zone_merge src_zone and dst_zone are the same zone: ${macro.src_zone}`,
      ctx.path(".dst_zone"),
    );
  }
  for (const [id, zone, field] of [
    [macro.src_zone, src.value, "src_zone"],
    [macro.dst_zone, dst.value, "dst_zone"],
  ] as const) {
    if (zone.template === undefined) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `zone ${id} is not template-instantiated`,
        ctx.path(`.${field}`),
      );
    }
  }
  return ok([
    ...moves(
      ctx,
      src.value.members,
      macro.src_zone,
      macro.dst_zone,
      dst.value,
      undefined,
    ),
    { kind: "zone_destroy", zone_id: macro.src_zone },
  ]);
}

export function expandResetToZone(
  ctx: ApplyContext,
  macro: ResetToZoneMacro,
): Result<readonly Action[]> {
  const to = lookup(ctx, macro.to_zone, "to_zone");
  if (!to.ok) return to;
  const out: Action[] = [];
  const faceUp: CardId[] = [];
  const seen = new Set<string>();
  let moved = 0;
  for (const [i, id] of macro.zones.entries()) {
    const zone = lookup(ctx, id, `zones[${String(i)}]`);
    if (!zone.ok) return zone;
    if (id === macro.to_zone) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `reset_to_zone to_zone ${id} is also listed in zones`,
        ctx.path(`.zones[${String(i)}]`),
      );
    }
    if (seen.has(id)) {
      return ctx.fail(
        "MALFORMED_ACTION",
        `reset_to_zone lists zone ${id} twice`,
        ctx.path(`.zones[${String(i)}]`),
      );
    }
    seen.add(id);
    out.push(
      ...moves(
        ctx,
        zone.value.members,
        id,
        macro.to_zone,
        to.value,
        undefined,
        moved,
      ),
    );
    moved += zone.value.members.length;
    for (const card of zone.value.members) {
      if (ctx.work.card(card)?.orientation === "face_up") faceUp.push(card);
    }
  }
  for (const card_id of faceUp) {
    out.push({ kind: "flip", card_id, orientation: "face_down" });
  }
  return ok(out);
}
