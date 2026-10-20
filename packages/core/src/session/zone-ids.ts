import type { PlayerId, SeatId, TeamId, ZoneId } from "./ids.js";
import { getOwn } from "./records.js";
import type { Snapshot } from "./snapshot.js";
import type { SessionState } from "./state.js";

/** The owner token of a derived zone id: the owner id, or `_` for an ownerless template (KBR-006). */
export function ownerToken(owner: string | undefined): string {
  return owner ?? "_";
}

/** Key of `zoneOrdinals`: `<template>/<ownerToken>`. */
export function ordinalKey(
  template: string,
  owner: string | undefined,
): string {
  return `${template}/${ownerToken(owner)}`;
}

/** Derived zone id `<template>/<ownerToken>/<ordinal>` (KBR-006). Length is not checked here. */
export function deriveZoneId(
  template: string,
  owner: string | undefined,
  ordinal: number,
): ZoneId {
  return `${ordinalKey(template, owner)}/${String(ordinal)}` as ZoneId;
}

/**
 * The id the next `zone_create(template, owner)` receives (KFR-049, Req FR-194). `pending` is the
 * number of earlier `zone_create`s for the same `(template, owner)` in the same batch that are
 * not yet in `state`. Pure; does not check that the template or owner exist, nor the id length:
 * `zone_create` itself rejects an over-long id.
 */
export function nextZoneId(
  state: Snapshot<SessionState>,
  template: string,
  owner?: SeatId | TeamId | PlayerId,
  pending = 0,
): ZoneId {
  const used = getOwn(state.zoneOrdinals, ordinalKey(template, owner)) ?? 0;
  return deriveZoneId(template, owner, used + 1 + pending);
}
