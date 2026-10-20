import { err, ok } from "../errors/result.js";
import type {
  AuthorizationPort,
  CommitResult,
  CommittedTransaction,
  HookRunner,
  IdempotencyLedger,
  Lease,
  LeasePort,
  OutboxRow,
  Publisher,
  Receipt,
  SessionStore,
  SessionSummary,
  StoredSession,
  TimerPort,
  Transaction,
} from "./index.js";
import type { SessionId, Seq } from "../session/index.js";

/** In-memory objects implementing every port using only the exported types (VC-085). */
export function inMemoryStore(initial: StoredSession): SessionStore & {
  readonly outbox: OutboxRow[];
  readonly receipts: Receipt[];
} {
  let stored = initial;
  const outbox: OutboxRow[] = [];
  const receipts: Receipt[] = [];
  return {
    outbox,
    receipts,
    commit(
      _sessionId: SessionId,
      expectedSeq: Seq,
      epoch: number,
      tx: Transaction,
      receipt: Receipt,
      rows: readonly OutboxRow[],
    ): Promise<CommitResult> {
      if (expectedSeq !== stored.seq || epoch !== 0) {
        return Promise.resolve(
          err({ code: "STALE_WRITER" as const, detail: "stale writer" }),
        );
      }
      if (tx.seq !== null) {
        stored = { ...stored, seq: tx.seq, log: [...stored.log, tx] };
      }
      receipts.push(receipt);
      outbox.push(...rows);
      return Promise.resolve(ok({ seq: tx.seq }));
    },
    load(): Promise<StoredSession | null> {
      return Promise.resolve(stored);
    },
    list(): Promise<readonly SessionSummary[]> {
      return Promise.resolve([
        {
          sessionId: stored.sessionId,
          definitionId: stored.definitionId,
          lifecycle: stored.initial.lifecycle,
          seq: stored.seq,
        },
      ]);
    },
  };
}

export function inMemoryLedger(): IdempotencyLedger {
  const map = new Map<string, Receipt>();
  const key = (s: string, p: string, e: string): string =>
    JSON.stringify([s, p, e]);
  return {
    record(sessionId, principal, eventId, entry) {
      map.set(key(sessionId, principal, eventId), entry);
      return Promise.resolve();
    },
    lookup(sessionId, principal, eventId) {
      return Promise.resolve(
        map.get(key(sessionId, principal, eventId)) ?? null,
      );
    },
  };
}

export const allowAllAuthorization: AuthorizationPort = {
  authorize: () => Promise.resolve({ allowed: true }),
};

export const singleNodeLease: LeasePort = {
  acquire: (sessionId): Promise<Lease> =>
    Promise.resolve({ sessionId, epoch: 0 }),
  renew: (lease) => Promise.resolve(lease),
  release: () => Promise.resolve(),
};

export const passThroughHookRunner: HookRunner = {
  async run(hook, ctx) {
    return ok(await hook(ctx));
  },
};

export function recordingPublisher(): Publisher & {
  readonly published: CommittedTransaction[];
} {
  const published: CommittedTransaction[] = [];
  return {
    published,
    publish(committedTx) {
      published.push(committedTx);
      return Promise.resolve();
    },
  };
}

export function recordingTimer(): TimerPort & {
  readonly consumed: OutboxRow[];
} {
  const consumed: OutboxRow[] = [];
  return {
    consumed,
    consume(row) {
      consumed.push(row);
      return Promise.resolve();
    },
  };
}
