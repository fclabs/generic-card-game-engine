import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDefinition } from "./definition/definition.testing.js";
import { stateDigest } from "./replay/canonical/index.js";
import { A } from "./session/actions.testing.js";
import { apply } from "./session/apply/index.js";
import { startState } from "./session/apply/apply.testing.js";
import { actionsText } from "./session/actions.testing.js";

/**
 * VC-094 (KBR-013): no wall-clock value in `SessionState`, `ApplySuccess` or `ApplyOptions`,
 * and `Effect.timer_request` (`duration_hint`) is never read by `apply`. The checker works
 * on source text, so the fixture test can show it fails when a timestamp field is added.
 */

const SRC = new URL("./", import.meta.url).pathname;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const TIMESTAMP_NAME =
  /(?:committed|created|updated|published|received|sent|expires|expired|started|ended)_?at$|timestamp|wall_?clock|epoch_?ms|^(?:now|time|date)$/i;
const TIMESTAMP_TYPE = /\bDate\b/;

interface Field {
  readonly name: string;
  readonly type: string;
}

/** Top-level fields of `interface <name> { ... }` (nested object types are skipped). */
function interfaceFields(source: string, name: string): Field[] | undefined {
  const text = stripComments(source);
  const start = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(text);
  if (start === null) return undefined;
  let depth = 1;
  let i = start.index + start[0].length;
  const begin = i;
  while (i < text.length && depth > 0) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
    i += 1;
  }
  const body = text.slice(begin, i - 1);
  const fields: Field[] = [];
  let level = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{" || ch === "<" || ch === "(" || ch === "[") level += 1;
    if (ch === "}" || ch === ">" || ch === ")" || ch === "]") level -= 1;
    if ((ch === ";" || ch === "\n") && level === 0) {
      push(current);
      current = "";
    } else current += ch;
  }
  push(current);
  return fields;

  function push(raw: string): void {
    const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([\s\S]*)$/.exec(
      raw,
    );
    if (m?.[1] !== undefined) {
      fields.push({ name: m[1], type: (m[2] ?? "").trim() });
    }
  }
}

/** Problems for the named interfaces in `source`: missing interface or a timestamp-like field. */
function timestampProblems(source: string, names: readonly string[]): string[] {
  const problems: string[] = [];
  for (const name of names) {
    const fields = interfaceFields(source, name);
    if (fields === undefined) {
      problems.push(`interface ${name} not found`);
      continue;
    }
    for (const f of fields) {
      if (TIMESTAMP_NAME.test(f.name) || TIMESTAMP_TYPE.test(f.type)) {
        problems.push(`${name}.${f.name}: ${f.type}`);
      }
    }
  }
  return problems;
}

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("VC-094 no wall-clock value in the kernel state or apply inputs and outputs", () => {
  it("SessionState, ApplySuccess and ApplyOptions declare no timestamp field", () => {
    expect(
      timestampProblems(read("session/state.ts"), ["SessionState"]),
    ).toEqual([]);
    expect(
      timestampProblems(read("session/apply/types.ts"), [
        "ApplySuccess",
        "ApplyOptions",
        "ProposalDescriptor",
      ]),
    ).toEqual([]);
    // The checker really parses the interfaces (a few known fields are seen).
    expect(
      interfaceFields(read("session/state.ts"), "SessionState")?.map(
        (f) => f.name,
      ),
    ).toEqual(
      expect.arrayContaining(["id", "lifecycle", "seq", "cards", "outcome"]),
    );
    expect(
      interfaceFields(read("session/apply/types.ts"), "ApplySuccess")?.map(
        (f) => f.name,
      ),
    ).toEqual(["state", "committed", "notifications"]);
  });

  it("no field or identifier named committed_at / committedAt exists in any non-test source", () => {
    const offenders = sources(SRC).filter((f) =>
      /committed_?at/i.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the port payload types carry no timestamp either (D-034)", () => {
    expect(
      timestampProblems(read("ports/types.ts"), [
        "Transaction",
        "Receipt",
        "OutboxRow",
        "Lease",
        "StoredSession",
        "SessionSummary",
        "CommittedTransaction",
      ]),
    ).toEqual([]);
  });

  it("fixtures that add a timestamp field make the checker fail", () => {
    const dir = mkdtempSync(join(tmpdir(), "cge-timestamp-"));
    try {
      const state = read("session/state.ts").replace(
        /(export interface SessionState \{)/,
        "$1\n  readonly committedAt: number;",
      );
      const types = read("session/apply/types.ts")
        .replace(
          /(export interface ApplySuccess \{)/,
          "$1\n  readonly committed_at: string;",
        )
        .replace(
          /(export interface ApplyOptions \{)/,
          "$1\n  readonly now: Date;",
        );
      writeFileSync(join(dir, "state.ts"), state);
      writeFileSync(join(dir, "types.ts"), types);
      expect(
        timestampProblems(readFileSync(join(dir, "state.ts"), "utf8"), [
          "SessionState",
        ]),
      ).toEqual(["SessionState.committedAt: number"]);
      expect(
        timestampProblems(readFileSync(join(dir, "types.ts"), "utf8"), [
          "ApplySuccess",
          "ApplyOptions",
        ]),
      ).toEqual([
        "ApplySuccess.committed_at: string",
        "ApplyOptions.now: Date",
      ]);
      // A field typed Date under an innocent name is caught by its type.
      expect(
        timestampProblems("interface X { readonly when: Date }", ["X"]),
      ).toEqual(["X.when: Date"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session and replay never mention Effect, timer_request or duration_hint", () => {
    const offenders = [
      ...sources(join(SRC, "session")),
      ...sources(join(SRC, "replay")),
    ]
      .filter((f) =>
        /\b(?:Effect|timer_request|duration_hint)\b/.test(
          stripComments(readFileSync(f, "utf8")),
        ),
      )
      .map((f) => f.slice(SRC.length));
    expect(offenders).toEqual([]);
  });

  it("apply never reads an Effect: a throwing `effects` option changes nothing", () => {
    const def = buildDefinition();
    const state = startState(def);
    const batch = [A.move("c1", "deck", "table"), A.flip("c1", "face_up")];
    const plain = apply(def, state, batch);
    const opts = {};
    for (const key of ["effects", "timer_request", "duration_hint"]) {
      Object.defineProperty(opts, key, {
        enumerable: true,
        get(): never {
          throw new Error(`${key} was read`);
        },
      });
    }
    const withEffects = apply(def, state, batch, opts);
    expect(plain.ok).toBe(true);
    expect(withEffects.ok).toBe(true);
    if (plain.ok && withEffects.ok) {
      expect(actionsText(withEffects.value.committed)).toBe(
        actionsText(plain.value.committed),
      );
      expect(stateDigest(def, withEffects.value.state)).toBe(
        stateDigest(def, plain.value.state),
      );
    }
  });
});
