import { describe, expect, it } from "vitest";
import { must } from "../session/apply/apply.testing.js";
import { sessionId } from "../session/ids.js";
import { A } from "../session/actions.testing.js";
import { CANARY_TOKEN } from "../visibility/generators.testing.js";
import {
  checkCompleteness,
  checkNoLeak,
  emptyStats,
} from "../visibility/property-checks.testing.js";
import type { PropertyInput } from "../visibility/property-checks.testing.js";
import { projectDelta } from "../visibility/project-delta.js";
import { projectView } from "../visibility/project-view.js";
import { stateDigest } from "./canonical/state-schema.js";
import { continueFork } from "./forker.testing.js";
import { forkFromSeq } from "./forker.js";
import { decodePackage, encodePackage } from "./package.js";
import { ok } from "../errors/result.js";
import { rebuild } from "./replayer.js";
import type { ReplayStep } from "./replayer.js";
import {
  buildTrickSession,
  VIEWERS,
  viewerLabel,
} from "./trick-session.testing.js";

/**
 * VC-378 (end to end): a complete four-seat trick-taking session (sealed gate, a `once` grant
 * consumed through `wouldReveal`, shuffles, a lifecycle end; more than 60 transactions) is
 * played live, every role's View and Delta stored at every seq, exported, decoded, replayed and
 * forked at the midpoint. Replay-derived views and deltas equal the live ones, the fork's
 * equal the original's up to the fork point, and the no-leak check passes on all of them.
 */
const session = buildTrickSession();
const total = session.steps.length;
const mid = Math.floor(total / 2);

/** Replays `pkg` through `rebuild` and compares every stored view and delta up to `upto`. */
function compareReplay(
  pkg: Parameters<typeof rebuild>[1],
  upto: number,
  resolved = session.resolved,
): { steps: number } {
  let steps = 0;
  const onStep = (s: ReplayStep) => {
    steps += 1;
    VIEWERS.forEach((v, i) => {
      expect(
        JSON.stringify(must(projectView(session.def, s.post, v))),
        `view seq ${String(s.seq)} ${viewerLabel(v)}`,
      ).toBe(session.views[s.seq]?.[i]);
      expect(
        JSON.stringify(
          must(projectDelta(session.def, s.pre, s.post, s.batch, v)),
        ),
        `delta seq ${String(s.seq)} ${viewerLabel(v)}`,
      ).toBe(session.deltas[s.seq]?.[i]);
    });
    return ok(undefined);
  };
  const r = rebuild(resolved, pkg, { verify: "every", onStep, uptoSeq: upto });
  expect(r.ok, r.ok ? "" : r.error.detail).toBe(true);
  if (r.ok) {
    expect(r.value.seq).toBe(upto);
    expect(r.value.digest).toBe(session.digests[upto]);
  }
  return { steps };
}

describe("VC-378 end-to-end trick-taking session", () => {
  it("is the scenario the criterion asks for", () => {
    expect(total).toBeGreaterThanOrEqual(60);
    const kinds = new Set(
      session.steps.flatMap((s) => s.tx.actions.map((a) => a.kind)),
    );
    for (const k of [
      "move",
      "flip",
      "shuffle",
      "grant_view",
      "counter_transfer",
      "control_advance",
      "lifecycle",
      "meta",
    ]) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    const metas = session.steps.flatMap((s) =>
      s.tx.actions.flatMap((a) => (a.kind === "meta" ? [a.schema_id] : [])),
    );
    expect(metas).toContain("engine.gate_open");
    expect(metas).toContain("engine.gate_submit");
    expect(metas).toContain("engine.gate_resolve");
    expect(metas).toContain("engine.grant_consume");
    expect(session.states[total]?.lifecycle).toBe("completed");
    // The once grant was flagged by wouldReveal and consumed; the temporary one expired by scope.
    expect(session.consumed).toHaveLength(1);
    expect(Object.keys(session.states[total]?.grants ?? {})).toHaveLength(1);
  });

  it("the consuming delta reveals what the grant showed, and no later view does", () => {
    const at = session.steps.findIndex((s) =>
      s.tx.actions.some(
        (a) => a.kind === "meta" && a.schema_id === "engine.grant_consume",
      ),
    );
    expect(at).toBeGreaterThan(0);
    const east = VIEWERS.findIndex(
      (v) => v.subject === "east" && v.role === "player",
    );
    const delta = JSON.parse(session.deltas[at + 1]?.[east] ?? "{}") as {
      entries: { card_id?: string; face?: unknown }[];
    };
    expect(delta.entries.some((e) => e.face !== undefined)).toBe(true);
    for (let seq = at + 2; seq <= total; seq++) {
      const view = JSON.parse(session.views[seq]?.[east] ?? "{}") as {
        grants: Record<string, unknown>;
        zones: Record<string, { members?: unknown[] }>;
      };
      expect(Object.keys(view.grants)).not.toContain(session.consumed[0]);
      expect(view.zones["hand-north"]).toBeUndefined();
    }
  });

  it("live digests equal the package digests and the replay digests at every seq", () => {
    expect(session.package.digests.map((d) => d.digest)).toEqual(
      session.digests.slice(1),
    );
    const r = compareReplay(session.package, total);
    expect(r.steps).toBe(total);
  });

  it("export -> decode -> replay reproduces every live view and delta", () => {
    const bytes = encodePackage(session.package);
    const d = decodePackage(bytes);
    if (!d.ok) throw new Error(JSON.stringify(d.error));
    const decoded = d.value;
    expect(encodePackage(decoded)).toEqual(bytes);
    expect(compareReplay(decoded, total).steps).toBe(total);
    // The same bytes straight into rebuild (raw input path).
    const raw = rebuild(session.resolved, bytes, { verify: "every" });
    expect(raw.ok && raw.value.digest).toBe(session.digests[total]);
  });

  it("fork at the midpoint: views and deltas up to n equal the original's; the original is untouched", () => {
    const decoded = decodePackage(encodePackage(session.package));
    if (!decoded.ok) throw new Error("decode");
    const before = encodePackage(decoded.value);
    const forkId = must(sessionId("fork-e2e"));
    const forked = must(
      forkFromSeq(session.resolved, decoded.value, mid, { sessionId: forkId }),
    );
    expect(forked.package.log).toHaveLength(mid);
    expect(forked.package.forkedFrom).toEqual({
      sessionId: session.package.sessionId,
      seq: mid,
    });
    expect(stateDigest(session.def, forked.state)).toBe(session.digests[mid]);
    // The fork's package replays to the original's views and deltas for seq <= n.
    expect(compareReplay(forked.package, mid).steps).toBe(mid);
    VIEWERS.forEach((v, i) => {
      expect(
        JSON.stringify(must(projectView(session.def, forked.state, v))),
      ).toBe(session.views[mid]?.[i]);
    });
    // It continues independently of the original.
    const next = must(
      continueFork(session.resolved, forked, [
        A.transfer("pot", "chips-north", 1n),
      ]),
    );
    expect(next.state.seq).toBe(mid + 1);
    expect(next.state.id).toBe(forkId);
    expect(encodePackage(decoded.value)).toEqual(before);
    expect(
      rebuild(session.resolved, next.package, { verify: "every" }).ok,
    ).toBe(true);
  });

  const input = (): PropertyInput => ({
    def: session.def,
    states: session.states,
    steps: session.steps,
    grants: true,
  });

  it.each(["player", "render", "dealer", "auditor"] as const)(
    "no-leak and completeness hold on every output of the session (%s)",
    (cls) => {
      const stats = emptyStats();
      checkNoLeak(input(), cls, stats);
      checkCompleteness(input(), cls, stats);
      expect(stats.views).toBeGreaterThan(total);
      expect(stats.deltas).toBeGreaterThan(0);
      expect(stats.withheldTokens).toBeGreaterThan(0);
    },
    120_000,
  );

  it("no canary of the data appears in any stored view or delta of a role not entitled to it", () => {
    // The player outputs hold only what the entitlement model gave them: another seat's
    // card secrets and the gate payloads of other seats never show up.
    const north = VIEWERS.findIndex(
      (v) => v.subject === "north" && v.role === "player",
    );
    const own = new Set<string>();
    for (let seq = 0; seq <= total; seq++) {
      for (const text of [
        session.views[seq]?.[north],
        session.deltas[seq]?.[north],
      ]) {
        for (const t of text?.match(CANARY_TOKEN) ?? []) own.add(t);
      }
    }
    // north never learns a secret field (`key`) and never sees other seats' gate payloads.
    expect([...own].filter((t) => t.startsWith("zqsecret"))).toEqual([]);
    expect(
      [...own].filter((t) => t.startsWith("zqgate")).length,
    ).toBeLessThanOrEqual(1);
    // The data really contains secrets (not vacuous).
    expect(session.secrets.length).toBeGreaterThan(20);
  });
});
