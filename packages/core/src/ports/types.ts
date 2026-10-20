import type { ErrorCode } from "../errors/codes.js";
import type { EngineError, Result } from "../errors/result.js";
import type {
  AbortSignalLike,
  Allow,
  AuthOp,
  AuthTarget,
  Deny,
  Principal,
} from "../spi/index.js";
import type {
  Action,
  DefinitionId,
  JsonValue,
  Lifecycle,
  SessionId,
  SessionState,
  Seq,
  Snapshot,
} from "../session/index.js";

/**
 * Port interfaces (spec KFR-110..112, architecture A6). Interface and type declarations
 * only: no classes, no implementation, no runtime values. Adapters live outside core.
 */

/** Caller-chosen idempotency key of one inbound event. */
export type EventId = string;

/** Lease generation; a single-node adapter always uses `0`. */
export type Epoch = number;

/** The actions one batch committed, with the identity of the event that produced it. */
export interface Transaction {
  /** The `seq` this transaction commits at, or `null` for an empty accepted batch. */
  readonly seq: Seq | null;
  readonly eventId: EventId;
  readonly principal: Principal;
  /** Post-expansion primitives in order; never macros. Empty when `seq` is `null`. */
  readonly actions: readonly Action[];
}

/**
 * The idempotency record of one event (the `receipts` row of A6, minus the key
 * `(sessionId, principal, eventId)`, which is passed alongside).
 */
export interface Receipt {
  readonly fingerprint: string;
  readonly result: JsonValue | null;
  readonly errorCode: ErrorCode | null;
  readonly seq: Seq | null;
  readonly detail: JsonValue | null;
  readonly privileged: boolean;
}

/** A row written to the outbox in the commit transaction. */
export interface OutboxRow {
  /** Unique within the store, chosen by the caller (the domain never generates ids). */
  readonly id: string;
  readonly sessionId: SessionId;
  readonly seq: Seq | null;
  readonly kind: "commit" | "timer_request";
  readonly payload: JsonValue;
}

/** Fencing token returned by `LeasePort.acquire`. */
export interface Lease {
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
}

/** Outcome of `SessionStore.commit`: the new `seq`, or `STALE_WRITER`. */
export type CommitResult = Result<
  { readonly seq: Seq | null },
  StaleWriterError
>;

/** The only failure `commit` reports as a value; other failures reject the promise. */
export type StaleWriterError = EngineError & { code: "STALE_WRITER" };

/** One session as persisted: its starting state and the committed log up to `seq`. */
export interface StoredSession {
  readonly sessionId: SessionId;
  readonly definitionId: DefinitionId;
  readonly definitionHash: string;
  readonly schemaVersion: number;
  /** The state at `seq` 0, as built by `createSession`. */
  readonly initial: Snapshot<SessionState>;
  readonly seq: Seq;
  readonly log: readonly Transaction[];
}

export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly definitionId: DefinitionId;
  readonly lifecycle: Lifecycle;
  readonly seq: Seq;
}

/** A committed transaction handed to `Publisher`, in `seq` order per session. */
export interface CommittedTransaction {
  readonly sessionId: SessionId;
  readonly transaction: Transaction;
}

export interface SessionStore {
  /**
   * Persist one batch. Atomic over the transaction's actions, the receipt and every outbox
   * row: either all are stored or none. Fails with `STALE_WRITER` (transient) when
   * `expectedSeq` or `epoch` does not match the stored session. An accepted batch that
   * produced no actions is committed with `tx.seq = null`: only the receipt and the outbox
   * rows are stored and the session `seq` does not advance.
   */
  commit(
    sessionId: SessionId,
    expectedSeq: Seq,
    epoch: Epoch,
    tx: Transaction,
    receipt: Receipt,
    outbox: readonly OutboxRow[],
  ): Promise<CommitResult>;

  /** Load a session, optionally truncated to the log up to `atSeq`; `null` if unknown. */
  load(sessionId: SessionId, atSeq?: Seq): Promise<StoredSession | null>;

  list(): Promise<readonly SessionSummary[]>;
}

export interface IdempotencyLedger {
  record(
    sessionId: SessionId,
    principal: Principal,
    eventId: EventId,
    entry: Receipt,
  ): Promise<void>;
  lookup(
    sessionId: SessionId,
    principal: Principal,
    eventId: EventId,
  ): Promise<Receipt | null>;
}

export interface AuthorizationPort {
  authorize(
    principal: Principal,
    op: AuthOp,
    target: AuthTarget,
  ): Promise<Allow | Deny>;
}

export interface LeasePort {
  acquire(sessionId: SessionId): Promise<Lease>;
  renew(lease: Lease): Promise<Lease>;
  release(lease: Lease): Promise<void>;
}

export interface HookRunner {
  /**
   * Run a hook under the host's `HOOK_TIMEOUT` policy. Failures are reported as
   * `HOOK_ERROR` or `HOOK_TIMEOUT` errors, never thrown.
   */
  run<C, R>(
    hook: (ctx: C) => Promise<R>,
    ctx: C,
    signal: AbortSignalLike,
  ): Promise<Result<R>>;
}

export interface Publisher {
  publish(committedTx: CommittedTransaction): Promise<void>;
}

export interface TimerPort {
  consume(outboxRow: OutboxRow): Promise<void>;
}
