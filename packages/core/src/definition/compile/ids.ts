import type { ErrorCollector } from "./errors.js";

/** P1 id charset (DFR-027): 1-128 characters of `[A-Za-z0-9_.:/-]`. */
const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;

/** `gameId` charset (DFR-011). */
const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const isValidId = (id: string): boolean => ID_PATTERN.test(id);

export const isValidGameId = (id: string): boolean => GAME_ID_PATTERN.test(id);

function shown(id: string): string {
  return JSON.stringify(id.length > 40 ? `${id.slice(0, 40)}…` : id);
}

/**
 * Checks a compiled id against the P1 charset. On failure reports
 * `INVALID_VALUE` at `path` naming `entity` (the id itself by default; for
 * generated ids pass the path of the generator or `prefix` that produced it).
 * Returns whether the id is valid.
 */
export function checkId(
  c: ErrorCollector,
  id: string,
  path: string,
  what: string,
  entity: string = id,
): boolean {
  if (isValidId(id)) return true;
  c.add(
    "INVALID_VALUE",
    path,
    `${what} ${shown(id)} must be 1-128 characters of [A-Za-z0-9_.:/-]`,
    entity,
  );
  return false;
}
