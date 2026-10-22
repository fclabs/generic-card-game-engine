import type { CompiledGameDefinition } from "../definition/types.js";
import type { GateLike, ViewLike, ZoneLike } from "./oracle.testing.js";

/**
 * The documented meaning of a `Delta` (spec §4.4, PFR-024..026), applied to a view: used by the
 * consistency property (VC-342). A consumer holds the definition, so it knows which zones are
 * ordered and (for template zones, whose ids are `<template>/<owner or _>/<n>`) who owns them.
 *
 * What a delta cannot carry (spec §4.4, D-019, D-023), and how the fold treats it:
 * - a `move` entry has no orientation, so a card that newly enters the view has orientation
 *   `"?"` (unknown until a `flip` entry or the next resync); a card that leaves the view is
 *   forgotten;
 * - content that appears only because a grant was added (or a `top` grant re-resolved) is not in
 *   the delta; content that was visible through a grant that has since ended stays in the fold
 *   (the delta carries no removals for it). The property restricts itself accordingly.
 */

export interface FoldMember {
  id: string;
  orientation: string;
  face?: { type?: string; metadata: Record<string, unknown> };
}
export interface FoldZone {
  ordered: boolean;
  owner?: string;
  count?: number;
  members?: FoldMember[];
  orderKnown?: boolean;
}
export interface FoldedView {
  seq: number;
  lifecycle: string;
  zones: Record<string, FoldZone>;
  counters: Record<string, string>;
  control: unknown;
  roster: Record<string, unknown>;
  meta: Record<string, unknown>;
  gates: {
    open: Record<string, GateLike>;
    resolved: Record<string, GateLike>;
  };
  grants: Record<string, unknown>;
  outcome?: unknown;
}

/** The delta fields the fold reads (a `Delta` is assignable to it). */
export interface DeltaLike {
  readonly seq: number;
  readonly entries: readonly {
    readonly kind: string;
    readonly card_id?: string;
    readonly from_zone?: string;
    readonly to_zone?: string;
    readonly from_position?: number;
    readonly to_position?: number;
    readonly face?: unknown;
    readonly orientation?: string;
    readonly fields?: unknown;
    readonly zone?: string;
    readonly permutation?: readonly string[];
    readonly zone_id?: string;
  }[];
  readonly zoneCounts: Readonly<Record<string, number>>;
  readonly counters: Readonly<Record<string, string>>;
  readonly control?: unknown;
  readonly roster?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly gates?: Readonly<Record<string, GateLike | null>>;
  readonly grants?: Readonly<Record<string, unknown>>;
  readonly lifecycle?: string;
  readonly outcome?: unknown;
}

export interface FoldResult {
  readonly view: FoldedView;
  /** Inconsistencies found inside the delta itself (for example a wrong `from_position`). */
  readonly problems: string[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function zoneInfo(
  def: CompiledGameDefinition,
  id: string,
): { ordered: boolean; owner?: string } {
  const configured = def.zones.find((z) => z.id === id);
  if (configured !== undefined) {
    return {
      ordered: configured.ordered,
      ...(configured.owner !== undefined ? { owner: configured.owner } : {}),
    };
  }
  const [name, owner] = id.split("/");
  const template = def.zoneTemplates.find((t) => t.name === name);
  return {
    ordered: template?.ordered ?? false,
    ...(owner !== undefined && owner !== "_" ? { owner } : {}),
  };
}

const byId = (a: FoldMember, b: FoldMember): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Applies `delta` to `view` (a `View` or a previous fold) without touching either. */
export function foldDelta(
  def: CompiledGameDefinition,
  view: ViewLike | FoldedView,
  delta: DeltaLike,
): FoldResult {
  const m = clone(view) as FoldedView;
  const problems: string[] = [];
  const block = (zone: string): FoldZone => {
    const existing = Object.hasOwn(m.zones, zone) ? m.zones[zone] : undefined;
    if (existing !== undefined) return existing;
    const created: FoldZone = { ...zoneInfo(def, zone) };
    m.zones[zone] = created;
    return created;
  };
  const take = (
    card: string,
  ): { zone: string; index: number; member: FoldMember } | undefined => {
    for (const [zone, z] of Object.entries(m.zones)) {
      const index = z.members?.findIndex((x) => x.id === card) ?? -1;
      if (index >= 0 && z.members !== undefined) {
        const [member] = z.members.splice(index, 1);
        return member === undefined ? undefined : { zone, index, member };
      }
    }
    return undefined;
  };
  const find = (card: string): FoldMember | undefined => {
    for (const z of Object.values(m.zones)) {
      const hit = z.members?.find((x) => x.id === card);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  for (const e of delta.entries) {
    switch (e.kind) {
      case "move": {
        if (e.card_id === undefined) break;
        const was = take(e.card_id);
        if (
          was !== undefined &&
          e.from_zone === was.zone &&
          e.from_position !== undefined &&
          m.zones[was.zone]?.orderKnown === true &&
          was.index !== e.from_position
        ) {
          problems.push(
            `from_position ${String(e.from_position)} but ${e.card_id} was at ${String(was.index)} in ${was.zone}`,
          );
        }
        if (e.to_zone === undefined) break;
        const z = block(e.to_zone);
        const member: FoldMember = {
          id: e.card_id,
          orientation: was?.member.orientation ?? "?",
        };
        if (e.face !== undefined) member.face = clone(e.face) as never;
        if (z.members === undefined) {
          z.members = [];
          z.orderKnown = e.to_position !== undefined;
        }
        if (z.ordered && z.orderKnown === true) {
          if (e.to_position === undefined) {
            problems.push(
              `ordered zone ${e.to_zone} entry without to_position`,
            );
            z.members.push(member);
          } else {
            z.members.splice(e.to_position, 0, member);
          }
        } else {
          z.members.push(member);
          z.members.sort(byId);
        }
        break;
      }
      case "flip": {
        if (e.card_id === undefined) break;
        const member = find(e.card_id);
        if (member === undefined) break;
        member.orientation = e.orientation ?? member.orientation;
        if (e.face !== undefined) member.face = clone(e.face) as never;
        else delete member.face;
        break;
      }
      case "set_metadata": {
        if (e.card_id === undefined) break;
        const member = find(e.card_id);
        if (member === undefined) break;
        member.face = {
          ...(member.face ?? {}),
          metadata: {
            ...(member.face?.metadata ?? {}),
            ...(clone(e.fields) as Record<string, unknown>),
          },
        };
        break;
      }
      case "shuffle": {
        if (e.zone === undefined || e.permutation === undefined) break;
        const z = Object.hasOwn(m.zones, e.zone) ? m.zones[e.zone] : undefined;
        if (z?.members === undefined) break;
        const known = new Map(z.members.map((x) => [x.id, x]));
        z.members = e.permutation.flatMap((id) => {
          const hit = known.get(id);
          return hit === undefined ? [] : [hit];
        });
        break;
      }
      case "zone_create": {
        if (e.zone_id === undefined) break;
        m.zones[e.zone_id] = {
          ...zoneInfo(def, e.zone_id),
          members: [],
          orderKnown: true,
        };
        break;
      }
      case "zone_destroy": {
        if (e.zone_id !== undefined) delete m.zones[e.zone_id];
        break;
      }
      default:
        break;
    }
  }
  for (const [zone, count] of Object.entries(delta.zoneCounts)) {
    block(zone).count = count;
  }
  Object.assign(m.counters, delta.counters);
  if (delta.control !== undefined) m.control = clone(delta.control);
  if (delta.lifecycle !== undefined) m.lifecycle = delta.lifecycle;
  if (delta.outcome !== undefined) m.outcome = clone(delta.outcome);
  for (const [seat, value] of Object.entries(delta.roster ?? {})) {
    if (value === null) delete m.roster[seat];
    else m.roster[seat] = clone(value);
  }
  for (const [schema, value] of Object.entries(delta.meta ?? {})) {
    if (value === null) delete m.meta[schema];
    else m.meta[schema] = clone(value);
  }
  for (const [id, gate] of Object.entries(delta.gates ?? {})) {
    delete m.gates.open[id];
    delete m.gates.resolved[id];
    if (gate !== null) {
      (gate.submitted !== undefined ? m.gates.open : m.gates.resolved)[id] =
        clone(gate);
    }
  }
  for (const [id, grant] of Object.entries(delta.grants ?? {})) {
    if (grant === null) delete m.grants[id];
    else m.grants[id] = clone(grant);
  }
  m.seq = delta.seq;
  return { view: m, problems };
}

export type { ZoneLike };
