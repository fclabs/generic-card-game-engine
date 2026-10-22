import fc from "fast-check";
import type {
  Audience,
  CompiledGameDefinition,
  FieldVisibility,
  VisibilityRules,
} from "../definition/types.js";
import type { Result } from "../errors/result.js";
import type { Transaction } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action, Macro } from "../session/actions.js";
import { apply } from "../session/apply/index.js";
import {
  Tape,
  buildPropertyDefinition,
  generateBatch,
  propertyStart,
} from "../session/generators.testing.js";
import { cardId, seatId, teamId, zoneId } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { JsonValue, SessionState } from "../session/state.js";
import { sealBatch } from "./privileged-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import type { ViewerIdentity } from "./types.js";

/**
 * Generators for the Phase 3 visibility properties (VC-340..344, VC-376).
 *
 * A *case* is a random definition (random `visibility` blocks per zone, template, counter,
 * card-metadata field and meta field; three custom roles; registered or unregistered
 * privileged roles), a canary-laden session over it, and the random legal batches that took
 * the session through up to `batches` states. Everything is driven by a `Tape`, so a case is
 * reproducible from its tape (fast-check prints the seed; the property files add the class).
 *
 * Canary tokens: every secret-bearing datum carries a unique token matching `CANARY_TOKEN`
 * (`zq<letters><n>x`: card ids and types, metadata strings, meta strings, sealed gate payloads,
 * event ids, principals) or a 7+ digit number (`COUNTER_TOKEN`: counter values and meta
 * integers). A view or delta that contains a token the oracle does not entitle the viewer to
 * is a leak.
 */

/** Role classes of PNFR-001: every class gets its own generated-case budget. */
export const ROLE_CLASSES = [
  "player",
  "render",
  "dealer",
  "auditor",
  "custom",
] as const;
export type RoleClass = (typeof ROLE_CLASSES)[number];

/** Letters-and-digits canary strings. */
export const CANARY_TOKEN = /zq[a-z]+\d+x/g;
/** Numeric canaries: counter values (seven or more digits). */
export const COUNTER_TOKEN = /\d{7,}/g;

/** All canary tokens (string and numeric) occurring in `text`. */
export function tokensOf(text: string): Set<string> {
  return new Set([
    ...(text.match(CANARY_TOKEN) ?? []),
    ...(text.match(COUNTER_TOKEN) ?? []),
  ]);
}

/** The four grantable view keys (`viewKeys` of every generated definition). */
export const ZONE_KEYS = [
  "zone_count",
  "zone_membership",
  "zone_order",
  "card_face",
] as const;

const ROLE_KEYS = [
  "default",
  "player",
  "render",
  "dealer",
  "auditor",
  "spectator",
  "coach",
  "captain",
] as const;
const FIELD_VISIBILITY: readonly (FieldVisibility | undefined)[] = [
  "public",
  "subject",
  "secret",
  undefined,
];
const SEATS = ["s1", "s2", "s3"] as const;

function mustId<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}

/** A fast-check arbitrary for a long enough tape (definition + stream). */
export const caseTape: fc.Arbitrary<number[]> = fc.array(
  fc.nat({ max: 1_000_000 }),
  { minLength: 64, maxLength: 700 },
);

function genRules(
  t: Tape,
  owned: boolean,
  forced: readonly string[],
): VisibilityRules {
  const audiences: readonly Audience[] = owned
    ? ["public", "hidden", "owner", "team", "owner", "team"]
    : ["public", "hidden", "public"];
  const rules: Record<string, Audience> = {};
  for (const key of ROLE_KEYS) {
    if (t.chance(key === "default" ? 55 : 35)) rules[key] = t.pick(audiences);
  }
  for (const key of forced) rules[key] ??= t.pick(audiences);
  return rules;
}

export interface DefinitionOptions {
  /** Privileged roles that must be registered (some `visibility` block keyed by them). */
  readonly register?: readonly ("dealer" | "auditor")[];
  /** Registration of the other privileged roles is random when not forced. */
  readonly randomRegistration?: boolean;
}

/**
 * A random definition over the Phase 1 property fixture (3 seats on 2 teams, 4 zones, 3
 * templates, 5 counters, 3 meta schemas): canary card ids/types/metadata, canary counter
 * values, random visibility everywhere, three custom roles and the four view keys.
 */
export function buildVisibilityDefinition(
  t: Tape,
  canary: () => string,
  options: DefinitionOptions = {},
): CompiledGameDefinition {
  const base = buildPropertyDefinition();
  const register = options.register ?? [];
  const forcedFor = (index: number): readonly string[] =>
    // Force registration on the first zone / template / counter blocks.
    register.filter((_, i) => i === index % Math.max(register.length, 1));
  const zone = (
    id: string,
    ordered: boolean,
    owned: string | undefined,
    n: number,
  ) => ({
    id: mustId(zoneId(id)),
    ordered,
    ...(owned !== undefined
      ? {
          owner: owned.startsWith("t")
            ? mustId(teamId(owned))
            : mustId(seatId(owned)),
        }
      : {}),
    visibility: genRules(t, owned !== undefined, forcedFor(n)),
  });
  const zones = [
    zone("deck", true, undefined, 0),
    zone("discard", true, "t2", 1),
    zone("table", false, undefined, 2),
    zone("hold", false, "s2", 3),
  ];
  const zoneTemplates = base.zoneTemplates.map((template, i) => ({
    ...template,
    visibility: genRules(
      t,
      template.ownerRule !== "none",
      i === 0 ? register : [],
    ),
  }));
  const counterBase = (id: string) => {
    const found = base.counters.find((c) => c.id === id);
    if (found === undefined) throw new Error(`no counter ${id}`);
    return found;
  };
  const withRules = (
    id: string,
    over: Partial<CompiledGameDefinition["counters"][number]>,
    owned: boolean,
    forced: readonly string[] = [],
  ) => ({
    ...counterBase(id),
    ...over,
    visibility: genRules(t, owned, forced),
  });
  const counters = [
    withRules("pot", { initial: 1_000_303n }, false, register.slice(0, 1)),
    withRules(
      "bank",
      {
        owner: "player",
        ownerId: "s1",
        initial: 9_000_137n,
        min: 8_000_000n,
        max: 9_999_999n,
      },
      true,
    ),
    withRules(
      "reserve",
      {
        owner: "team",
        ownerId: "t2",
        initial: 5_000_211n,
        min: 4_000_000n,
        max: 5_999_999n,
      },
      true,
    ),
    withRules(
      "tally",
      { initial: 3_000_049n, min: 2_000_000n, max: 3_999_999n },
      false,
    ),
    // Derived: half the time it declares its own visibility, otherwise it inherits (PBR-011).
    {
      ...counterBase("total"),
      derivedSpec: { kind: "zone_size" as const, zone: zones[0]!.id },
      visibility: t.chance(50) ? genRules(t, false, []) : {},
    },
  ];
  const metaVis = (field: string): Record<string, FieldVisibility> => {
    const v = FIELD_VISIBILITY[t.int(FIELD_VISIBILITY.length)];
    return v === undefined ? {} : { [field]: v };
  };
  const cards = base.cards.map((card, i) => ({
    ...card,
    id: mustId(cardId(`zqcard${String(i + 1)}x`)),
    ...(i % 3 === 0 ? { type: undefined } : { type: canary() }),
    metadataSchema: {
      rank: "int" as const,
      suit: "string" as const,
      tag: "string" as const,
    },
    startingZone: t.pick(zones.map((z) => z.id)),
    initialMetadata: { rank: 1000 + i, suit: canary(), tag: canary() },
    metadataVisibility: {
      ...metaVis("rank"),
      ...metaVis("suit"),
      ...metaVis("tag"),
    },
  }));
  // `type: undefined` is not a valid optional property under exactOptionalPropertyTypes.
  const typedCards = cards.map((card) => {
    const { type, ...rest } = card;
    return type === undefined ? rest : { ...rest, type };
  });
  const metaSchemas = base.metaSchemas.map((schema) => ({
    ...schema,
    fieldVisibility: {
      ...metaVis(Object.keys(schema.fields)[0] ?? "x"),
    },
  }));
  return {
    ...base,
    roles: [
      { id: "spectator", subject: "forbidden" },
      { id: "coach", subject: "optional" },
      { id: "captain", subject: "required" },
    ],
    zones,
    zoneTemplates,
    counters,
    cards: typedCards,
    metaSchemas,
    viewKeys: [...ZONE_KEYS],
  };
}

/** Makes a unique canary string `zq<kind><n>x` per call. */
export function canarySource(): (kind?: string) => string {
  let n = 0;
  return (kind = "v") => {
    n += 1;
    return `zq${kind}${String(n)}x`;
  };
}

/**
 * Rewrites generated actions: injects canary payloads (metadata strings, meta strings and
 * seat-keyed objects, sealed gate payloads) and retargets grant keys to the four view keys.
 * With `grants: false` every grant action becomes a harmless `control_advance`.
 */
export function makeRewrite(
  canary: (kind?: string) => string,
  grants: boolean,
): (action: Action | Macro, t: Tape, bad: boolean) => Action | Macro {
  let ints = 0;
  return (action, t, bad) => {
    if (action.kind === "grant_view" || action.kind === "revoke_view") {
      if (!grants) return A.advance(1);
      if (action.kind === "grant_view" && action.keys.includes("hand")) {
        const keys = ZONE_KEYS.filter(() => t.chance(50));
        return {
          ...action,
          keys: keys.length === 0 ? [t.pick(ZONE_KEYS)] : keys,
        };
      }
      return action;
    }
    if (bad) return action;
    if (action.kind === "set_metadata") {
      const fields: Record<string, JsonValue> = { ...action.fields };
      if (typeof fields.suit === "string") fields.suit = canary("m");
      if (t.chance(40)) fields.tag = canary("t");
      return { ...action, fields };
    }
    if (action.kind !== "meta") return action;
    const payload = action.payload as { [key: string]: JsonValue };
    if (action.schema_id === "notes" && typeof payload.text === "string") {
      return { ...action, payload: { text: canary("n") } };
    }
    if (action.schema_id === "score" && typeof payload.points === "number") {
      ints += 1;
      return { ...action, payload: { points: 700_000_000 + ints } };
    }
    if (action.schema_id === "blob") {
      const data: JsonValue = t.chance(60)
        ? Object.fromEntries(
            SEATS.filter(() => t.chance(60)).map((s) => [s, canary("b")]),
          )
        : [canary("b"), { k: canary("b") }];
      return { ...action, payload: { data } };
    }
    if (action.schema_id === "engine.gate_submit") {
      return {
        ...action,
        payload: { ...payload, payload: { bid: canary("g") } },
      };
    }
    return action;
  };
}

/** One committed transaction of a case: the states around it and its sealed batch. */
export interface CaseStep {
  readonly pre: Snapshot<SessionState>;
  readonly post: Snapshot<SessionState>;
  readonly batch: PrivilegedBatch;
  readonly tx: Transaction;
}

export interface VisibilityCase {
  readonly def: CompiledGameDefinition;
  readonly start: Snapshot<SessionState>;
  /** Committed transactions in order (failed batches are skipped). */
  readonly steps: readonly CaseStep[];
  /** `[start, ...steps.map(post)]`. */
  readonly states: readonly Snapshot<SessionState>[];
}

export interface CaseOptions extends DefinitionOptions {
  /** Number of batches attempted (default 6). */
  readonly batches?: number;
  /** Whether grant actions are generated (default true). */
  readonly grants?: boolean;
}

/** Builds a case from a tape. */
export function buildCase(
  tape: readonly number[],
  options: CaseOptions = {},
): VisibilityCase {
  const t = new Tape(tape);
  const canary = canarySource();
  const registered: ("dealer" | "auditor")[] = [...(options.register ?? [])];
  if (options.randomRegistration === true) {
    for (const role of ["dealer", "auditor"] as const) {
      if (!registered.includes(role) && t.chance(50)) registered.push(role);
    }
  }
  const def = buildVisibilityDefinition(t, canary, { register: registered });
  const start = propertyStart(def);
  const rewrite = makeRewrite(canary, options.grants ?? true);
  const steps: CaseStep[] = [];
  const states: Snapshot<SessionState>[] = [start];
  let state = start;
  const batches = options.batches ?? 6;
  for (let i = 0; i < batches; i++) {
    const generated = generateBatch(def, state, t, {
      illegalPercent: 8,
      rewrite,
    });
    const result = apply(def, state, generated.batch, generated.opts);
    // A failed or empty batch commits nothing: no transaction, no delta (PFR-027).
    if (!result.ok || result.value.committed.length === 0) continue;
    const post = result.value.state;
    const tx: Transaction = {
      seq: post.seq,
      eventId: canary("e"),
      principal: canary("p"),
      actions: result.value.committed,
    };
    steps.push({ pre: state, post, batch: sealBatch(tx), tx });
    states.push(post);
    state = post;
  }
  return { def, start, steps, states };
}

/** The case options of a role class (a privileged class registers its role). */
export function caseOptions(cls: RoleClass, grants = true): CaseOptions {
  const register: ("dealer" | "auditor")[] =
    cls === "dealer" ? ["dealer"] : cls === "auditor" ? ["auditor"] : [];
  return {
    grants,
    register,
    randomRegistration: cls !== "dealer" && cls !== "auditor",
  };
}

/**
 * The viewers of a role class for `state`: every seat for a `subject: required` role, with and
 * without a subject for optional roles, bare for forbidden ones. Privileged classes are only
 * valid when the case registered the role (the class arbitrary guarantees it).
 */
export function viewersOf(
  cls: RoleClass,
  state: Snapshot<SessionState>,
): ViewerIdentity[] {
  const seats = Object.keys(state.roster.seats).map((s) => mustId(seatId(s)));
  const withSeats = (role: string): ViewerIdentity[] =>
    seats.map((subject) => ({ role, subject }));
  switch (cls) {
    case "player":
      return withSeats("player");
    case "render":
      return [{ role: "render" }, ...withSeats("render")];
    case "dealer":
      return [{ role: "dealer" }];
    case "auditor":
      return [{ role: "auditor" }];
    default:
      return [
        { role: "spectator" },
        { role: "coach" },
        ...withSeats("coach").slice(0, 1),
        ...withSeats("captain"),
      ];
  }
}
