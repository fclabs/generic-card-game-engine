import { describe, expect, expectTypeOf, it } from "vitest";
import * as root from "../index.js";
import * as visibilityIndex from "./index.js";
import { batchSeq, openBatch } from "./open-batch.js";
import { sealBatch } from "./privileged-batch.js";
import type { PrivilegedBatch } from "./privileged-batch.js";
import type { Delta, View } from "./types.js";
import type { Transaction } from "../ports/types.js";
import type { SessionState } from "../session/state.js";
import type { Snapshot } from "../session/snapshot.js";

const tx = {
  seq: 5,
  eventId: "ev-secret",
  principal: "principal-secret",
  actions: [{ kind: "x" }],
} as unknown as Transaction;

describe("VC-335 PrivilegedBatch opaque runtime shape", () => {
  const batch = sealBatch(tx);

  it("exposes no key, symbol or JSON payload", () => {
    expect(Object.keys(batch)).toEqual([]);
    expect(Object.getOwnPropertyNames(batch)).toEqual([]);
    expect(Object.getOwnPropertySymbols(batch)).toEqual([]);
    expect(JSON.stringify(batch)).toBe("{}");
    expect(Object.isFrozen(batch)).toBe(true);
  });

  it("structuredClone and spread carry no payload", () => {
    const cloned = structuredClone(batch);
    expect(Object.keys(cloned)).toEqual([]);
    expect(JSON.stringify({ ...batch })).toBe("{}");
    expect(() => openBatch(cloned)).toThrow(TypeError);
    expect(() => openBatch({ ...batch })).toThrow(TypeError);
  });

  it("openBatch returns the sealed transaction and batchSeq its seq", () => {
    expect(openBatch(batch)).toBe(tx);
    expect(batchSeq(batch)).toBe(5);
    expect(batchSeq(sealBatch({ ...tx, seq: null }))).toBeNull();
  });

  it("two seals of one transaction are distinct handles", () => {
    expect(sealBatch(tx)).not.toBe(batch);
  });

  it("openBatch is not exported from the package root or visibility/index", () => {
    expect("openBatch" in root).toBe(false);
    expect("openBatch" in visibilityIndex).toBe(false);
    expect("batchSeq" in root).toBe(false);
    expect("readSealedBatch" in root).toBe(false);
    expect(typeof root.sealBatch).toBe("function");
  });
});

describe("VC-336 type-level checks", () => {
  it("View and Delta are branded; PrivilegedBatch is opaque", () => {
    const snapshot = {} as Snapshot<SessionState>;
    const view = {} as View;
    const delta = {} as Delta;
    const batch = sealBatch(tx);

    // @ts-expect-error a Snapshot is not a View
    const v: View = snapshot;
    // @ts-expect-error a View is not a Snapshot
    const s: Snapshot<SessionState> = view;
    // @ts-expect-error a hand-written literal is not a View
    const lit: View = { seq: 1, lifecycle: "setup" };
    // @ts-expect-error a hand-written literal is not a Delta
    const d: Delta = { seq: 1, entries: [], zoneCounts: {}, counters: {} };
    // @ts-expect-error a View is not a Delta
    const vd: Delta = view;
    // @ts-expect-error a Delta is not a View
    const dv: View = delta;
    // @ts-expect-error the batch payload is not readable
    void batch.actions;
    // @ts-expect-error the batch payload is not readable
    void batch.seq;
    // @ts-expect-error a Transaction is not a PrivilegedBatch
    const pb: PrivilegedBatch = tx;
    // @ts-expect-error openBatch is not exported from the package root
    void root.openBatch;
    // @ts-expect-error openBatch is not exported from visibility/index
    void visibilityIndex.openBatch;

    void [v, s, lit, d, vd, dv, pb];
    expectTypeOf(batch).toEqualTypeOf<PrivilegedBatch>();
    expectTypeOf<View>().not.toMatchTypeOf<Snapshot<SessionState>>();
    expectTypeOf<Snapshot<SessionState>>().not.toMatchTypeOf<View>();
    expectTypeOf(openBatch).returns.toEqualTypeOf<Transaction>();
  });
});
