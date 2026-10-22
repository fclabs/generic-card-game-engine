import { existsSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";
import type { StoredSession } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import type { Seq } from "../session/ids.js";
import { sessionId } from "../session/ids.js";
import { buildVisibilityFloor } from "../visibility/floor.testing.js";
import { forkFromSeq } from "./forker.js";
import { buildPackage, decodePackage, encodePackage } from "./package.js";
import { rebuild } from "./replayer.js";

/**
 * VC-373 (PNFR-004, PNFR-007), replay half: a 1 000-transaction session of 5 `move`s each at
 * the Req NFR-020 floor (14 seats, 4 teams, 700 cards, 64 zones, 40 counters).
 *
 * Strict spec thresholds (`encodePackage` + `decodePackage` <= 3 s, `rebuild` without digests
 * <= 10 s, `forkFromSeq` <= the `rebuild` bound for the same prefix, retained heap growth of a
 * replay <= 64 MiB; median of 5 runs after 1 warm-up) are enforced in the Docker `test` target
 * (`/.dockerenv` exists) or with `CGE_PERF_STRICT=1`. Elsewhere a ceiling of 10x applies.
 */
const STRICT = process.env.CGE_PERF_STRICT === "1" || existsSync("/.dockerenv");
const SCALE = STRICT ? 1 : 10;
const CODEC_MS = 3_000 * SCALE;
const REBUILD_MS = 10_000 * SCALE;
const HEAP_BYTES = 64 * 1024 * 1024;
const TRANSACTIONS = 1_000;
const WARMUPS = 1;
const RUNS = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function measure(fn: () => void): number {
  for (let i = 0; i < WARMUPS; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

const { def, initial } = buildVisibilityFloor();
const resolved = {
  definitionId: computeDefinitionId(definitionContentHash(def)),
  definition: def,
};

/** 1 000 transactions of 5 moves rotating cards through public zones 14..21. */
function playLog(): StoredSession["log"] {
  const zones = [14, 15, 16, 17, 18, 19, 20, 21];
  const name = (i: number) => `zone-${String(i)}`;
  const log: {
    seq: Seq;
    eventId: string;
    principal: string;
    actions: readonly Action[];
  }[] = [];
  let state = initial;
  for (let t = 0; t < TRANSACTIONS; t++) {
    const sim = new Map<string, string[]>(
      zones.map((z) => [
        name(z),
        [...(state.zones[name(z) as never]?.members ?? [])],
      ]),
    );
    const batch: Action[] = [];
    for (let j = 0; j < 5; j++) {
      const k = (t * 5 + j) % zones.length;
      const src = name(zones[k] ?? 14);
      const dst = name(zones[(k + 1) % zones.length] ?? 14);
      const card = sim.get(src)?.shift() ?? "";
      const to = sim.get(dst) ?? [];
      const ordered = Number(dst.slice(5)) % 2 === 0;
      batch.push(A.move(card, src, dst, ordered ? 0 : undefined));
      if (ordered) to.unshift(card);
      else to.push(card);
    }
    const r = must(apply(def, state, batch));
    state = r.state;
    log.push({
      seq: state.seq,
      eventId: `evt-${String(t + 1)}`,
      principal: "perf",
      actions: r.committed,
    });
  }
  return log;
}

const log = playLog();
const stored: StoredSession = {
  sessionId: initial.id,
  definitionId: resolved.definitionId,
  definitionHash: definitionContentHash(def),
  schemaVersion: def.schemaVersion,
  initial,
  seq: log.length as Seq,
  log,
};
const built = buildPackage(stored, [], { resolved, digests: "none" });
if (!built.ok) throw new Error(built.error.detail);
const pkg = built.value;

const mode = STRICT ? "strict spec thresholds" : "10x local ceiling";
const report = (what: string, value: string) => {
  console.info(`floor ${what} ${value}`);
};

describe(`VC-373 replay at the floor (${mode})`, () => {
  it("the package is 1 000 transactions of 5 moves at the floor", () => {
    expect(pkg.log).toHaveLength(TRANSACTIONS);
    expect(pkg.log.every((t) => t.actions.length === 5)).toBe(true);
    expect(Object.keys(pkg.initial.cards)).toHaveLength(700);
    expect(Object.keys(pkg.initial.zones)).toHaveLength(64);
  });

  it(`encodePackage + decodePackage <= ${String(CODEC_MS)} ms`, () => {
    let bytes = 0;
    const ms = measure(() => {
      const encoded = encodePackage(pkg);
      bytes = encoded.length;
      const decoded = decodePackage(encoded);
      if (!decoded.ok) throw new Error("decode");
    });
    report(
      "encode+decode",
      `median ${ms.toFixed(1)} ms (limit ${String(CODEC_MS)}), ${String(bytes)} bytes`,
    );
    expect(ms).toBeLessThanOrEqual(CODEC_MS);
  });

  it(`rebuild of 1 000 transactions without digests <= ${String(REBUILD_MS)} ms`, () => {
    const ms = measure(() => {
      const r = rebuild(resolved, pkg);
      if (!r.ok) throw new Error(r.error.detail);
    });
    report(
      "rebuild",
      `median ${ms.toFixed(1)} ms (limit ${String(REBUILD_MS)})`,
    );
    expect(ms).toBeLessThanOrEqual(REBUILD_MS);
  });

  it(`forkFromSeq of the 1 000-transaction prefix <= the rebuild bound (${String(REBUILD_MS)} ms)`, () => {
    const id = must(sessionId("floor-fork"));
    const ms = measure(() => {
      const r = forkFromSeq(resolved, pkg, TRANSACTIONS, { sessionId: id });
      if (!r.ok) throw new Error(r.error.detail);
    });
    report(
      "forkFromSeq",
      `median ${ms.toFixed(1)} ms (limit ${String(REBUILD_MS)})`,
    );
    expect(ms).toBeLessThanOrEqual(REBUILD_MS);
  });

  it(`a 1 000-transaction replay retains <= 64 MiB beyond the initial state`, () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const settle = (): number => {
      gc();
      gc();
      return process.memoryUsage().heapUsed;
    };
    const growths: number[] = [];
    for (let i = 0; i < WARMUPS + RUNS; i++) {
      const before = settle();
      const r = rebuild(resolved, pkg);
      if (!r.ok) throw new Error(r.error.detail);
      const after = settle();
      expect(r.value.seq).toBe(TRANSACTIONS); // keeps the result alive until measured
      if (i >= WARMUPS) growths.push(after - before);
    }
    const growth = median(growths);
    report(
      "rebuild retained heap growth",
      `median ${(growth / 1048576).toFixed(2)} MiB (limit 64)`,
    );
    expect(growth).toBeLessThanOrEqual(HEAP_BYTES);
  });
});
