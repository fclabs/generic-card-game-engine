import { describe, expect, it } from "vitest";
import type { CompiledGameDefinition } from "../definition/types.js";
import { A } from "../session/actions.testing.js";
import type { Action } from "../session/actions.js";
import { engine, meta } from "../session/apply/reducers.testing.js";
import type { Seq } from "../session/ids.js";
import { forkFromSeq } from "./forker.js";
import { decodePackage, encodePackage } from "./package.js";
import type { PackageTransaction, ReplayPackage } from "./package.js";
import { rebuild } from "./replayer.js";
import { buildTrickSession } from "./trick-session.testing.js";
import {
  computeDefinitionId,
  definitionContentHash,
} from "../definition/identity.js";

/**
 * VC-376 (PBR-008), replay half: errors the Replayer, the Forker, the upgrade chain and the
 * package decoder report are operator-facing and may name card, zone, counter and seat ids, but
 * never a hidden metadata value, a sealed gate payload or a counter value. Every failing call
 * below is scanned for every secret of the session (and for the values the tampering itself
 * smuggles in).
 */
const session = buildTrickSession();
const pkg = session.package;
const resolved = session.resolved;
const SMUGGLED = "zqsmuggled7x";
const TAMPER_COUNTER = 987654321n;

interface Probe {
  readonly name: string;
  readonly error: unknown;
}
const probes: Probe[] = [];
function record(name: string, r: { ok: boolean; error?: unknown }): void {
  expect(r.ok, name).toBe(false);
  probes.push({ name, error: r.error });
}

const edit = (over: Record<string, unknown>): ReplayPackage => ({
  ...pkg,
  ...over,
});
const logWith = (seq: number, actions: readonly Action[]): ReplayPackage =>
  edit({
    log: pkg.log.map((tx) => (tx.seq === seq ? { ...tx, actions } : tx)),
    digests: [],
  });
const tx = (seq: number): PackageTransaction => {
  const t = pkg.log[seq - 1];
  if (t === undefined) throw new Error("tx");
  return t;
};

describe("VC-376 replay errors carry no hidden value", () => {
  it("binding mismatches", () => {
    record(
      "definition.id",
      rebuild(
        { ...resolved, definitionId: computeDefinitionId("e".repeat(64)) },
        pkg,
      ),
    );
    record(
      "gameId",
      rebuild(
        resolved,
        edit({ definition: { ...pkg.definition, gameId: SMUGGLED } }),
      ),
    );
    record(
      "contentHash",
      rebuild(
        resolved,
        edit({
          definition: { ...pkg.definition, contentHash: "0".repeat(64) },
        }),
      ),
    );
    record(
      "actionSchemaVersion",
      rebuild(resolved, edit({ actionSchemaVersion: 7 })),
    );
  });

  it("initial-state tampering", () => {
    const initial = pkg.initial as unknown as Record<string, unknown>;
    const cards = pkg.initial.cards as unknown as Record<
      string,
      { metadata: object }
    >;
    const [first = ""] = Object.keys(cards);
    const tampered = (over: Record<string, unknown>) =>
      edit({ initial: { ...initial, ...over } });
    record(
      "metadata value",
      rebuild(
        resolved,
        tampered({
          cards: {
            ...cards,
            [first]: { ...cards[first], metadata: { key: SMUGGLED } },
          },
        }),
      ),
    );
    record(
      "metadata type",
      rebuild(
        resolved,
        tampered({
          cards: {
            ...cards,
            [first]: { ...cards[first], metadata: { key: 5 } },
          },
        }),
      ),
    );
    record(
      "counter value",
      rebuild(
        resolved,
        tampered({
          counters: { ...pkg.initial.counters, pot: TAMPER_COUNTER },
        }),
      ),
    );
    record("seq", rebuild(resolved, tampered({ seq: 3 })));
    record(
      "lifecycle",
      rebuild(resolved, tampered({ lifecycle: "completed" })),
    );
  });

  it("log tampering", () => {
    record(
      "gap",
      rebuild(
        resolved,
        edit({
          log: [...pkg.log.slice(0, 3), ...pkg.log.slice(4)],
          digests: [],
        }),
      ),
    );
    record("empty", rebuild(resolved, logWith(5, [])));
    record(
      "macro",
      rebuild(
        resolved,
        logWith(2, [
          ...tx(2).actions,
          A.draw("stock", 1, "trick") as unknown as Action,
        ]),
      ),
    );
    record(
      "unknown kind",
      rebuild(
        resolved,
        logWith(2, [{ kind: "teleport" } as unknown as Action]),
      ),
    );
    record(
      "wrong zone",
      rebuild(resolved, logWith(9, [A.move("north-1", "stock", "trick", 0)])),
    );
    record(
      "secret field type",
      rebuild(resolved, logWith(9, [A.setMetadata("north-1", { key: 123 })])),
    );
    record(
      "secret field value",
      rebuild(
        resolved,
        logWith(9, [A.setMetadata("north-1", { nope: SMUGGLED })]),
      ),
    );
    record(
      "gate payload to unknown gate",
      rebuild(
        resolved,
        logWith(9, [
          engine("gate_submit", {
            gate_id: "nogate",
            seat: "north",
            payload: SMUGGLED,
          }),
        ]),
      ),
    );
    record(
      "gate payload twice after resolve",
      rebuild(
        resolved,
        logWith(12, [
          engine("gate_submit", {
            gate_id: "pass",
            seat: "north",
            payload: SMUGGLED,
          }),
        ]),
      ),
    );
    record(
      "counter bounds",
      rebuild(
        resolved,
        logWith(9, [A.adjust("chips-north", -TAMPER_COUNTER * 10n)]),
      ),
    );
    record(
      "transfer bounds",
      rebuild(
        resolved,
        logWith(9, [A.transfer("chips-north", "pot", TAMPER_COUNTER * 10n)]),
      ),
    );
    record(
      "after completion",
      rebuild(
        resolved,
        edit({
          log: [
            ...pkg.log,
            {
              seq: (pkg.log.length + 1) as Seq,
              eventId: "evt-x",
              principal: "host",
              actions: [A.flip("t1", "face_down")],
            },
          ],
          digests: [],
        }),
      ),
    );
    const flipped = pkg.digests.map((d) =>
      d.seq === 4 ? { ...d, digest: "f".repeat(64) } : d,
    );
    record("digest mismatch", rebuild(resolved, edit({ digests: flipped })));
    record("uptoSeq", rebuild(resolved, pkg, { uptoSeq: pkg.log.length + 1 }));
  });

  it("unbound reducer", () => {
    const def: CompiledGameDefinition = {
      ...session.def,
      metaSchemas: session.def.metaSchemas.map((m) => ({
        id: m.id,
        fields: m.fields,
        reducerRef: m.reducerRef,
        fieldVisibility: m.fieldVisibility,
      })),
    };
    const r = {
      definitionId: computeDefinitionId(definitionContentHash(def)),
      definition: def,
    };
    const bound = {
      ...pkg,
      definition: {
        ...pkg.definition,
        id: r.definitionId,
        contentHash: definitionContentHash(def),
      },
    };
    const withMeta = {
      ...bound,
      log: bound.log.map((t) =>
        t.seq === 3
          ? { ...t, actions: [...t.actions, meta("notes", { text: SMUGGLED })] }
          : t,
      ),
      digests: [],
    };
    record("reducer not bound", rebuild(r, withMeta));
  });

  it("fork errors", () => {
    const id = (v: string) => v as never;
    record(
      "same id",
      forkFromSeq(resolved, pkg, 3, { sessionId: pkg.sessionId }),
    );
    record(
      "bad id",
      forkFromSeq(resolved, pkg, 3, { sessionId: id("bad id!") }),
    );
    record(
      "range",
      forkFromSeq(resolved, pkg, pkg.log.length + 1, { sessionId: id("f-1") }),
    );
    record(
      "fork of a tampered package",
      forkFromSeq(
        resolved,
        logWith(2, [{ kind: "teleport" } as unknown as Action]),
        5,
        { sessionId: id("f-2") },
      ),
    );
  });

  it("raw input: unsupported versions and decode failures", () => {
    const text = Buffer.from(encodePackage(pkg)).toString("utf8");
    const variants: [string, string][] = [
      [
        "version 99",
        text.replace('"actionSchemaVersion":1', '"actionSchemaVersion":99'),
      ],
      [
        "version 0",
        text.replace('"actionSchemaVersion":1', '"actionSchemaVersion":0'),
      ],
      [
        "unknown key",
        text.replace(
          '{"formatVersion":1',
          `{"${SMUGGLED}":1,"formatVersion":1`,
        ),
      ],
      [
        "duplicate key",
        text.replace(
          '"formatVersion":1',
          '"formatVersion":1,"formatVersion":1',
        ),
      ],
      [
        "wrong type",
        text.replace('"eventId":"evt-1"', `"eventId":${SMUGGLED.length}`),
      ],
      ["truncated", text.slice(0, text.length - 40)],
    ];
    for (const [name, body] of variants) {
      expect(body, name).not.toBe(text);
      const bytes = Buffer.from(body, "utf8");
      record(`rebuild ${name}`, rebuild(resolved, new Uint8Array(bytes)));
      // The decoder does not judge versions (the Replayer does); the rest it rejects.
      if (name.startsWith("version")) continue;
      const decoded = decodePackage(new Uint8Array(bytes));
      expect(decoded.ok, `decode ${name}`).toBe(false);
      probes.push({
        name: `decode ${name}`,
        error: decoded.ok ? null : decoded.error,
      });
    }
  });

  it("no probe names a secret of the session or of the tampering", () => {
    expect(probes.length).toBeGreaterThanOrEqual(25);
    // Not vacuous: the secrets are really in the package the errors were produced from.
    const bytes = Buffer.from(encodePackage(pkg)).toString("utf8");
    expect(session.secrets.length).toBeGreaterThan(30);
    expect(
      session.secrets.filter((s) => bytes.includes(s)).length,
    ).toBeGreaterThan(30);
    const secrets = [
      ...session.secrets,
      SMUGGLED,
      TAMPER_COUNTER.toString(),
      (TAMPER_COUNTER * 10n).toString(),
    ];
    for (const p of probes) {
      const text = JSON.stringify(p.error, (_k, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      );
      for (const secret of secrets) {
        // A name the caller supplied itself (the unknown key / game id) is not a leak of data.
        if (
          secret === SMUGGLED &&
          /gameId|unknown key|PACKAGE_UNKNOWN_KEY/.test(`${p.name} ${text}`)
        )
          continue;
        expect(
          text.includes(secret),
          `${p.name}: ${text.slice(0, 200)} names ${secret}`,
        ).toBe(false);
      }
    }
  });
});
