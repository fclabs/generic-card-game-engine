import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stateDigest } from "../replay/canonical/index.js";
import { createSession } from "./create.js";
import { actionsText } from "./actions.testing.js";
import { MACRO_KINDS, PRIMITIVE_KINDS, type Action } from "./actions.js";
import { apply } from "./apply/index.js";
import {
  GOLDEN_STEPS,
  goldenDefinition,
  goldenRoster,
} from "./golden-stream.testing.js";
import { isDeepFrozen } from "./snapshot.testing.js";
import type { Snapshot } from "./snapshot.js";
import type { SessionState } from "./state.js";
import { sessionId } from "./ids.js";

const FILE = new URL("./golden-stream.json", import.meta.url);
const CHECKPOINTS = [0, 10, 20, 30] as const;

interface GoldenFile {
  readonly description: string;
  readonly batches: number;
  readonly digests: Readonly<Record<string, string>>;
}

interface Run {
  readonly states: Snapshot<SessionState>[];
  readonly digests: string[];
  readonly committed: Action[][];
  readonly inputKinds: Set<string>;
}

/** Applies the whole golden stream from `createSession`; every batch must succeed. */
function runStream(): Run {
  const def = goldenDefinition();
  const id = sessionId("golden-1");
  if (!id.ok) throw new Error(id.error.detail);
  const created = createSession(def, id.value, goldenRoster());
  if (!created.ok) throw new Error(created.error.detail);
  const states: Snapshot<SessionState>[] = [created.value];
  const digests = [stateDigest(def, created.value)];
  const committed: Action[][] = [];
  const inputKinds = new Set<string>();
  GOLDEN_STEPS.forEach((step, i) => {
    const before = states[i];
    if (before === undefined) throw new Error("missing state");
    for (const a of step.batch) inputKinds.add(a.kind);
    const r = apply(def, before, step.batch, step.opts);
    if (!r.ok) {
      throw new Error(
        `golden batch ${String(i + 1)}: ${JSON.stringify(r.error)}`,
      );
    }
    states.push(r.value.state);
    digests.push(stateDigest(def, r.value.state));
    committed.push([...r.value.committed]);
  });
  return { states, digests, committed, inputKinds };
}

describe("VC-067 golden stream", () => {
  const first = runStream();

  it("is 30 batches, each non-empty, each committing exactly one seq", () => {
    expect(GOLDEN_STEPS).toHaveLength(30);
    first.states.forEach((s, i) => {
      expect(s.seq).toBe(i);
    });
    for (const c of first.committed) expect(c.length).toBeGreaterThan(0);
    expect(isDeepFrozen(first.states[30])).toBe(true);
  });

  it("covers every primitive kind, every macro and the six engine.* actions", () => {
    const committedKinds = new Set<string>(
      first.committed.flat().map((a) => a.kind),
    );
    for (const kind of PRIMITIVE_KINDS) {
      expect(committedKinds.has(kind), `primitive ${kind}`).toBe(true);
    }
    for (const kind of MACRO_KINDS) {
      expect(first.inputKinds.has(kind), `macro ${kind}`).toBe(true);
      expect(committedKinds.has(kind)).toBe(false);
    }
    const engines = new Set(
      first.committed
        .flat()
        .flatMap((a) => (a.kind === "meta" ? [a.schema_id] : [])),
    );
    for (const name of [
      "gate_open",
      "gate_submit",
      "gate_retract",
      "gate_resolve",
      "grant_expire",
      "grant_consume",
    ]) {
      expect(engines.has(`engine.${name}`), name).toBe(true);
    }
    const rosterOps = new Set(
      first.committed
        .flat()
        .flatMap((a) => (a.kind === "roster" ? [a.op] : [])),
    );
    expect([...rosterOps].sort()).toEqual([
      "delegate",
      "revoke_delegation",
      "set_status",
      "substitute",
    ]);
  });

  // Values worked out by hand from the stream (not from the digests), see the record.
  it("intermediate states match the hand-computed values", () => {
    const at = (n: number): Snapshot<SessionState> => {
      const s = first.states[n];
      if (s === undefined) throw new Error("no state");
      return s;
    };
    const members = (n: number, zone: string) =>
      Object.entries(at(n).zones).find(([id]) => id === zone)?.[1].members;
    const counter = (n: number, id: string) =>
      Object.entries(at(n).counters).find(([k]) => k === id)?.[1];
    expect(members(1, "deck")).toEqual(["c6", "c7", "c8"]);
    expect(members(1, "discard")).toEqual(["c3", "c4", "c5"]);
    expect(members(1, "hold")).toEqual(["c1", "c2"]);
    expect(members(3, "discard")).toEqual(["c5", "c6", "c3", "c4"]);
    // seq 4: bank 100+50-40-25, reserve 50+floor(25/3 half_even=8), pot 40+17, tally 30+4
    expect(counter(4, "bank")).toBe(85n);
    expect(counter(4, "reserve")).toBe(58n);
    expect(counter(4, "pot")).toBe(57n);
    expect(counter(4, "tally")).toBe(34n);
    // seq 5: advance 1 from s1 -> s2; named pointer dealer s2 +2 over [s3, s1, s2] -> s1
    expect(at(5).control.activeSeats).toEqual(["s2"]);
    expect(at(5).control.pointers).toEqual({ dealer: "s1" });
    expect(Object.keys(at(6).grants)).toEqual([
      "grant/6/0",
      "grant/6/1",
      "grant/6/2",
    ]);
    expect(Object.keys(at(7).grants)).toEqual(["grant/6/0"]);
    expect(members(12, "pile/_/1")).toEqual(["c8", "c1", "c2"]);
    expect(Object.keys(at(12).zones)).not.toContain("pile/_/2");
    expect(members(13, "deck")).toEqual([
      "c5",
      "c6",
      "c3",
      "c4",
      "c8",
      "c1",
      "c2",
    ]);
    expect(
      Object.values(at(13).cards).every((c) => c.orientation === "face_down"),
    ).toBe(true);
    expect(members(14, "table")).toEqual(["c2", "c1"]);
    // seq 17: reserve 58-21, bank 85+floor(21/2)-30, pot 57+11, tally 34-50
    expect(counter(17, "reserve")).toBe(37n);
    expect(counter(17, "bank")).toBe(65n);
    expect(counter(17, "pot")).toBe(68n);
    expect(counter(17, "tally")).toBe(-16n);
    // seq 24: half_even 15/2 -> 8 credited, remainder 7; half_up 5/2 -> 3
    expect(counter(24, "bank")).toBe(50n);
    expect(counter(24, "pot")).toBe(76n);
    expect(counter(24, "reserve")).toBe(44n);
    expect(counter(24, "tally")).toBe(-13n);
    // ordinals are never reused: stack/t1/1 was destroyed, the next t1 stack is /2
    expect(Object.keys(at(18).zones)).toContain("stack/t1/2");
    expect(Object.keys(at(18).zones)).not.toContain("stack/t1/1");
    expect(at(29).lifecycle).toBe("completed");
    expect(at(29).outcome).toEqual({ winner: "s1", scores: { s1: 10, s2: 3 } });
    expect(at(30).lifecycle).toBe("terminated");
    expect(at(30).outcome).toEqual(at(29).outcome);
  });

  it("digests at seq 0, 10, 20 and 30 equal the committed values", () => {
    if (process.env.UPDATE_GOLDEN === "1") {
      const file: GoldenFile = {
        description:
          "Expected stateDigest after seq 0, 10, 20 and 30 of the golden stream in golden-stream.testing.ts (VC-067).",
        batches: GOLDEN_STEPS.length,
        digests: Object.fromEntries(
          CHECKPOINTS.map((n) => [String(n), first.digests[n] ?? ""]),
        ),
      };
      writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
    }
    const committed = JSON.parse(readFileSync(FILE, "utf8")) as GoldenFile;
    expect(committed.batches).toBe(30);
    expect(Object.keys(committed.digests)).toEqual(["0", "10", "20", "30"]);
    for (const n of CHECKPOINTS) {
      expect(first.digests[n], `seq ${String(n)}`).toBe(
        committed.digests[String(n)],
      );
      expect(committed.digests[String(n)]).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(Object.values(committed.digests)).size).toBe(4);
  });

  it("a second run yields identical digests and committed actions at every step (VC-025)", () => {
    const second = runStream();
    expect(second.digests).toEqual(first.digests);
    expect(actionsText(second.committed.flat())).toBe(
      actionsText(first.committed.flat()),
    );
  });

  it("replaying the committed actions batch by batch reproduces every digest (VC-092 on the golden stream)", () => {
    const def = goldenDefinition();
    const start = first.states[0];
    if (start === undefined) throw new Error("no start");
    let state = start;
    first.committed.forEach((actions, i) => {
      const r = apply(def, state, actions);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.value.state;
      expect(stateDigest(def, state), `step ${String(i + 1)}`).toBe(
        first.digests[i + 1],
      );
    });
  });
});
