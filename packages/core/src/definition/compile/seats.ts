import type { SeatId, TeamId } from "../../session/ids.js";
import type { SeatDecl } from "../types.js";
import type { ErrorCollector } from "./errors.js";
import { checkId } from "./ids.js";
import { MAX_SEATS, MAX_TEAMS } from "./limits.js";
import {
  has,
  indexPath,
  joinPath,
  member,
  readArray,
  readInteger,
  readObject,
  readString,
} from "./strict.js";

export interface CompiledSeats {
  readonly seats: readonly SeatDecl[];
  readonly teams: readonly TeamId[];
}

const DEFAULT_PREFIX = "seat";

/** Compiles `seats` (DFR-012). Returns `undefined` when anything was reported. */
export function compileSeats(
  c: ErrorCollector,
  raw: unknown,
  path: string,
): CompiledSeats | undefined {
  const before = c.count;
  const obj = readObject(c, raw, path, ["list", "teams", "count", "prefix"]);
  if (obj === undefined) return undefined;

  const hasList = has(obj, "list");
  const hasCount = has(obj, "count");
  let result: CompiledSeats | undefined;

  if (hasList && hasCount) {
    c.add(
      "INVALID_VALUE",
      path,
      "exactly one of list or count is allowed, got both",
    );
  } else if (!hasList && !hasCount) {
    c.add(
      "INVALID_VALUE",
      path,
      "exactly one of list or count is required, got neither",
    );
  } else if (hasCount) {
    result = compileCount(c, obj, path);
  } else {
    result = compileList(c, obj, path);
  }
  return c.count === before ? result : undefined;
}

function compileCount(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  path: string,
): CompiledSeats | undefined {
  if (has(obj, "teams")) {
    c.add(
      "INVALID_VALUE",
      joinPath(path, "teams"),
      "teams are only allowed together with list, not count",
    );
  }
  const countPath = joinPath(path, "count");
  const count = readInteger(c, member(obj, "count"), countPath);
  let prefix = DEFAULT_PREFIX;
  if (has(obj, "prefix")) {
    const p = readString(c, member(obj, "prefix"), joinPath(path, "prefix"));
    if (p === undefined) return undefined;
    prefix = p;
  }
  if (count === undefined) return undefined;
  if (count < 1) {
    c.add(
      "INVALID_VALUE",
      countPath,
      `at least 1 seat is required, got ${count}`,
    );
    return undefined;
  }
  if (count > MAX_SEATS) {
    c.add(
      "LIMIT_EXCEEDED",
      path,
      `at most ${MAX_SEATS} seats are allowed, got ${count}`,
    );
    return undefined;
  }
  const seats: SeatDecl[] = [];
  for (let i = 1; i <= count; i += 1) {
    const id = `${prefix}${i}`;
    // Every generated id shares the prefix, so one report names the first.
    if (!checkId(c, id, joinPath(path, "prefix"), "generated seat id")) {
      return undefined;
    }
    seats.push({ id: id as SeatId });
  }
  return { seats, teams: [] };
}

function compileList(
  c: ErrorCollector,
  obj: Readonly<Record<string, unknown>>,
  path: string,
): CompiledSeats | undefined {
  if (has(obj, "prefix")) {
    c.add(
      "INVALID_VALUE",
      joinPath(path, "prefix"),
      "prefix is only allowed together with count, not list",
    );
  }
  // Teams first: seats refer to them.
  const teamsPath = joinPath(path, "teams");
  const teams = new Map<string, number>(); // team id -> seat count
  const teamPaths = new Map<string, string>();
  if (has(obj, "teams")) {
    const rawTeams = readArray(c, member(obj, "teams"), teamsPath);
    if (rawTeams !== undefined) {
      if (rawTeams.length > MAX_TEAMS) {
        c.add(
          "LIMIT_EXCEEDED",
          teamsPath,
          `at most ${MAX_TEAMS} teams are allowed, got ${rawTeams.length}`,
        );
      }
      rawTeams.forEach((item, i) => {
        const p = indexPath(teamsPath, i);
        const id = readString(c, item, p);
        if (id === undefined) return;
        if (!checkId(c, id, p, "team id")) return;
        if (teams.has(id)) {
          c.add("DUPLICATE_ID", p, `duplicate team id "${id}"`, id);
          return;
        }
        teams.set(id, 0);
        teamPaths.set(id, p);
      });
    }
  }

  const listPath = joinPath(path, "list");
  const rawList = readArray(c, member(obj, "list"), listPath);
  if (rawList === undefined) return undefined;
  if (rawList.length === 0) {
    c.add("INVALID_VALUE", listPath, "at least 1 seat is required");
    return undefined;
  }
  if (rawList.length > MAX_SEATS) {
    c.add(
      "LIMIT_EXCEEDED",
      path,
      `at most ${MAX_SEATS} seats are allowed, got ${rawList.length}`,
    );
    return undefined;
  }

  const seen = new Set<string>();
  const seats: SeatDecl[] = [];
  rawList.forEach((item, i) => {
    const p = indexPath(listPath, i);
    const entry = readObject(c, item, p, ["id", "team"], ["id"]);
    if (entry === undefined) return;
    let id: string | undefined;
    if (has(entry, "id")) {
      id = readString(c, member(entry, "id"), joinPath(p, "id"));
      if (id !== undefined) {
        if (!checkId(c, id, joinPath(p, "id"), "seat id")) id = undefined;
        else if (seen.has(id)) {
          c.add(
            "DUPLICATE_ID",
            joinPath(p, "id"),
            `duplicate seat id "${id}"`,
            id,
          );
          id = undefined;
        } else seen.add(id);
      }
    }
    let team: string | undefined;
    if (has(entry, "team")) {
      const t = readString(c, member(entry, "team"), joinPath(p, "team"));
      if (t !== undefined) {
        const n = teams.get(t);
        if (n === undefined) {
          c.add(
            "UNKNOWN_REFERENCE",
            joinPath(p, "team"),
            `seat refers to undeclared team "${t}"`,
            t,
          );
        } else {
          teams.set(t, n + 1);
          team = t;
        }
      }
    }
    if (id !== undefined) {
      seats.push(
        team === undefined
          ? { id: id as SeatId }
          : { id: id as SeatId, team: team as TeamId },
      );
    }
  });

  for (const [team, n] of teams) {
    if (n === 0) {
      c.add(
        "INVALID_VALUE",
        teamPaths.get(team) ?? teamsPath,
        `team "${team}" has no seat`,
        team,
      );
    }
  }
  return { seats, teams: [...teams.keys()] as TeamId[] };
}
