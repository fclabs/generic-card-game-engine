import { deepFreeze } from "../snapshot.js";
import type { Snapshot } from "../snapshot.js";
import { getOwn, setOwn } from "../records.js";
import type { Seq } from "../ids.js";
import type { CardState, SessionState, ZoneState } from "../state.js";

/** Keyed records that are patched entry by entry (copy-on-write, structural sharing). */
export type RecordKey =
  "cards" | "zones" | "counters" | "zoneOrdinals" | "meta" | "grants";
/** Members that are replaced whole. */
export type ReplaceKey =
  "lifecycle" | "outcome" | "control" | "roster" | "gates" | "delegations";

type Entry<K extends RecordKey> =
  SessionState[K] extends Readonly<Record<string, infer V>> ? V : never;

type Draft = { -readonly [K in keyof SessionState]: SessionState[K] };

/**
 * Copy-on-write view over a frozen input state. Reads return the current value;
 * writes build new objects only along the path that changes, so everything untouched
 * keeps its input reference (KFR-013). Anything handed to a write method is deep-frozen
 * immediately; the containers this object owns (top level and copied records) are
 * frozen by `commit`. The input is never touched.
 */
export class WorkingState {
  private readonly draft: Draft;
  private readonly owned = new Set<RecordKey>();
  private written = false;

  /** The record slots of `draft`, typed loosely: a record is replaced by a same-shaped copy. */
  private readonly slots: Record<RecordKey, unknown>;

  constructor(readonly base: Snapshot<SessionState>) {
    this.draft = { ...base };
    this.slots = this.draft;
  }

  /** Current state view (a plain object until `commit` freezes it). */
  get state(): Snapshot<SessionState> {
    return this.draft;
  }

  /** True once any write method was called. */
  get dirty(): boolean {
    return this.written;
  }

  /** Own-property lookup (safe for ids such as `__proto__`). */
  card(id: string): Snapshot<CardState> | undefined {
    return getOwn(this.draft.cards, id);
  }

  zone(id: string): Snapshot<ZoneState> | undefined {
    return getOwn(this.draft.zones, id);
  }

  /** Sets (or, with `undefined`, removes) one entry of a keyed record. */
  patch<K extends RecordKey>(
    key: K,
    id: string,
    value: Entry<K> | undefined,
  ): void {
    this.written = true;
    const record = this.ownedRecord(key);
    if (value === undefined) {
      Reflect.deleteProperty(record, id);
    } else {
      setOwn(record, id, deepFreeze(value));
    }
  }

  putCard(id: string, card: CardState): void {
    this.patch("cards", id, card);
  }

  putZone(id: string, zone: ZoneState): void {
    this.patch("zones", id, zone);
  }

  /** Replaces a whole member (lifecycle, outcome, control, roster, gates, delegations). */
  replace<K extends ReplaceKey>(
    key: K,
    value: Exclude<SessionState[K], undefined>,
  ): void {
    this.written = true;
    this.draft[key] = deepFreeze(value) as Draft[K];
  }

  /** Freezes the owned containers, stamps `seq` and returns the new immutable state. */
  commit(seq: Seq): Snapshot<SessionState> {
    this.draft.seq = seq;
    for (const key of this.owned) Object.freeze(this.draft[key]);
    return Object.freeze(this.draft);
  }

  private ownedRecord(key: RecordKey): Record<string, unknown> {
    if (!this.owned.has(key)) {
      this.owned.add(key);
      // Spread uses CreateDataProperty, so own `__proto__` keys survive the copy.
      this.slots[key] = { ...this.draft[key] };
    }
    return this.slots[key] as Record<string, unknown>;
  }
}
