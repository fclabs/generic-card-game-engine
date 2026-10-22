import { describe, expect, it } from "vitest";
import { A } from "../session/actions.testing.js";
import { isDeepFrozen } from "../session/snapshot.testing.js";
import { stateDigest } from "./canonical/state-schema.js";
import { forkFromSeq } from "./forker.js";
import { continueFork } from "./forker.testing.js";
import { buildGoldenPackageSession } from "./generate-golden-package.testing.js";
import { buildLiveSession } from "./live-session.testing.js";
import { decodePackage, encodePackage } from "./package.js";
import type { ReplayPackage } from "./package.js";
import { rebuild } from "./replayer.js";
import type { ReplayError } from "./replay-error.js";
import * as replayApi from "./index.js";
import * as rootApi from "../index.js";

const golden = buildGoldenPackageSession();
const { resolved, definition } = golden;
const pkg = golden.package;
const LAST = pkg.log.length;

function must<T>(
  r: { ok: true; value: T } | { ok: false; error: ReplayError },
): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.detail}`);
  return r.value;
}

function failure<T>(
  r: { ok: true; value: T } | { ok: false; error: ReplayError },
): ReplayError {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

const fork = (n: number, id = "fork-1") =>
  forkFromSeq(resolved, pkg, n, { sessionId: id });

/** Deep structural snapshot (bigint-safe) to compare before and after. */
function json(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? `${v.toString()}n` : v,
  );
}

describe("VC-365 fork at n", () => {
  it("truncates the log and digests, drops receipts, records forkedFrom", () => {
    const n = 7;
    const f = must(fork(n));
    expect(f.package.sessionId).toBe("fork-1");
    expect(f.package.log).toEqual(pkg.log.slice(0, n));
    expect(f.package.log).toHaveLength(n);
    expect(f.package.receipts).toEqual([]);
    expect(f.package.digests).toEqual(pkg.digests.filter((d) => d.seq <= n));
    expect(f.package.forkedFrom).toEqual({ sessionId: pkg.sessionId, seq: n });
    expect(f.package.definition).toEqual(pkg.definition);
    expect(f.package.params).toEqual(pkg.params);
    expect(f.package.actionSchemaVersion).toBe(pkg.actionSchemaVersion);
    expect(f.package.initial.id).toBe("fork-1");
    expect(f.state.id).toBe("fork-1");
    expect(f.state.seq).toBe(n);
  });

  it("rebuild of the fork reproduces the original digests for seq <= n", () => {
    for (const n of [0, 1, 5, 11, LAST]) {
      const f = must(fork(n));
      const r = must(rebuild(resolved, f.package, { verify: "every" }));
      expect(r.seq).toBe(n);
      const original = golden.states[n];
      if (original === undefined) throw new Error("no state");
      expect(r.digest).toBe(stateDigest(definition, original));
      expect(stateDigest(definition, f.state)).toBe(r.digest);
    }
  });

  it("the state equals the original's at n apart from the session id", () => {
    const n = 6;
    const f = must(fork(n));
    const original = golden.states[n];
    if (original === undefined) throw new Error("no state");
    expect({ ...f.state, id: original.id }).toEqual(original);
  });

  it("the fork's package survives an encode/decode round trip", () => {
    const f = must(fork(4));
    const decoded = decodePackage(encodePackage(f.package));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toEqual(f.package);
  });

  it("holds on a live random session", () => {
    const tape = Array.from({ length: 4000 }, (_v, i) => (i * 37 + 11) % 256);
    const live = buildLiveSession(tape, { transactions: 15 });
    const lastSeq = live.package.log.length;
    expect(lastSeq).toBeGreaterThan(5);
    for (const n of [0, 3, lastSeq]) {
      const f = must(
        forkFromSeq(live.resolved, live.package, n, { sessionId: "live-fork" }),
      );
      const state = live.states[n];
      const digest = live.digests[n];
      if (state === undefined || digest === undefined) throw new Error("gap");
      expect(stateDigest(live.definition, f.state)).toBe(digest);
      expect(f.package.log).toHaveLength(n);
    }
  });

  it("a fork of a fork records the immediate parent", () => {
    const f = must(fork(8, "fork-1"));
    const g = must(
      forkFromSeq(resolved, f.package, 3, { sessionId: "fork-2" }),
    );
    expect(g.package.forkedFrom).toEqual({ sessionId: "fork-1", seq: 3 });
    expect(g.package.log).toEqual(pkg.log.slice(0, 3));
  });

  it("a tampered source digest fails with the replayer's error", () => {
    const bad: ReplayPackage = {
      ...pkg,
      digests: pkg.digests.map((d) =>
        d.seq === 2 ? { ...d, digest: "0".repeat(64) } : d,
      ),
    };
    const e = failure(forkFromSeq(resolved, bad, 5, { sessionId: "x" }));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(2);
    expect(e.detail).toContain("digest mismatch");
    // a fork before the tampered digest does not see it
    expect(forkFromSeq(resolved, bad, 1, { sessionId: "x" }).ok).toBe(true);
  });
});

describe("VC-366 immutability and independence", () => {
  it("never mutates a deep-frozen source", () => {
    const frozen = buildGoldenPackageSession();
    const source = frozen.package;
    const states = frozen.states;
    // deep-freeze through the public path: a fork result is frozen, so freeze the source too
    const freezer = (v: unknown): void => {
      if (typeof v !== "object" || v === null || Object.isFrozen(v)) return;
      Object.freeze(v);
      for (const c of Object.values(v)) freezer(c);
    };
    freezer(source);
    states.forEach(freezer);
    expect(isDeepFrozen(source)).toBe(true);
    const before = json(source);
    const statesBefore = json(states);
    must(forkFromSeq(frozen.resolved, source, 6, { sessionId: "f" }));
    expect(json(source)).toBe(before);
    expect(json(states)).toBe(statesBefore);
  });

  it("never mutates an unfrozen source, and the fork shares nothing with it", () => {
    const fresh = buildGoldenPackageSession().package;
    const before = json(fresh);
    const f = must(forkFromSeq(resolved, fresh, 6, { sessionId: "f" }));
    expect(json(fresh)).toBe(before);
    expect(Object.isFrozen(fresh)).toBe(false);
    expect(Object.isFrozen(fresh.log)).toBe(false);
    expect(isDeepFrozen(f.package)).toBe(true);
    expect(isDeepFrozen(f.state)).toBe(true);
    expect(f.package.log[0]).not.toBe(fresh.log[0]);
    expect(f.package.initial).not.toBe(fresh.initial);
  });

  it("continuing the fork at n + 1 leaves the original untouched and re-exports", () => {
    const n = 5;
    const before = json(pkg);
    const bytesBefore = encodePackage(pkg);
    const f = must(fork(n));
    const next = must(
      continueFork(
        resolved,
        f,
        [A.transfer("bank", "pot", 1n)],
        "evt-new",
        "alice",
      ),
    );
    expect(next.package.log).toHaveLength(n + 1);
    expect(next.package.log[n]?.seq).toBe(n + 1);
    expect(next.package.log[n]?.eventId).toBe("evt-new");
    expect(next.package.forkedFrom).toEqual({
      sessionId: pkg.sessionId,
      seq: n,
    });
    // the original is unchanged, byte for byte
    expect(json(pkg)).toBe(before);
    expect(encodePackage(pkg)).toEqual(bytesBefore);
    expect(pkg.log[n]?.eventId).not.toBe("evt-new");
    const original = golden.states[n + 1];
    if (original === undefined) throw new Error("no state");
    expect(next.state.seq).toBe(n + 1);
    expect(stateDigest(definition, next.state)).not.toBe(
      stateDigest(definition, original),
    );
    // the extended fork replays, also through its exported bytes
    const bytes = encodePackage(next.package);
    const decoded = decodePackage(bytes);
    expect(decoded.ok).toBe(true);
    const r = must(rebuild(resolved, bytes, { verify: "every" }));
    expect(r.seq).toBe(n + 1);
    expect(r.digest).toBe(stateDigest(definition, next.state));
    // and the original still replays to its own digests
    expect(must(rebuild(resolved, pkg, { verify: "every" })).seq).toBe(LAST);
  });
});

describe("VC-367 boundaries and validation", () => {
  it("n = 0 is an empty log at the initial state", () => {
    const f = must(fork(0));
    expect(f.package.log).toEqual([]);
    expect(f.package.digests.every((d) => d.seq === 0)).toBe(true);
    expect(f.state.seq).toBe(0);
    expect(f.state.lifecycle).toBe("active");
    expect(stateDigest(definition, f.state)).toBe(
      stateDigest(definition, { ...pkg.initial, id: f.state.id }),
    );
  });

  it("n = lastSeq is a full copy with the new id", () => {
    const f = must(fork(LAST));
    expect(f.package).toEqual({
      ...pkg,
      sessionId: "fork-1",
      initial: { ...pkg.initial, id: "fork-1" },
      receipts: [],
      forkedFrom: { sessionId: pkg.sessionId, seq: LAST },
    });
  });

  it("rejects n outside 0..lastSeq or not an integer", () => {
    for (const n of [LAST + 1, -1, 1.5, Number.NaN, Infinity]) {
      const e = failure(fork(n));
      expect(e.code, String(n)).toBe("REPLAY_INVALID");
      expect(e.seq).toBe(0);
    }
  });

  it("rejects the source's own session id and invalid ids", () => {
    expect(failure(fork(3, pkg.sessionId))).toMatchObject({
      code: "REPLAY_INVALID",
      detail: "same session id",
    });
    for (const id of ["", "has space", "a#b", "x".repeat(129), "é"]) {
      expect(failure(fork(3, id))).toMatchObject({
        code: "REPLAY_INVALID",
        detail: "invalid session id",
      });
    }
    expect(fork(3, "x".repeat(128)).ok).toBe(true);
    expect(
      failure(
        forkFromSeq(resolved, pkg, 3, { sessionId: 7 as unknown as string }),
      ).detail,
    ).toBe("invalid session id");
  });

  it("a package that does not bind to the definition fails like rebuild", () => {
    const other = { ...pkg, definition: { ...pkg.definition, gameId: "nope" } };
    expect(
      failure(forkFromSeq(resolved, other, 2, { sessionId: "z" })).code,
    ).toBe("REPLAY_MISMATCH");
  });
});

describe("VC-368 lifecycle at the fork point", () => {
  it("is active before the end and completed at the end seq", () => {
    expect(golden.states[LAST]?.lifecycle).toBe("completed");
    expect(must(fork(LAST - 1)).state.lifecycle).toBe("active");
    expect(must(fork(LAST)).state.lifecycle).toBe("completed");
    expect(must(fork(0)).state.lifecycle).toBe("active");
    // an active fork keeps accepting play
    const f = must(fork(LAST - 1));
    expect(continueFork(resolved, f, [A.transfer("bank", "pot", 1n)]).ok).toBe(
      true,
    );
  });
});

describe("exports", () => {
  it("forkFromSeq is exported through replay/ and the root", () => {
    expect(replayApi.forkFromSeq).toBe(forkFromSeq);
    expect(rootApi.forkFromSeq).toBe(forkFromSeq);
    expect("continueFork" in replayApi).toBe(false);
  });
});
