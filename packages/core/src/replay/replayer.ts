import { SUPPORTED_ACTION_SCHEMA_VERSIONS } from "../definition/compile/constants.js";
import { definitionContentHash } from "../definition/identity.js";
import type { CompiledGameDefinition } from "../definition/types.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { Transaction } from "../ports/types.js";
import { validateAction } from "../session/action-validate.js";
import { PRIMITIVE_KINDS } from "../session/actions.js";
import type { Action } from "../session/actions.js";
import { apply } from "../session/apply/index.js";
import { createSession } from "../session/create.js";
import type { SeatId, Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { JsonValue, RosterEntry, SessionState } from "../session/state.js";
import { openBatch } from "../visibility/open-batch.js";
import { sealBatch } from "../visibility/privileged-batch.js";
import type { PrivilegedBatch } from "../visibility/privileged-batch.js";
import { documentToJson, parseDocument } from "./canonical/decode.js";
import type { PackageError } from "./canonical/decode.js";
import { stateDigest } from "./canonical/state-schema.js";
import { decodePackage } from "./package.js";
import type { ReplayPackage } from "./package.js";
import { replayError } from "./replay-error.js";
import type { ReplayError } from "./replay-error.js";
import type { ResolvedDefinition } from "./resolved-definition.js";
import {
  CURRENT_ACTION_SCHEMA_VERSION,
  PACKAGE_UPGRADERS,
  rawActionSchemaVersion,
  upgradeToCurrent,
} from "./upgrade.js";
import type { UpgradePolicy } from "./upgrade.js";
import { encodeUtf8 } from "../util/utf8.js";

/** `current` must be one of `supported`; `upgraders` is the chain applied to raw packages (PFR-053). */
export type ReplayerConfig = UpgradePolicy;

/**
 * A package that has not been decoded yet: its canonical bytes, or its raw JSON as
 * `{raw}`. `rebuild` upgrades it (PFR-051) before decoding it under the current schema; a
 * decoded `ReplayPackage` is taken as already current-shaped (D-038).
 */
export type RawPackage = Uint8Array | { readonly raw: JsonValue };

/** What `onStep` receives after each committed transaction (PFR-047). */
export interface ReplayStep {
  readonly seq: Seq;
  readonly pre: Snapshot<SessionState>;
  readonly post: Snapshot<SessionState>;
  readonly batch: PrivilegedBatch;
  /** Present when it was computed: recorded in the package, or `verify: 'every'`. */
  readonly digest?: string;
}

export interface RebuildOptions {
  /** Stop after this seq (default: the whole log); `0` returns the initial state. */
  readonly uptoSeq?: number;
  /** `recorded` (default) checks the package's digests; `every` digests every seq. */
  readonly verify?: "recorded" | "every";
  /** Called in order after each committed transaction; an error stops the replay with it. */
  readonly onStep?: (step: ReplayStep) => Result<void, ReplayError>;
}

export interface RebuildResult {
  readonly state: Snapshot<SessionState>;
  readonly seq: Seq;
  readonly digest: string;
}

export interface Replayer {
  rebuild(
    resolved: ResolvedDefinition,
    pkg: ReplayPackage | RawPackage,
    opts?: RebuildOptions,
  ): Result<RebuildResult, ReplayError>;
  advance(
    resolved: ResolvedDefinition,
    state: Snapshot<SessionState>,
    batch: PrivilegedBatch,
  ): Result<Snapshot<SessionState>, ReplayError>;
}

const PRIMITIVE_SET: ReadonlySet<string> = new Set(PRIMITIVE_KINDS);

const contentHashes = new WeakMap<CompiledGameDefinition, string>();
function contentHashOf(definition: CompiledGameDefinition): string {
  let hash = contentHashes.get(definition);
  if (hash === undefined) {
    hash = definitionContentHash(definition);
    contentHashes.set(definition, hash);
  }
  return hash;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** PFR-041: package/definition binding, field by field, before any action is applied. */
function checkBinding(
  resolved: ResolvedDefinition,
  pkg: ReplayPackage,
  recordedVersion: number,
  supported: readonly number[],
): ReplayError | null {
  const { definition } = resolved;
  const mismatch = (field: string, expected: string, actual: string) =>
    replayError(
      "REPLAY_MISMATCH",
      0,
      `package does not bind to the resolved definition: ${field} is ${actual}, expected ${expected}`,
      { path: field },
    );
  if (!supported.includes(recordedVersion)) {
    return replayError(
      "REPLAY_MISMATCH",
      0,
      `unsupported action_schema_version ${String(recordedVersion)}: package does not bind to the resolved definition: actionSchemaVersion is ${String(recordedVersion)}`,
      { path: "actionSchemaVersion" },
    );
  }
  if (pkg.definition.id !== resolved.definitionId) {
    return mismatch(
      "definition.id",
      resolved.definitionId,
      String(pkg.definition.id),
    );
  }
  if (pkg.definition.gameId !== definition.gameId) {
    return mismatch(
      "definition.gameId",
      definition.gameId,
      String(pkg.definition.gameId),
    );
  }
  const hash = contentHashOf(definition);
  if (pkg.definition.contentHash !== hash) {
    return mismatch(
      "definition.contentHash",
      hash,
      String(pkg.definition.contentHash),
    );
  }
  if (recordedVersion !== definition.schemaVersion) {
    return mismatch(
      "actionSchemaVersion",
      String(definition.schemaVersion),
      String(recordedVersion),
    );
  }
  return null;
}

/**
 * PFR-042: the initial state must be a fresh session. It is rebuilt with `createSession` from
 * the roster `initial` declares, and `initial` must have the same digest. The rebuilt (deep-frozen,
 * unshared) state is what the replay starts from. A package whose `initial` does not fit the
 * definition's schemas makes `stateDigest` throw; that is reported as `REPLAY_INVALID` at seq 0.
 */
function initialState(
  definition: CompiledGameDefinition,
  pkg: ReplayPackage,
): Result<{ state: Snapshot<SessionState>; digest: string }, ReplayError> {
  const invalid = (detail: string) =>
    err(replayError("REPLAY_INVALID", 0, `initial state: ${detail}`));
  const initial = pkg.initial;
  if (initial.seq !== 0) {
    return invalid(`seq is ${String(initial.seq)}, expected 0`);
  }
  if (initial.lifecycle !== "active") {
    return invalid(
      `lifecycle is ${String(initial.lifecycle)}, expected active`,
    );
  }
  const roster: RosterEntry[] = [];
  const seats = initial.roster.seats as Readonly<
    Record<string, SessionState["roster"]["seats"][SeatId]>
  >;
  for (const id of Object.keys(seats)) {
    const seat = seats[id];
    if (seat === undefined) continue;
    roster.push({
      seat: id as SeatId,
      ...(seat.player !== undefined ? { player: seat.player } : {}),
      ...(seat.team !== undefined ? { team: seat.team } : {}),
    });
  }
  const created = createSession(definition, pkg.sessionId, roster);
  if (!created.ok) {
    return invalid(`${created.error.code}: ${created.error.detail}`);
  }
  let expected: string;
  let actual: string;
  try {
    expected = stateDigest(definition, created.value);
  } catch (error) {
    return invalid(`cannot digest a fresh session: ${describe(error)}`);
  }
  try {
    actual = stateDigest(definition, initial);
  } catch (error) {
    return invalid(`does not fit the definition: ${describe(error)}`);
  }
  if (actual !== expected) {
    return invalid("differs from a fresh session of the definition");
  }
  return ok({ state: created.value, digest: actual });
}

/**
 * One replay step (shared by `rebuild` and `advance`): the transaction is non-empty, every
 * action is a well-formed logged primitive, `apply` accepts the batch without a proposal and
 * the committed state sits at the transaction's seq. No hook, no PRNG, no `Effect` is involved
 * (PFR-044, PFR-045): shuffles carry their logged permutation, reducers are the definition's.
 */
function replayStep(
  definition: CompiledGameDefinition,
  state: Snapshot<SessionState>,
  seq: number,
  actions: readonly Action[],
): Result<Snapshot<SessionState>, ReplayError> {
  const bad = (detail: string, actionIndex?: number) =>
    err(
      replayError(
        "REPLAY_INVALID",
        seq,
        detail,
        actionIndex === undefined ? {} : { actionIndex },
      ),
    );
  if (!Array.isArray(actions) || actions.length === 0) {
    return bad("empty transaction in the log");
  }
  for (let i = 0; i < actions.length; i++) {
    const checked = validateAction(actions[i], `$[${String(i)}]`);
    if (!checked.ok) {
      return bad(`${checked.error.code}: ${checked.error.detail}`, i);
    }
    if (!PRIMITIVE_SET.has(checked.value.kind)) {
      return bad(`action is not a logged primitive: ${checked.value.kind}`, i);
    }
  }
  const applied = apply(definition, state, actions);
  if (!applied.ok) {
    return bad(
      `${applied.error.code}: ${applied.error.detail}`,
      applied.error.actionIndex,
    );
  }
  if (applied.value.state.seq !== seq) {
    return bad(
      `transaction committed no change (state is at seq ${String(applied.value.state.seq)})`,
    );
  }
  return ok(applied.value.state);
}

function validateConfig(cfg: ReplayerConfig): void {
  const { current, supported } = cfg.versions;
  const isVersion = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
  if (!isVersion(current)) {
    throw new RangeError("versions.current must be a positive integer");
  }
  if (!Array.isArray(supported) || !supported.every(isVersion)) {
    throw new RangeError("versions.supported must list positive integers");
  }
  if (new Set(supported).size !== supported.length) {
    throw new RangeError("versions.supported must not repeat a version");
  }
  if (!supported.includes(current)) {
    throw new RangeError("versions.supported must include versions.current");
  }
  if (!Array.isArray(cfg.upgraders)) {
    throw new RangeError("upgraders must be an array");
  }
}

/**
 * Builds a hook-free `Replayer` (PFR-040..049). `cfg.versions` is validated (`current` is one
 * of `supported`; a bad configuration throws `RangeError`, a programmer error). `rebuild` also
 * accepts a raw package (bytes or `{raw}`), which is upgraded before decoding (PFR-051).
 */
export function createReplayer(cfg: ReplayerConfig): Replayer {
  validateConfig(cfg);

  /**
   * Decodes a raw package, running the upgrader chain over its JSON first when its
   * `actionSchemaVersion` is not current (PFR-051). Returns the decoded, current-shaped
   * package and the version it was recorded under (which binds to the definition, D-039).
   */
  function decodeRaw(
    source: RawPackage,
  ): Result<{ pkg: ReplayPackage; recorded: number }, ReplayError> {
    const failed = (errors: readonly PackageError[]) => {
      const first = errors[0];
      const more =
        errors.length > 1 ? ` (+${String(errors.length - 1)} more)` : "";
      return err(
        replayError(
          "REPLAY_INVALID",
          0,
          first === undefined
            ? "package cannot be decoded"
            : `package cannot be decoded: ${first.code} at ${first.path}: ${first.detail}${more}`,
          first === undefined ? {} : { path: first.path },
        ),
      );
    };
    let raw: JsonValue | undefined;
    let bytes: Uint8Array | undefined;
    let version: number | undefined;
    if (source instanceof Uint8Array) {
      bytes = source;
      const parsed = parseDocument(source);
      if (!parsed.ok) return failed(parsed.error);
      const rawVersion =
        parsed.value.root.t === "obj"
          ? parsed.value.root.entries.find(
              (e) => e.key === "actionSchemaVersion",
            )
          : undefined;
      if (
        rawVersion !== undefined &&
        rawVersion.value.t === "num" &&
        Number.isSafeInteger(Number(rawVersion.value.text)) &&
        /^-?(0|[1-9][0-9]*)$/.test(rawVersion.value.text)
      ) {
        version = Number(rawVersion.value.text);
      }
      if (version !== undefined && version !== cfg.versions.current) {
        const json = documentToJson(parsed.value);
        if (!json.ok) return failed(json.error);
        raw = json.value;
      }
    } else {
      raw = source.raw;
      version = rawActionSchemaVersion(raw);
    }
    if (version === undefined || version === cfg.versions.current) {
      if (bytes === undefined) {
        const text = JSON.stringify(raw);
        const encoded = encodeUtf8(text);
        if (!encoded.ok) return failed([]);
        bytes = encoded.value;
      }
      const decoded = decodePackage(bytes);
      if (!decoded.ok) return failed(decoded.error);
      return ok({
        pkg: decoded.value,
        recorded: decoded.value.actionSchemaVersion,
      });
    }
    if (raw === undefined) return failed([]);
    const upgraded = upgradeToCurrent(raw, cfg);
    if (!upgraded.ok) return upgraded;
    const encoded = encodeUtf8(JSON.stringify(upgraded.value));
    if (!encoded.ok) return failed([]);
    const decoded = decodePackage(encoded.value);
    if (!decoded.ok) return failed(decoded.error);
    return ok({ pkg: decoded.value, recorded: version });
  }

  function rebuild(
    resolved: ResolvedDefinition,
    input: ReplayPackage | RawPackage,
    opts: RebuildOptions = {},
  ): Result<RebuildResult, ReplayError> {
    if (input instanceof Uint8Array || "raw" in input) {
      const decoded = decodeRaw(input);
      if (!decoded.ok) return decoded;
      return rebuildDecoded(
        resolved,
        decoded.value.pkg,
        decoded.value.recorded,
        opts,
      );
    }
    return rebuildDecoded(resolved, input, input.actionSchemaVersion, opts);
  }

  function rebuildDecoded(
    resolved: ResolvedDefinition,
    pkg: ReplayPackage,
    recordedVersion: number,
    opts: RebuildOptions,
  ): Result<RebuildResult, ReplayError> {
    const { definition } = resolved;
    const binding = checkBinding(
      resolved,
      pkg,
      recordedVersion,
      cfg.versions.supported,
    );
    if (binding !== null) return err(binding);

    const last = pkg.log.length;
    const upto = opts.uptoSeq ?? last;
    if (!Number.isInteger(upto) || upto < 0 || upto > last) {
      return err(
        replayError(
          "REPLAY_INVALID",
          0,
          `uptoSeq out of range: ${String(upto)} (the log ends at seq ${String(last)})`,
        ),
      );
    }

    const start = initialState(definition, pkg);
    if (!start.ok) return start;

    const recorded = new Map<number, string[]>();
    for (const entry of pkg.digests) {
      if (entry.seq > upto) continue;
      const list = recorded.get(entry.seq);
      if (list === undefined) recorded.set(entry.seq, [entry.digest]);
      else list.push(entry.digest);
    }
    const every = opts.verify === "every";
    const verify = (seq: number, digest: string): ReplayError | null => {
      const wanted = recorded.get(seq);
      if (wanted === undefined || wanted.every((d) => d === digest)) {
        return null;
      }
      return replayError(
        "REPLAY_INVALID",
        seq,
        `digest mismatch at seq ${String(seq)}: computed ${digest}, recorded ${wanted.find((d) => d !== digest) ?? ""}`,
      );
    };

    const initialMismatch = verify(0, start.value.digest);
    if (initialMismatch !== null) return err(initialMismatch);

    let state = start.value.state;
    let digest = start.value.digest;
    for (let i = 0; i < upto; i++) {
      const tx = pkg.log[i];
      const seq = i + 1;
      if (tx === undefined || tx.seq !== seq) {
        return err(
          replayError(
            "REPLAY_INVALID",
            seq,
            `log is not gapless: position ${String(i)} has seq ${String(tx?.seq)}`,
          ),
        );
      }
      const next = replayStep(definition, state, seq, tx.actions);
      if (!next.ok) return next;

      const needed = every || recorded.has(seq) || seq === upto;
      let stepDigest: string | undefined;
      if (needed) {
        try {
          stepDigest = stateDigest(definition, next.value);
        } catch (error) {
          return err(
            replayError(
              "REPLAY_INVALID",
              seq,
              `state cannot be digested: ${describe(error)}`,
            ),
          );
        }
        const mismatch = verify(seq, stepDigest);
        if (mismatch !== null) return err(mismatch);
        digest = stepDigest;
      }

      if (opts.onStep !== undefined) {
        const transaction: Transaction = {
          seq: tx.seq,
          eventId: tx.eventId,
          principal: tx.principal,
          actions: tx.actions,
        };
        const outcome = opts.onStep({
          seq: tx.seq,
          pre: state,
          post: next.value,
          batch: sealBatch(transaction),
          ...(stepDigest !== undefined ? { digest: stepDigest } : {}),
        });
        if (!outcome.ok) return err(outcome.error);
      }
      state = next.value;
    }
    return ok({ state, seq: upto as Seq, digest });
  }

  function advance(
    resolved: ResolvedDefinition,
    state: Snapshot<SessionState>,
    batch: PrivilegedBatch,
  ): Result<Snapshot<SessionState>, ReplayError> {
    const tx = openBatch(batch);
    if (tx.seq === null || tx.seq !== state.seq + 1) {
      return err(
        replayError(
          "REPLAY_INVALID",
          state.seq + 1,
          `batch seq ${String(tx.seq)} does not follow state seq ${String(state.seq)}`,
        ),
      );
    }
    return replayStep(resolved.definition, state, tx.seq, tx.actions);
  }

  return { rebuild, advance };
}

/** The default replayer: the real version policy (PFR-053). */
export const replayer: Replayer = createReplayer({
  versions: {
    current: CURRENT_ACTION_SCHEMA_VERSION,
    supported: SUPPORTED_ACTION_SCHEMA_VERSIONS,
  },
  upgraders: PACKAGE_UPGRADERS,
});

/** `replayer.rebuild`, as a free function. */
export const rebuild: Replayer["rebuild"] = (resolved, pkg, opts) =>
  replayer.rebuild(resolved, pkg, opts);

/** `replayer.advance`, as a free function. */
export const advance: Replayer["advance"] = (resolved, state, batch) =>
  replayer.advance(resolved, state, batch);
