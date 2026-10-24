import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../ports/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { must } from "../session/apply/apply.testing.js";
import { apply } from "../session/apply/index.js";
import { seatId } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { SessionState } from "../session/state.js";
import { buildVisibilityFloor } from "./floor.testing.js";
import { sealBatch } from "./privileged-batch.js";
import { projectDelta } from "./project-delta.js";
import { projectView } from "./project-view.js";
import type { ViewerIdentity } from "./types.js";
import { wouldReveal } from "./would-reveal.js";

/**
 * VC-373 (PNFR-004, PNFR-007), visibility half: the Req NFR-020 floor (14 seats, 4 teams, 700
 * cards, 64 zones, 40 counters) with real visibility rules.
 *
 * Strict spec thresholds (`projectView` <= 100 ms, `projectDelta` of a 20-move batch <= 50 ms,
 * `wouldReveal` with 5 `once` grants <= 250 ms, a `View` <= 1 MiB; median of 5 runs after 1
 * warm-up) are enforced in the Docker `test` target (`/.dockerenv` exists) or with
 * `CGE_PERF_STRICT=1`. Elsewhere a ceiling of 10x each threshold applies, so a laptop or a busy CI
 * box still catches an order-of-magnitude regression without flaking. The mode is in the name.
 */
const STRICT = process.env.CGE_PERF_STRICT === "1" || existsSync("/.dockerenv");
const SCALE = STRICT ? 1 : 10;
const VIEW_MS = 100 * SCALE;
const DELTA_MS = 50 * SCALE;
const REVEAL_MS = 250 * SCALE;
const VIEW_BYTES = 1024 * 1024;
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

const { def, state } = buildVisibilityFloor();
const seat = (n: number) => must(seatId(`seat-${String(n).padStart(2, "0")}`));
const VIEWERS: readonly ViewerIdentity[] = [
  { role: "player", subject: seat(1) },
  { role: "render", subject: seat(1) },
  { role: "render" },
  { role: "auditor" },
  { role: "dealer" },
];
const label = (v: ViewerIdentity) =>
  `${v.role}${v.subject === undefined ? "" : `@${v.subject}`}`;

/** `count` moves rotating cards through `zones` (indexes into zone-NN), simulated on membership. */
function moves(
  from: Snapshot<SessionState>,
  zones: readonly number[],
  count: number,
): Action[] {
  const name = (i: number) => `zone-${String(i).padStart(2, "0")}`;
  const sim = new Map<string, string[]>(
    zones.map((z) => [
      name(z),
      [...(from.zones[name(z) as never]?.members ?? [])],
    ]),
  );
  const batch: Action[] = [];
  for (let j = 0; j < count; j++) {
    const src = name(zones[j % zones.length] ?? 0);
    const dst = name(zones[(j + 1) % zones.length] ?? 0);
    const card = sim.get(src)?.shift() ?? "";
    const to = sim.get(dst) ?? [];
    const ordered = Number(dst.slice(5)) % 2 === 0;
    batch.push(A.move(card, src, dst, ordered ? 0 : undefined));
    if (ordered) to.unshift(card);
    else to.push(card);
  }
  return batch;
}

function sealed(
  pre: Snapshot<SessionState>,
  actions: readonly Action[],
): {
  post: Snapshot<SessionState>;
  batch: ReturnType<typeof sealBatch>;
} {
  const r = must(apply(def, pre, actions));
  const tx: Transaction = {
    seq: r.state.seq,
    eventId: "evt-perf",
    principal: "perf",
    actions: r.committed,
  };
  return { post: r.state, batch: sealBatch(tx) };
}

const mode = STRICT ? "strict spec thresholds" : "10x local ceiling";
const report = (what: string, ms: number, limit: number) => {
  console.info(
    `floor ${what} median ${ms.toFixed(2)} ms (limit ${String(limit)})`,
  );
};

describe(`VC-373 visibility at the floor (${mode})`, () => {
  it("the fixture is the NFR-020 floor", () => {
    expect(def.seats).toHaveLength(14);
    expect(def.teams).toHaveLength(4);
    expect(Object.keys(state.cards)).toHaveLength(700);
    expect(Object.keys(state.zones)).toHaveLength(64);
    expect(def.counters).toHaveLength(40);
  });

  it.each(VIEWERS.map((v) => [label(v), v] as const))(
    `projectView %s <= ${String(VIEW_MS)} ms and its JSON <= 1 MiB`,
    (_name, viewer) => {
      const ms = measure(() => {
        must(projectView(def, state, viewer));
      });
      report(`projectView ${label(viewer)}`, ms, VIEW_MS);
      expect(ms).toBeLessThanOrEqual(VIEW_MS);
      const view = must(projectView(def, state, viewer));
      const bytes = Buffer.byteLength(JSON.stringify(view), "utf8");
      console.info(`floor View ${label(viewer)} ${String(bytes)} bytes`);
      expect(bytes).toBeLessThanOrEqual(VIEW_BYTES);
    },
  );

  it("worst case: every zone public to every role, all 700 cards with faces", () => {
    const open = {
      ...def,
      zones: def.zones.map((z) => ({
        ...z,
        visibility: {
          default: "public",
          auditor: "public",
          dealer: "public",
        } as const,
      })),
    };
    const faceUp = must(
      apply(
        open,
        state,
        Object.keys(state.cards)
          .filter((id) => state.cards[id as never]?.orientation === "face_down")
          .map((id) => A.flip(id, "face_up")),
      ),
    ).state;
    for (const viewer of [1, 3, 4].map((i) => VIEWERS[i] as ViewerIdentity)) {
      const ms = measure(() => {
        must(projectView(open, faceUp, viewer));
      });
      const bytes = Buffer.byteLength(
        JSON.stringify(must(projectView(open, faceUp, viewer))),
        "utf8",
      );
      console.info(
        `floor worst-case projectView ${label(viewer)} median ${ms.toFixed(2)} ms, ${String(bytes)} bytes`,
      );
      expect(ms).toBeLessThanOrEqual(VIEW_MS);
      expect(bytes).toBeLessThanOrEqual(VIEW_BYTES);
    }
  });

  it(`projectDelta of a 20-move batch <= ${String(DELTA_MS)} ms`, () => {
    const { post, batch } = sealed(state, moves(state, [14, 15, 16, 17], 20));
    for (const viewer of VIEWERS) {
      const ms = measure(() => {
        must(projectDelta(def, state, post, batch, viewer));
      });
      report(`projectDelta ${label(viewer)}`, ms, DELTA_MS);
      expect(ms).toBeLessThanOrEqual(DELTA_MS);
    }
  });

  it(`wouldReveal with 5 once grants <= ${String(REVEAL_MS)} ms`, () => {
    // Five once grants on hands 0..4, one grantee each; the batch moves hand cards away.
    const grants = [0, 1, 2, 3, 4].map((i) =>
      A.grant(
        { kind: "zone", zone_id: `zone-${String(i).padStart(2, "0")}` },
        ["zone_membership", "card_face"],
        `seat-${String(i + 6).padStart(2, "0")}`,
        { kind: "once" },
      ),
    );
    const pre = must(apply(def, state, grants)).state;
    expect(Object.keys(pre.grants)).toHaveLength(5);
    // 20 moves out of hands 0..4 into public zones 20..23 (4 per hand).
    const out: Action[] = [];
    [0, 1, 2, 3, 4].forEach((h) => {
      const hand = `zone-${String(h).padStart(2, "0")}`;
      (pre.zones[hand as never]?.members ?? [])
        .slice(0, 4)
        .forEach((card, k) => {
          const dst = `zone-${String(20 + k)}`;
          out.push(
            A.move(
              card,
              hand,
              dst,
              Number(dst.slice(5)) % 2 === 0 ? 0 : undefined,
            ),
          );
        });
    });
    const { post, batch } = sealed(pre, out);
    expect(out).toHaveLength(20);
    const ms = measure(() => {
      wouldReveal(def, pre, post, batch);
    });
    report("wouldReveal (5 once grants, 20 moves)", ms, REVEAL_MS);
    expect(wouldReveal(def, pre, post, batch)).toHaveLength(5);
    expect(ms).toBeLessThanOrEqual(REVEAL_MS);
  });
});
