import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { err, ok } from "../errors/result.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { rosterOp } from "../session/apply/reducers.testing.js";
import { isDeepFrozen } from "../session/snapshot.testing.js";
import type { Seq } from "../session/ids.js";
import { sealBatch } from "../visibility/privileged-batch.js";
import { stateDigest } from "./canonical/state-schema.js";
import { buildGoldenPackageSession } from "./generate-golden-package.testing.js";
import { buildLiveSession } from "./live-session.testing.js";
import { decodePackage, encodePackage } from "./package.js";
import type { PackageTransaction, ReplayPackage } from "./package.js";
import { replayError } from "./replay-error.js";
import {
  advance,
  createReplayer,
  rebuild,
  replayer as defaultReplayer,
} from "./replayer.js";
import type { ReplayStep } from "./replayer.js";
import type { ResolvedDefinition } from "./resolved-definition.js";
import * as replayApi from "./index.js";
import * as rootApi from "../index.js";

const golden = buildGoldenPackageSession();
const { resolved, definition } = golden;
const pkg = golden.package;
const LAST = pkg.log.length;

/** A package with fields replaced (the type is readonly; tests tamper on purpose). */
function edit(over: Record<string, unknown>): ReplayPackage {
  return { ...pkg, ...over };
}

/** Re-binds a package to another resolved definition (id, game id, content hash). */
function rebind(base: ReplayPackage, to: ResolvedDefinition): ReplayPackage {
  return {
    ...base,
    definition: {
      id: to.definitionId,
      gameId: to.definition.gameId,
      contentHash: definitionContentHash(to.definition),
    },
  };
}

function resolve(def: CompiledGameDefinition): ResolvedDefinition {
  return {
    definitionId: computeDefinitionId(definitionContentHash(def)),
    definition: def,
  };
}

function withLog(log: readonly PackageTransaction[]): ReplayPackage {
  return edit({ log, digests: [] });
}

function failure<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): E {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing value");
  return value;
}

describe("VC-351 export, import, replay", () => {
  it("rebuild after encode/decode reproduces the live digest at every seq and the receipts", () => {
    const bytes = encodePackage(pkg);
    const decoded = decodePackage(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const seen: { seq: number; digest: string | undefined }[] = [];
    const r = rebuild(resolved, decoded.value, {
      verify: "every",
      onStep: (s) => {
        seen.push({ seq: s.seq, digest: s.digest });
        return ok(undefined);
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(seen).toHaveLength(LAST);
    seen.forEach((s, i) => {
      expect(s.seq).toBe(i + 1);
      const live = golden.states[i + 1];
      if (live === undefined) throw new Error("missing state");
      expect(s.digest).toBe(stateDigest(definition, live));
    });
    expect(r.value.seq).toBe(LAST);
    expect(r.value.state).toEqual(golden.states[LAST]);
    expect(r.value.digest).toBe(
      stateDigest(definition, golden.states[LAST] ?? golden.states[0]!),
    );
    expect(decoded.value.receipts).toEqual(pkg.receipts);
    expect(isDeepFrozen(r.value.state)).toBe(true);
  });

  it("the decoded package is not frozen or mutated by the replay", () => {
    const decoded = decodePackage(encodePackage(pkg));
    if (!decoded.ok) throw new Error("decode");
    const before = encodePackage(decoded.value);
    expect(rebuild(resolved, decoded.value).ok).toBe(true);
    expect(encodePackage(decoded.value)).toEqual(before);
    expect(Object.isFrozen(decoded.value.initial)).toBe(false);
  });
});

describe("VC-352 binding", () => {
  function counting(): { def: CompiledGameDefinition; calls: () => number } {
    let n = 0;
    const def: CompiledGameDefinition = {
      ...definition,
      metaSchemas: definition.metaSchemas.map((m) => {
        const inner = m.reducer;
        return inner === undefined
          ? m
          : {
              ...m,
              reducer: (...a: Parameters<typeof inner>) => {
                n += 1;
                return inner(...a);
              },
            };
      }),
    };
    return { def, calls: () => n };
  }

  it("a counting reducer is called by a successful replay (the probe works)", () => {
    const { def, calls } = counting();
    expect(rebuild(resolve(def), rebind(pkg, resolve(def))).ok).toBe(true);
    expect(calls()).toBeGreaterThan(0);
  });

  it.each([
    [
      "definition.id",
      { definition: { ...pkg.definition, id: "x".repeat(64) } },
    ],
    [
      "definition.gameId",
      { definition: { ...pkg.definition, gameId: "other-game" } },
    ],
    [
      "definition.contentHash",
      { definition: { ...pkg.definition, contentHash: "0".repeat(64) } },
    ],
    ["actionSchemaVersion", { actionSchemaVersion: 2 }],
  ])(
    "%s differs -> REPLAY_MISMATCH naming it, nothing applied",
    (field, over) => {
      const { def, calls } = counting();
      const r = rebuild(
        { definitionId: resolved.definitionId, definition: def },
        edit(over),
      );
      const e = failure(r);
      expect(e.code).toBe("REPLAY_MISMATCH");
      expect(e.path).toBe(field);
      expect(e.detail).toContain(field);
      expect(e.seq).toBe(0);
      expect(calls()).toBe(0);
    },
  );

  it("a package for another resolved definition id is a mismatch on definition.id", () => {
    const other = rebuild(
      { ...resolved, definitionId: computeDefinitionId("f".repeat(64)) },
      pkg,
    );
    expect(failure(other).path).toBe("definition.id");
  });
});

describe("VC-353 initial state", () => {
  const firstCard = Object.keys(pkg.initial.cards)[0] ?? "";
  const initial = pkg.initial as unknown as Record<string, unknown>;
  const tampered = (over: Record<string, unknown>) =>
    edit({ initial: { ...initial, ...over } });

  it("a card in a missing zone is REPLAY_INVALID at seq 0", () => {
    const card = present(pkg.initial.cards[firstCard as never]);
    const e = failure(
      rebuild(
        resolved,
        tampered({
          cards: {
            ...pkg.initial.cards,
            [firstCard]: { ...card, zone: "nowhere" },
          },
        }),
      ),
    );
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(0);
  });

  it("a card moved to another declared zone (digest differs) is REPLAY_INVALID at seq 0", () => {
    const card = present(pkg.initial.cards[firstCard as never]);
    const other = Object.keys(pkg.initial.zones).find((z) => z !== card.zone);
    const e = failure(
      rebuild(
        resolved,
        tampered({
          cards: {
            ...pkg.initial.cards,
            [firstCard]: { ...card, zone: other },
          },
        }),
      ),
    );
    expect(e.seq).toBe(0);
    expect(e.code).toBe("REPLAY_INVALID");
  });

  it("seq 3, lifecycle completed and non-matching rosters are REPLAY_INVALID at seq 0", () => {
    const seats = pkg.initial.roster.seats as Record<string, unknown>;
    const [firstSeat, ...rest] = Object.keys(seats);
    const withoutSeat = Object.fromEntries(
      rest.map((k) => [k, seats[k]]),
    ) as Record<string, unknown>;
    const cases: Record<string, unknown>[] = [
      { seq: 3 },
      { lifecycle: "completed" },
      { roster: { seats: withoutSeat } },
      {
        roster: {
          seats: { ...seats, ghost: { status: "seated" } },
        },
      },
      {
        roster: {
          seats: {
            ...seats,
            [firstSeat ?? ""]: {
              ...(seats[firstSeat ?? ""] as object),
              status: "left",
            },
          },
        },
      },
    ];
    for (const over of cases) {
      const e = failure(rebuild(resolved, tampered(over)));
      expect(e.code, JSON.stringify(Object.keys(over))).toBe("REPLAY_INVALID");
      expect(e.seq).toBe(0);
    }
  });

  it("initial.id may differ from sessionId (the digest excludes it)", () => {
    expect(rebuild(resolved, tampered({ id: "someone-else" })).ok).toBe(true);
  });
});

describe("VC-354 log integrity", () => {
  const log = pkg.log;

  it("a log starting at seq 2 is REPLAY_INVALID", () => {
    const e = failure(rebuild(resolved, withLog(log.slice(1))));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(1);
  });

  it("a gap in the log is REPLAY_INVALID at the first position that breaks it", () => {
    const e = failure(
      rebuild(resolved, withLog([...log.slice(0, 3), ...log.slice(4)])),
    );
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(4);
  });

  it("an empty transaction is REPLAY_INVALID", () => {
    const bad = log.map((tx) => (tx.seq === 5 ? { ...tx, actions: [] } : tx));
    const e = failure(rebuild(resolved, withLog(bad)));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(5);
    expect(e.detail).toContain("empty");
  });

  it("a macro, an unknown kind and a stray field are REPLAY_INVALID with the action index", () => {
    const variants: [string, unknown][] = [
      ["macro", A.draw("deck", 1, "table")],
      ["unknown kind", { kind: "teleport" }],
      ["stray field", { ...A.flip("c1", "face_up"), amount: 1n }],
    ];
    for (const [name, action] of variants) {
      const bad = log.map((tx) =>
        tx.seq === 2
          ? { ...tx, actions: [...tx.actions, action as Action] }
          : tx,
      );
      const e = failure(rebuild(resolved, withLog(bad)));
      expect(e.code, name).toBe("REPLAY_INVALID");
      expect(e.seq, name).toBe(2);
      expect(e.actionIndex, name).toBe(log[1]?.actions.length);
    }
  });

  it("a move of a card not in from_zone at transaction 7, action 2 reports seq, actionIndex and the code", () => {
    const state6 = golden.states[6];
    if (state6 === undefined) throw new Error("state");
    const [cardKey] = Object.keys(state6.cards);
    const card = present(state6.cards[cardKey as never]);
    const wrong = definition.zones.find((z) => z.id !== card.zone)?.id ?? "";
    const orientation =
      card.orientation === "face_up" ? "face_down" : "face_up";
    const actions = [
      A.flip(cardKey ?? "", orientation),
      A.flip(cardKey ?? "", card.orientation),
      A.move(cardKey ?? "", wrong, card.zone),
    ];
    const bad = log.map((tx) => (tx.seq === 7 ? { ...tx, actions } : tx));
    const e = failure(rebuild(resolved, withLog(bad)));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(7);
    expect(e.actionIndex).toBe(2);
    expect(e.detail).toContain("CARD_NOT_IN_ZONE");
  });

  it("a transaction after the session completed is REPLAY_INVALID (SESSION_ENDED)", () => {
    const extra: PackageTransaction = {
      seq: (LAST + 1) as Seq,
      eventId: "evt-x",
      principal: "host",
      actions: [A.flip("c1", "face_up")],
    };
    const e = failure(rebuild(resolved, withLog([...log, extra])));
    expect(e.seq).toBe(LAST + 1);
    expect(e.detail).toContain("SESSION_ENDED");
  });
});

describe("VC-355 hook-free replay", () => {
  const SENTINEL_NAMES = ["HookRunner", "ReactionHook", "ValidationHook"];

  it("sentinel hooks bound to the definition are never called by rebuild or advance", () => {
    let called = 0;
    const sentinel = () => {
      called += 1;
      throw new Error("hook called during replay");
    };
    const hooked: CompiledGameDefinition = {
      ...definition,
      hookBindings: { move: ["sentinel-a"], "*": ["sentinel-b"] },
    };
    const hooks = { "sentinel-a": sentinel, "sentinel-b": sentinel };
    const res = resolve(hooked);
    const bound = rebind(pkg, res);
    expect(Object.keys(hooks)).toHaveLength(2);
    expect(rebuild(res, bound, { verify: "every" }).ok).toBe(true);
    let state = golden.states[0];
    for (const tx of pkg.log) {
      if (state === undefined) throw new Error("state");
      const next = advance(res, state, sealBatch(tx));
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.value;
    }
    expect(called).toBe(0);
  });

  it("replay sources reference no hook SPI name and import nothing from spi/", () => {
    const dir = new URL("./", import.meta.url).pathname;
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files).toContain("replayer.ts");
    for (const f of files) {
      const src = readFileSync(`${dir}${f}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
      for (const name of SENTINEL_NAMES) {
        expect(src, `${f} mentions ${name}`).not.toContain(name);
      }
      expect(src, `${f} imports spi`).not.toMatch(
        /from\s*["'][^"']*\/spi\/[^"']*["']/,
      );
    }
  });
});

describe("VC-356 meta and roster reducers", () => {
  it("meta actions replay through the definition's reducers (golden session)", () => {
    expect(
      pkg.log.some((tx) => tx.actions.some((a) => a.kind === "meta")),
    ).toBe(true);
    expect(rebuild(resolved, pkg, { verify: "every" }).ok).toBe(true);
  });

  it("an unbound meta reducer is REPLAY_INVALID 'reducer not bound', never skipped", () => {
    const def: CompiledGameDefinition = {
      ...definition,
      metaSchemas: definition.metaSchemas.map((m) => {
        const { reducer: _unbound, ...rest } = m;
        void _unbound;
        return rest;
      }),
    };
    const res = resolve(def);
    const firstMeta = pkg.log.find((tx) =>
      tx.actions.some(
        (a) =>
          a.kind === "meta" &&
          !(a as { schema_id: string }).schema_id.startsWith("engine."),
      ),
    );
    const e = failure(rebuild(res, rebind(withLog(pkg.log), res)));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(firstMeta?.seq);
    expect(e.detail).toContain("reducer not bound: ");
  });

  it("an unbound roster reducer is REPLAY_INVALID 'reducer not bound'", () => {
    const { rosterReducer: _unbound, ...rest } = definition;
    void _unbound;
    const res = resolve(rest);
    const tx: PackageTransaction = {
      seq: 1 as Seq,
      eventId: "evt-1",
      principal: "host",
      actions: [
        rosterOp("set_status", { seat_id: "s3", status: "sitting_out" }),
      ],
    };
    const e = failure(
      rebuild(res, rebind(edit({ log: [tx], digests: [] }), res)),
    );
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(1);
    expect(e.detail).toContain("reducer not bound: ");
  });
});

describe("VC-357 shuffle", () => {
  it("the logged permutation alone drives replay: the PRNG seed param is irrelevant", () => {
    expect(
      pkg.log.some((tx) => tx.actions.some((a) => a.kind === "shuffle")),
    ).toBe(true);
    const base = rebuild(resolved, pkg);
    const { seed: _seed, ...restParams } = pkg.params as Record<
      string,
      unknown
    >;
    void _seed;
    for (const params of [
      restParams,
      { ...restParams, seed: "another-seed" },
      {},
    ]) {
      const other = rebuild(resolved, edit({ params }));
      expect(other.ok).toBe(true);
      if (!other.ok || !base.ok) return;
      expect(other.value.digest).toBe(base.value.digest);
    }
  });
});

describe("VC-358 digest verification", () => {
  it("a flipped recorded digest is REPLAY_INVALID 'digest mismatch' at that seq", () => {
    const digests = pkg.digests.map((d) =>
      d.seq === 5
        ? {
            ...d,
            digest: d.digest.replace(/^./, (c) => (c === "0" ? "1" : "0")),
          }
        : d,
    );
    const e = failure(rebuild(resolved, edit({ digests })));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.seq).toBe(5);
    expect(e.detail).toContain("digest mismatch");
  });

  it("digests beyond uptoSeq are ignored", () => {
    const digests = pkg.digests.map((d) =>
      d.seq === 9 ? { ...d, digest: "0".repeat(64) } : d,
    );
    expect(rebuild(resolved, edit({ digests }), { uptoSeq: 8 }).ok).toBe(true);
    expect(rebuild(resolved, edit({ digests }), { uptoSeq: 9 }).ok).toBe(false);
  });

  it("a recorded digest for seq 0 is checked against the initial state", () => {
    const digests = [{ seq: 0 as Seq, digest: "0".repeat(64) }];
    const e = failure(rebuild(resolved, edit({ digests })));
    expect(e.seq).toBe(0);
    expect(e.detail).toContain("digest mismatch");
  });

  it("verify 'every' reports a digest at each onStep, recorded or not; default only where needed", () => {
    const none = edit({ digests: [] });
    const every: (string | undefined)[] = [];
    rebuild(resolved, none, {
      verify: "every",
      onStep: (s) => {
        every.push(s.digest);
        return ok(undefined);
      },
    });
    expect(every).toHaveLength(LAST);
    expect(every.every((d) => typeof d === "string")).toBe(true);
    const recorded: (string | undefined)[] = [];
    rebuild(resolved, none, {
      onStep: (s) => {
        recorded.push(s.digest);
        return ok(undefined);
      },
    });
    expect(recorded.slice(0, -1).every((d) => d === undefined)).toBe(true);
    expect(recorded.at(-1)).toBe(every.at(-1));
  });
});

describe("VC-359 uptoSeq and onStep", () => {
  it("0 is the initial state, n the state at n, the last seq the full replay", () => {
    for (const n of [0, 1, 6, LAST]) {
      const r = rebuild(resolved, pkg, { uptoSeq: n });
      expect(r.ok, `uptoSeq ${String(n)}`).toBe(true);
      if (!r.ok) return;
      expect(r.value.seq).toBe(n);
      expect(r.value.state).toEqual(golden.states[n]);
      const live = golden.states[n];
      if (live === undefined) throw new Error("state");
      expect(r.value.digest).toBe(stateDigest(definition, live));
    }
  });

  it("out-of-range uptoSeq is REPLAY_INVALID at seq 0", () => {
    for (const n of [LAST + 1, -1, 1.5, Number.NaN]) {
      const e = failure(rebuild(resolved, pkg, { uptoSeq: n }));
      expect(e.code).toBe("REPLAY_INVALID");
      expect(e.seq).toBe(0);
      expect(e.detail).toContain("uptoSeq out of range");
    }
  });

  it("onStep is called exactly n times in order", () => {
    const seqs: number[] = [];
    const r = rebuild(resolved, pkg, {
      uptoSeq: 7,
      onStep: (s: ReplayStep) => {
        seqs.push(s.seq);
        expect(s.post.seq).toBe(s.seq);
        expect(s.pre.seq).toBe(s.seq - 1);
        return ok(undefined);
      },
    });
    expect(r.ok).toBe(true);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    let none = 0;
    rebuild(resolved, pkg, {
      uptoSeq: 0,
      onStep: () => {
        none += 1;
        return ok(undefined);
      },
    });
    expect(none).toBe(0);
  });

  it("an error returned from step 3 stops the replay there with that error", () => {
    const stop = replayError("REPLAY_INVALID", 3, "stop here");
    const seqs: number[] = [];
    const r = rebuild(resolved, pkg, {
      onStep: (s) => {
        seqs.push(s.seq);
        return s.seq === 3 ? err(stop) : ok(undefined);
      },
    });
    expect(seqs).toEqual([1, 2, 3]);
    expect(failure(r)).toBe(stop);
  });

  it("the batch handed to onStep is opaque and carries the transaction", () => {
    rebuild(resolved, pkg, {
      uptoSeq: 1,
      onStep: (s) => {
        expect(JSON.stringify(s.batch)).toBe("{}");
        expect(Object.keys(s.batch)).toEqual([]);
        return ok(undefined);
      },
    });
  });
});

describe("VC-360 advance", () => {
  it("folding onStep batches with advance yields the digests of rebuild; input unchanged", () => {
    const batches: ReplayStep[] = [];
    const base = rebuild(resolved, pkg, {
      verify: "every",
      onStep: (s) => {
        batches.push(s);
        return ok(undefined);
      },
    });
    expect(base.ok).toBe(true);
    let state = golden.states[0];
    if (state === undefined) throw new Error("state");
    for (const step of batches) {
      const before = stateDigest(definition, state);
      const input = state;
      const next = advance(resolved, state, step.batch);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(stateDigest(definition, input)).toBe(before);
      expect(stateDigest(definition, next.value)).toBe(step.digest);
      state = next.value;
    }
    if (!base.ok) return;
    expect(state).toEqual(base.value.state);
  });

  it("a batch for seq 5 on a state at 3 is REPLAY_INVALID; so is a replayed or empty-seq batch", () => {
    const state3 = golden.states[3];
    if (state3 === undefined) throw new Error("state");
    const tx = (seq: Seq | null) =>
      sealBatch({
        seq,
        eventId: "e",
        principal: "p",
        actions: pkg.log[4]?.actions ?? [],
      });
    for (const seq of [5 as Seq, 3 as Seq, null]) {
      const r = advance(resolved, state3, tx(seq));
      const e = failure(r);
      expect(e.code).toBe("REPLAY_INVALID");
    }
  });

  it("an action that fails in the batch is REPLAY_INVALID with the actionIndex", () => {
    const state0 = golden.states[0];
    if (state0 === undefined) throw new Error("state");
    const batch = sealBatch({
      seq: 1 as Seq,
      eventId: "e",
      principal: "p",
      actions: [A.flip("c1", "face_up"), A.move("c1", "table", "deck")],
    });
    const e = failure(advance(resolved, state0, batch));
    expect(e.code).toBe("REPLAY_INVALID");
    expect(e.actionIndex).toBe(1);
  });
});

describe("createReplayer and exports", () => {
  const upgraders = [] as const;
  it("validates the version policy", () => {
    expect(() =>
      createReplayer({ versions: { current: 2, supported: [1] }, upgraders }),
    ).toThrow(RangeError);
    expect(() =>
      createReplayer({ versions: { current: 1, supported: [] }, upgraders }),
    ).toThrow(RangeError);
    expect(() =>
      createReplayer({ versions: { current: 0, supported: [0] }, upgraders }),
    ).toThrow(RangeError);
    expect(() =>
      createReplayer({
        versions: { current: 1, supported: [1, 1] },
        upgraders,
      }),
    ).toThrow(RangeError);
    const r = createReplayer({
      versions: { current: 2, supported: [1, 2] },
      upgraders,
    });
    expect(r.rebuild(resolved, pkg).ok).toBe(true);
  });

  it("exports the default replayer and free functions through replay/ and the root", () => {
    for (const name of [
      "replayer",
      "rebuild",
      "advance",
      "createReplayer",
    ] as const) {
      expect(replayApi[name], name).toBeDefined();
      expect(rootApi[name], name).toBe(replayApi[name]);
    }
    expect(replayApi.rebuild(resolved, pkg).ok).toBe(true);
    expect(defaultReplayer.rebuild(resolved, pkg).ok).toBe(true);
    expect("openBatch" in rootApi).toBe(false);
  });
});

describe("live sessions", () => {
  it("a generated live session replays to its live digests", () => {
    const live = buildLiveSession([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7], {
      transactions: 12,
    });
    const digests: string[] = [live.digests[0] ?? ""];
    const r = rebuild(live.resolved, live.package, {
      verify: "every",
      onStep: (s) => {
        digests.push(s.digest ?? "");
        return ok(undefined);
      },
    });
    expect(r.ok).toBe(true);
    expect(digests).toEqual(live.digests);
  });
});
