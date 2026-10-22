import type { CompiledGameDefinition } from "../definition/types.js";
import type { JsonValue, SessionState } from "../session/state.js";
import type { Snapshot } from "../session/snapshot.js";

/**
 * Independent entitlement model for the Phase 3 properties (VC-341).
 *
 * Written from spec §4.1-4.3 (PFR-002..020, PBR-001..003, PBR-011) and the recorded
 * interpretations D-007..D-014 only. It imports no projector module (only types), reads the
 * definition and state as plain data, and predicts the set of visible *facts* of a view:
 *
 *   key                              value (canonical JSON)
 *   seq | lifecycle | outcome        the engine-owned scalars
 *   control | roster/<seat>          engine-owned sections
 *   zone/<z>/head                    {ordered, owner?}   (zone block exists)
 *   zone/<z>/count                   member count
 *   zone/<z>/members                 card ids in exposed order
 *   zone/<z>/orderKnown              boolean
 *   zone/<z>/member/<card>           orientation
 *   zone/<z>/face/<card>             {type?, metadata}
 *   counter/<id>                     decimal string
 *   meta/<schema>/<field>            projected value
 *   gate/open|resolved/<id>          {schemaId, expectedSeats, submitted?}
 *   gate/open|resolved/<id>/submissions
 *   grant/<id>                       {target, keys, grantee, scope}
 */

export interface OracleViewer {
  readonly role: string;
  readonly subject?: string;
}

export type Facts = Map<string, string>;

type State = Snapshot<SessionState>;
type Rules = Readonly<Record<string, string>>;

const BUILT_IN_SUBJECT: Readonly<Record<string, string>> = {
  player: "required",
  dealer: "forbidden",
  auditor: "forbidden",
  render: "optional",
};

/** Canonical JSON: object keys sorted (the fact comparison is order-insensitive). */
export function stable(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => stable(v)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Whether some visibility block of the definition has an entry keyed by `role` (PBR-003). */
export function isRegistered(
  def: CompiledGameDefinition,
  role: "dealer" | "auditor",
): boolean {
  const blocks: Rules[] = [
    ...def.zones.map((z) => z.visibility),
    ...def.zoneTemplates.map((z) => z.visibility),
    ...def.counters.map((c) => c.visibility),
  ];
  return blocks.some((b) => Object.hasOwn(b, role));
}

/** The error code PFR-002..005 prescribes for a viewer, or `null` when it is valid. */
export function expectedViewerError(
  def: CompiledGameDefinition,
  state: State,
  viewer: OracleViewer,
): string | null {
  const rule = Object.hasOwn(BUILT_IN_SUBJECT, viewer.role)
    ? BUILT_IN_SUBJECT[viewer.role]
    : def.roles.find((r) => r.id === viewer.role)?.subject;
  if (rule === undefined) return "UNKNOWN_ROLE";
  if (rule === "forbidden" && viewer.subject !== undefined) {
    return "SUBJECT_NOT_ALLOWED";
  }
  if (rule === "required" && viewer.subject === undefined) {
    return "UNKNOWN_SUBJECT";
  }
  if (
    viewer.subject !== undefined &&
    !Object.hasOwn(state.roster.seats, viewer.subject)
  ) {
    return "UNKNOWN_SUBJECT";
  }
  if (
    (viewer.role === "dealer" || viewer.role === "auditor") &&
    !isRegistered(def, viewer.role)
  ) {
    return "VIEW_DENIED";
  }
  return null;
}

/** PFR-008: the entry keyed by the role, else `default` for non-privileged roles. */
function audienceOf(rules: Rules, role: string): string | undefined {
  if (Object.hasOwn(rules, role)) return rules[role];
  if (role === "dealer" || role === "auditor") return undefined;
  return rules.default;
}

function seatOf(state: State, seat: string) {
  return Object.hasOwn(state.roster.seats, seat)
    ? state.roster.seats[seat as keyof State["roster"]["seats"]]
    : undefined;
}

/** PFR-009 and D-001/D-002. */
function entitledByAudience(
  audience: string | undefined,
  owner: string | undefined,
  state: State,
  viewer: OracleViewer,
): boolean {
  if (audience === "public") return true;
  if (audience !== "owner" && audience !== "team") return false;
  if (viewer.subject === undefined || owner === undefined) return false;
  const mine = seatOf(state, viewer.subject);
  if (mine === undefined) return false;
  if (audience === "owner") {
    return (
      owner === viewer.subject || owner === mine.team || owner === mine.player
    );
  }
  const team = mine.team;
  if (team === undefined) return false;
  if (owner === team) return true;
  return Object.entries(state.roster.seats).some(
    ([id, seat]) =>
      (id === owner || seat.player === owner) && seat.team === team,
  );
}

interface Grant {
  readonly target: { kind?: string; card_id?: string; zone_id?: string };
  readonly keys: readonly string[];
  readonly grantee: string;
  readonly scope: { kind?: string; n?: number };
}

function granteeSeats(state: State, grantee: string): string[] {
  if (grantee === "all_seated") {
    return Object.entries(state.roster.seats)
      .filter(([, seat]) => seat.status === "seated")
      .map(([id]) => id);
  }
  if (grantee.startsWith("team:")) {
    const team = grantee.slice("team:".length);
    return Object.entries(state.roster.seats)
      .filter(([, seat]) => seat.team === team)
      .map(([id]) => id);
  }
  return Object.hasOwn(state.roster.seats, grantee) ? [grantee] : [];
}

function isGranteeOf(
  state: State,
  grant: Grant,
  viewer: OracleViewer,
): boolean {
  if (viewer.role === "dealer" || viewer.role === "auditor") return false;
  if (viewer.subject === undefined) return false;
  return granteeSeats(state, grant.grantee).includes(viewer.subject);
}

function zoneIsKnown(state: State, zone: string): boolean {
  return Object.hasOwn(state.zones, zone);
}

function zoneState(state: State, zone: string) {
  const z = (
    state.zones as Readonly<
      Record<string, State["zones"][keyof State["zones"]] | undefined>
    >
  )[zone];
  if (z === undefined) throw new Error(`no zone ${zone}`);
  return z;
}

function membersOf(state: State, zone: string): readonly string[] {
  return zoneIsKnown(state, zone) ? zoneState(state, zone).members : [];
}

function cardOf(state: State, card: string) {
  return Object.hasOwn(state.cards, card)
    ? state.cards[card as keyof State["cards"]]
    : undefined;
}

/** The card a card-level (card or top) target resolves to. */
function targetCard(state: State, grant: Grant): string | undefined {
  const t = grant.target;
  if (t.kind === "card" && t.card_id !== undefined) {
    return cardOf(state, t.card_id) === undefined ? undefined : t.card_id;
  }
  if (t.kind === "top" && t.zone_id !== undefined) {
    return membersOf(state, t.zone_id)[0];
  }
  return undefined;
}

const CARD_KEYS = new Set(["card_face", "zone_membership"]);
const ZONE_KEYS = new Set([
  "zone_count",
  "zone_membership",
  "zone_order",
  "card_face",
]);

export interface OracleOptions {
  /** Grants to apply for entitlement (default: `state.grants`). */
  readonly grants?: Readonly<Record<string, unknown>>;
  /** Ignore every grant: the static facts (also drops the `grant/*` facts). */
  readonly ignoreGrants?: boolean;
}

class Model {
  readonly zoneKeys = new Map<string, Set<string>>();
  readonly cardKeys = new Map<string, Set<string>>();
  readonly listing: Grant[] = [];

  constructor(
    readonly def: CompiledGameDefinition,
    readonly state: State,
    readonly viewer: OracleViewer,
    readonly all: Readonly<Record<string, Grant>>,
    ignore: boolean,
  ) {
    if (ignore) return;
    for (const grant of Object.values(all)) {
      if (!isGranteeOf(state, grant, viewer)) continue;
      if (grant.scope.kind === "until_seq") {
        if (!(typeof grant.scope.n === "number" && state.seq < grant.scope.n)) {
          continue;
        }
      }
      const t = grant.target;
      if (t.kind === "zone" && t.zone_id !== undefined) {
        if (!zoneIsKnown(state, t.zone_id)) continue;
        const set = this.zoneKeys.get(t.zone_id) ?? new Set<string>();
        for (const key of grant.keys) if (ZONE_KEYS.has(key)) set.add(key);
        this.zoneKeys.set(t.zone_id, set);
      } else {
        const card = targetCard(state, grant);
        if (card === undefined) continue;
        const set = this.cardKeys.get(card) ?? new Set<string>();
        for (const key of grant.keys) if (CARD_KEYS.has(key)) set.add(key);
        this.cardKeys.set(card, set);
      }
    }
  }

  rulesOfZone(zone: string): Rules {
    const z = zoneState(this.state, zone);
    const configured = this.def.zones.find((d) => d.id === zone);
    if (configured !== undefined) return configured.visibility;
    return (
      this.def.zoneTemplates.find((t) => t.name === z.template)?.visibility ??
      {}
    );
  }

  orderedZone(zone: string): boolean {
    const z = zoneState(this.state, zone);
    const configured = this.def.zones.find((d) => d.id === zone);
    if (configured !== undefined) return configured.ordered;
    return (
      this.def.zoneTemplates.find((t) => t.name === z.template)?.ordered ??
      false
    );
  }

  audience(zone: string): string | undefined {
    return audienceOf(this.rulesOfZone(zone), this.viewer.role);
  }

  /** Static (declared) entitlement to the zone: count, membership and order together. */
  staticZone(zone: string): boolean {
    const z = zoneState(this.state, zone);
    return entitledByAudience(
      this.audience(zone),
      z.owner,
      this.state,
      this.viewer,
    );
  }

  /** Static `card_face` entitlement of a card with `orientation` in `zone` (PFR-013 a, b). */
  staticFace(zone: string, orientation: string): boolean {
    if (!this.staticZone(zone)) return false;
    const audience = this.audience(zone);
    return (
      audience === "owner" ||
      audience === "team" ||
      (audience === "public" && orientation === "face_up")
    );
  }

  zoneHas(zone: string, key: string): boolean {
    return this.zoneKeys.get(zone)?.has(key) ?? false;
  }

  cardHas(card: string, key: string): boolean {
    return this.cardKeys.get(card)?.has(key) ?? false;
  }

  count(zone: string): boolean {
    return this.staticZone(zone) || this.zoneHas(zone, "zone_count");
  }

  whole(zone: string): boolean {
    return this.staticZone(zone) || this.zoneHas(zone, "zone_membership");
  }

  orderKnown(zone: string): boolean {
    return (
      this.staticZone(zone) ||
      (this.whole(zone) && this.zoneHas(zone, "zone_order"))
    );
  }

  cardListed(zone: string, card: string): boolean {
    return (
      this.whole(zone) ||
      this.cardHas(card, "zone_membership") ||
      this.cardHas(card, "card_face")
    );
  }

  faceVisible(zone: string, card: string, orientation: string): boolean {
    return (
      this.staticFace(zone, orientation) ||
      this.zoneHas(zone, "card_face") ||
      this.cardHas(card, "card_face")
    );
  }

  /** PFR-014 on the metadata of a card. */
  face(card: string): { type?: string; metadata: Record<string, JsonValue> } {
    const decl = this.def.cards.find((c) => c.id === card);
    const state = cardOf(this.state, card);
    const metadata: Record<string, JsonValue> = {};
    for (const [field, value] of Object.entries(state?.metadata ?? {})) {
      const visibility = decl?.metadataVisibility[field];
      const shown =
        visibility === "public" ||
        (visibility === "subject" && this.viewer.subject !== undefined) ||
        (visibility === "secret" &&
          (this.viewer.role === "dealer" || this.viewer.role === "auditor"));
      if (shown) metadata[field] = value;
    }
    return decl?.type === undefined
      ? { metadata }
      : { type: decl.type, metadata };
  }

  /** Static entitlement (no grants) to `key` on the target of `grant` (D-013, fail closed). */
  staticKey(grant: Grant, key: string): boolean {
    const t = grant.target;
    if (t.kind === "zone" && t.zone_id !== undefined) {
      if (!zoneIsKnown(this.state, t.zone_id)) return false;
      if (key === "card_face") {
        return membersOf(this.state, t.zone_id).every((c) => {
          const card = cardOf(this.state, c);
          return (
            card !== undefined &&
            this.staticFace(t.zone_id as string, card.orientation)
          );
        });
      }
      return ZONE_KEYS.has(key) && this.staticZone(t.zone_id);
    }
    const card = targetCard(this.state, grant);
    if (card === undefined || !CARD_KEYS.has(key)) return false;
    const data = cardOf(this.state, card);
    if (data === undefined) return false;
    return key === "card_face"
      ? this.staticFace(data.zone, data.orientation)
      : this.staticZone(data.zone);
  }

  grantListed(grant: Grant): boolean {
    return (
      isGranteeOf(this.state, grant, this.viewer) ||
      grant.keys.every((key) => this.staticKey(grant, key))
    );
  }
}

function put(facts: Facts, key: string, value: unknown): void {
  facts.set(key, stable(value));
}

function zoneFacts(m: Model, facts: Facts): void {
  for (const zone of Object.keys(m.state.zones)) {
    const z = zoneState(m.state, zone);
    const whole = m.whole(zone);
    const listed = z.members.filter((c) => m.cardListed(zone, c));
    const count = m.count(zone);
    if (!count && listed.length === 0) continue;
    put(facts, `zone/${zone}/head`, {
      ordered: m.orderedZone(zone),
      owner: z.owner,
    });
    if (count) put(facts, `zone/${zone}/count`, z.members.length);
    if (listed.length === 0 && !whole) continue;
    const orderKnown = m.orderKnown(zone);
    const exposed =
      m.orderedZone(zone) && orderKnown ? listed : [...listed].sort();
    put(facts, `zone/${zone}/members`, exposed);
    put(facts, `zone/${zone}/orderKnown`, orderKnown);
    for (const card of listed) {
      const data = cardOf(m.state, card);
      if (data === undefined) continue;
      put(facts, `zone/${zone}/member/${card}`, data.orientation);
      if (m.faceVisible(zone, card, data.orientation)) {
        put(facts, `zone/${zone}/face/${card}`, m.face(card));
      }
    }
  }
}

function counterFacts(m: Model, facts: Facts): void {
  for (const counter of m.def.counters) {
    const declared = Object.keys(counter.visibility).length > 0;
    const derived = counter.derived !== undefined;
    const own = (): boolean =>
      entitledByAudience(
        audienceOf(counter.visibility, m.viewer.role),
        counter.ownerId,
        m.state,
        m.viewer,
      );
    let visible: boolean;
    if (!derived || declared) {
      // Stored counters, and derived ones with their own declaration (PBR-011).
      visible = own();
    } else if (counter.derivedSpec !== undefined) {
      // Undeclared derived counter: inherits zone_count of its input zone.
      const zone = counter.derivedSpec.zone as string;
      visible = zoneIsKnown(m.state, zone) && m.count(zone);
    } else {
      visible = false;
    }
    if (!visible) continue;
    if (derived) {
      if (counter.derivedSpec === undefined) continue;
      put(
        facts,
        `counter/${counter.id}`,
        BigInt(membersOf(m.state, counter.derivedSpec.zone).length),
      );
    } else {
      const value = m.state.counters[counter.id];
      if (value !== undefined) put(facts, `counter/${counter.id}`, value);
    }
  }
}

function metaFacts(m: Model, facts: Facts): void {
  for (const schema of m.def.metaSchemas) {
    const partition = Object.hasOwn(m.state.meta, schema.id)
      ? (m.state.meta[schema.id] as JsonValue)
      : undefined;
    if (
      typeof partition !== "object" ||
      partition === null ||
      Array.isArray(partition)
    ) {
      continue;
    }
    for (const [field, value] of Object.entries(partition)) {
      const visibility = schema.fieldVisibility[field];
      if (visibility === "public") {
        put(facts, `meta/${schema.id}/${field}`, value);
      } else if (visibility === "secret") {
        if (m.viewer.role === "dealer" || m.viewer.role === "auditor") {
          put(facts, `meta/${schema.id}/${field}`, value);
        }
      } else if (visibility === "subject") {
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          continue;
        }
        const entries = Object.entries(value as Record<string, JsonValue>);
        if (!entries.every(([seat]) => seatOf(m.state, seat) !== undefined)) {
          continue;
        }
        const shown = entries.filter(
          ([seat]) => m.viewer.role === "auditor" || seat === m.viewer.subject,
        );
        if (shown.length > 0) {
          put(facts, `meta/${schema.id}/${field}`, Object.fromEntries(shown));
        }
      }
    }
  }
}

function gateFacts(m: Model, facts: Facts): void {
  const visible = (
    submissions: Readonly<Record<string, JsonValue>>,
  ): Record<string, JsonValue> =>
    Object.fromEntries(
      Object.entries(submissions).filter(
        ([seat]) => m.viewer.role === "auditor" || seat === m.viewer.subject,
      ),
    );
  for (const [id, gate] of Object.entries(m.state.gates.open)) {
    put(facts, `gate/open/${id}`, {
      schemaId: gate.schemaId,
      expectedSeats: gate.expectedSeats,
      submitted: gate.expectedSeats.filter((s) =>
        Object.hasOwn(gate.submissions, s),
      ),
    });
    const own = visible(gate.submissions);
    if (Object.keys(own).length > 0) {
      put(facts, `gate/open/${id}/submissions`, own);
    }
  }
  for (const [id, gate] of Object.entries(m.state.gates.resolved)) {
    put(facts, `gate/resolved/${id}`, {
      schemaId: gate.schemaId,
      expectedSeats: gate.expectedSeats,
    });
    const own = visible(gate.submissions);
    if (Object.keys(own).length > 0) {
      put(facts, `gate/resolved/${id}/submissions`, own);
    }
  }
}

/**
 * The facts a valid `viewer` is entitled to in `state`. Callers validate the viewer first
 * (`expectedViewerError`); this function assumes it is valid.
 */
export function oracleFacts(
  def: CompiledGameDefinition,
  state: State,
  viewer: OracleViewer,
  options: OracleOptions = {},
): Facts {
  const grants = (options.grants ?? state.grants) as Readonly<
    Record<string, Grant>
  >;
  const m = new Model(
    def,
    state,
    viewer,
    grants,
    options.ignoreGrants === true,
  );
  const facts: Facts = new Map();
  put(facts, "seq", state.seq);
  put(facts, "lifecycle", state.lifecycle);
  if (state.outcome !== undefined) put(facts, "outcome", state.outcome);
  put(facts, "control", state.control);
  for (const [seat, entry] of Object.entries(state.roster.seats)) {
    put(facts, `roster/${seat}`, {
      status: entry.status,
      team: entry.team,
      player: entry.player,
    });
  }
  zoneFacts(m, facts);
  counterFacts(m, facts);
  metaFacts(m, facts);
  gateFacts(m, facts);
  if (options.ignoreGrants !== true) {
    for (const [id, grant] of Object.entries(
      state.grants as Readonly<Record<string, Grant>>,
    )) {
      if (m.grantListed(grant)) {
        put(facts, `grant/${id}`, {
          target: grant.target,
          keys: grant.keys,
          grantee: grant.grantee,
          scope: grant.scope,
        });
      }
    }
  }
  return facts;
}

/**
 * Faces the viewer is `card_face`-entitled to (PFR-013), listed or not: a delta may carry the
 * face of a card the viewer holds a zone-level `card_face` grant for even though the zone's
 * membership is not listed (PFR-024: "`face` iff entitled to `card_face` for the card in
 * `post`"). Key `card/<id>/face`.
 */
export function oracleCardFaces(
  def: CompiledGameDefinition,
  state: State,
  viewer: OracleViewer,
  options: OracleOptions = {},
): Facts {
  const grants = (options.grants ?? state.grants) as Readonly<
    Record<string, Grant>
  >;
  const m = new Model(
    def,
    state,
    viewer,
    grants,
    options.ignoreGrants === true,
  );
  const facts: Facts = new Map();
  for (const [card, data] of Object.entries(state.cards)) {
    if (m.faceVisible(data.zone, card, data.orientation)) {
      put(facts, `card/${card}/face`, m.face(card));
    }
  }
  return facts;
}

/** The loosely typed shape `viewFacts` reads (a `View` or a folded view). */
export interface ViewLike {
  readonly seq: number;
  readonly lifecycle: string;
  readonly zones: Readonly<Record<string, ZoneLike>>;
  readonly counters: Readonly<Record<string, string>>;
  readonly control: unknown;
  readonly roster: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly gates: {
    readonly open: Readonly<Record<string, GateLike>>;
    readonly resolved: Readonly<Record<string, GateLike>>;
  };
  readonly grants: Readonly<Record<string, unknown>>;
  readonly outcome?: unknown;
}
export interface ZoneLike {
  readonly ordered: boolean;
  readonly owner?: string;
  readonly count?: number;
  readonly members?: readonly {
    readonly id: string;
    readonly orientation: string;
    readonly face?: unknown;
  }[];
  readonly orderKnown?: boolean;
}
export interface GateLike {
  readonly schemaId: string;
  readonly expectedSeats: readonly string[];
  readonly submitted?: readonly string[];
  readonly submissions?: Readonly<Record<string, unknown>>;
}

/** Flattens a view into the oracle's fact space (reads the `View` only). */
export function viewFacts(view: ViewLike): Facts {
  const facts: Facts = new Map();
  put(facts, "seq", view.seq);
  put(facts, "lifecycle", view.lifecycle);
  if (view.outcome !== undefined) put(facts, "outcome", view.outcome);
  put(facts, "control", view.control);
  for (const [seat, entry] of Object.entries(view.roster)) {
    put(facts, `roster/${seat}`, entry);
  }
  for (const [zone, block] of Object.entries(view.zones)) {
    put(facts, `zone/${zone}/head`, {
      ordered: block.ordered,
      owner: block.owner,
    });
    if (block.count !== undefined)
      put(facts, `zone/${zone}/count`, block.count);
    if (block.members !== undefined) {
      put(
        facts,
        `zone/${zone}/members`,
        block.members.map((m) => m.id),
      );
      put(facts, `zone/${zone}/orderKnown`, block.orderKnown);
      for (const member of block.members) {
        put(facts, `zone/${zone}/member/${member.id}`, member.orientation);
        if (member.face !== undefined) {
          put(facts, `zone/${zone}/face/${member.id}`, member.face);
        }
      }
    }
  }
  for (const [id, value] of Object.entries(view.counters)) {
    put(facts, `counter/${id}`, BigInt(value));
  }
  for (const [schema, fields] of Object.entries(view.meta)) {
    for (const [field, value] of Object.entries(
      fields as Record<string, unknown>,
    )) {
      put(facts, `meta/${schema}/${field}`, value);
    }
  }
  for (const kind of ["open", "resolved"] as const) {
    for (const [id, gate] of Object.entries(view.gates[kind])) {
      put(facts, `gate/${kind}/${id}`, {
        schemaId: gate.schemaId,
        expectedSeats: gate.expectedSeats,
        submitted: gate.submitted,
      });
      if (gate.submissions !== undefined) {
        put(facts, `gate/${kind}/${id}/submissions`, gate.submissions);
      }
    }
  }
  for (const [id, grant] of Object.entries(view.grants)) {
    put(facts, `grant/${id}`, grant);
  }
  return facts;
}

/** Human-readable differences between two fact sets (empty when equal). */
export function diffFacts(
  expected: Facts,
  actual: Facts,
  limit = 12,
): string[] {
  const out: string[] = [];
  for (const [key, value] of expected) {
    const got = actual.get(key);
    if (got === undefined) out.push(`missing ${key} = ${value}`);
    else if (got !== value)
      out.push(`differs ${key}: want ${value}, got ${got}`);
  }
  for (const [key, value] of actual) {
    if (!expected.has(key)) out.push(`extra ${key} = ${value}`);
  }
  return out.slice(0, limit);
}
