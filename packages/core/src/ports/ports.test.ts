import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync } from "node:fs";
import type {
  AuthorizationPort,
  HookRunner,
  OutboxRow,
  Receipt,
  SessionStore,
  Transaction,
} from "./index.js";
import type { AbortSignalLike, ValidationHook } from "../spi/index.js";
import type { DefinitionId, SessionId, Seq } from "../session/index.js";
import { startState } from "../session/apply/apply.testing.js";
import * as ports from "./index.js";
import {
  allowAllAuthorization,
  inMemoryLedger,
  inMemoryStore,
  passThroughHookRunner,
  recordingPublisher,
  recordingTimer,
  singleNodeLease,
} from "./ports.testing.js";

const sid = "session/1" as SessionId;
const n = (v: number): Seq => v as Seq;
const receipt: Receipt = {
  fingerprint: "f",
  result: null,
  errorCode: null,
  seq: null,
  detail: null,
  privileged: false,
};
const emptyTx: Transaction = {
  seq: null,
  eventId: "e1",
  principal: "p1",
  actions: [],
};

function freshStore() {
  return inMemoryStore({
    sessionId: sid,
    definitionId: "def/1" as DefinitionId,
    definitionHash: "h",
    schemaVersion: 1,
    initial: startState(),
    seq: n(0),
    log: [],
  });
}

describe("VC-085 in-memory implementations of every port", () => {
  it("store, ledger, authorization, lease, runner, publisher, timer work", async () => {
    const store = freshStore();
    const row: OutboxRow = {
      id: "o1",
      sessionId: sid,
      seq: null,
      kind: "commit",
      payload: null,
    };
    expect(await store.commit(sid, n(0), 0, emptyTx, receipt, [row])).toEqual({
      ok: true,
      value: { seq: null },
    });
    const tx1: Transaction = { ...emptyTx, seq: n(1), eventId: "e2" };
    expect((await store.commit(sid, n(0), 0, tx1, receipt, [])).ok).toBe(true);
    const stale = await store.commit(sid, n(0), 0, tx1, receipt, []);
    expect(stale.ok === false && stale.error.code).toBe("STALE_WRITER");
    expect((await store.load(sid))?.seq).toBe(1);
    expect(await store.list()).toHaveLength(1);

    const ledger = inMemoryLedger();
    expect(await ledger.lookup(sid, "p1", "e1")).toBeNull();
    await ledger.record(sid, "p1", "e1", receipt);
    expect(await ledger.lookup(sid, "p1", "e1")).toEqual(receipt);

    const target = { sessionId: sid };
    expect(
      await allowAllAuthorization.authorize("p1", "export", target),
    ).toEqual({ allowed: true });
    const lease = await singleNodeLease.acquire(sid);
    expect(await singleNodeLease.renew(lease)).toEqual({
      sessionId: sid,
      epoch: 0,
    });
    await singleNodeLease.release(lease);

    const hook: ValidationHook<"play"> = () =>
      Promise.resolve({ accepted: true });
    const ran = await passThroughHookRunner.run(
      (c: number) => Promise.resolve(c + 1),
      1,
      new AbortController().signal,
    );
    expect(ran).toEqual({ ok: true, value: 2 });
    expect(hook).toBeTypeOf("function");

    const pub = recordingPublisher();
    await pub.publish({ sessionId: sid, transaction: tx1 });
    expect(pub.published).toHaveLength(1);
    const timer = recordingTimer();
    await timer.consume(row);
    expect(timer.consumed).toEqual([row]);
  });

  it("exports no runtime value", () => {
    expect(Object.keys(ports)).toEqual([]);
  });
});

describe("VC-086 SessionStore contract", () => {
  it("commit accepts seq null and OutboxRow kind is the two-member union", () => {
    expectTypeOf<Transaction["seq"]>().toEqualTypeOf<Seq | null>();
    expectTypeOf<
      Parameters<SessionStore["commit"]>[3]
    >().toEqualTypeOf<Transaction>();
    expectTypeOf<OutboxRow["kind"]>().toEqualTypeOf<
      "commit" | "timer_request"
    >();
    const tx: Transaction = { ...emptyTx, seq: null };
    expect(tx.seq).toBeNull();
  });

  it("commit TSDoc states STALE_WRITER, atomicity and seq = null", () => {
    const src = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*commit\(/.exec(src);
    expect(doc).not.toBeNull();
    expect(doc?.[1]).toContain("STALE_WRITER");
    expect(doc?.[1]).toMatch(/[Aa]tomic/);
    expect(doc?.[1]).toContain("seq = null");
  });
});

describe("VC-087 AuthorizationPort op union", () => {
  it("accepts the KFR-112 ops and rejects others at compile time", () => {
    const port: AuthorizationPort = allowAllAuthorization;
    const target = { sessionId: sid };
    const ok1 = [
      "propose:draw",
      "query:player",
      "subscribe:spectator",
      "export",
      "direct_apply",
      "fork",
    ] as const;
    expect(ok1).toHaveLength(6);
    void port.authorize("p", "propose:draw", target);
    void port.authorize("p", "fork", target);
    // @ts-expect-error not in the union
    void port.authorize("p", "delete", target);
    // @ts-expect-error missing role suffix is still a different literal
    void port.authorize("p", "queryplayer", target);
    expectTypeOf<Parameters<AuthorizationPort["authorize"]>[1]>().toEqualTypeOf<
      | `propose:${string}`
      | `query:${string}`
      | `subscribe:${string}`
      | "export"
      | "direct_apply"
      | "fork"
    >();
  });

  it("HookRunner takes an AbortSignalLike", () => {
    expectTypeOf<
      Parameters<HookRunner["run"]>[2]
    >().toEqualTypeOf<AbortSignalLike>();
  });
});
