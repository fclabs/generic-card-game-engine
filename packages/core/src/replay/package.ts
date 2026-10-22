import { definitionContentHash } from "../definition/identity.js";
import { ERROR_CODES } from "../errors/codes.js";
import { err, ok } from "../errors/result.js";
import type { Result } from "../errors/result.js";
import type { Receipt, StoredSession } from "../ports/types.js";
import { apply } from "../session/apply/index.js";
import type { Action } from "../session/actions.js";
import { PRIMITIVE_KINDS } from "../session/actions.js";
import type { DefinitionId, SessionId, Seq } from "../session/ids.js";
import type { Snapshot } from "../session/snapshot.js";
import type { JsonValue, SessionState } from "../session/state.js";
import { canonicalize } from "./canonical/canonicalize.js";
import {
  decodeDocument,
  MAX_DECODE_ERRORS,
  parseDocument,
  rootMember,
} from "./canonical/decode.js";
import type { PackageError } from "./canonical/decode.js";
import { stateDigest } from "./canonical/state-schema.js";
import { replayPackageSchema } from "./package-schema.js";
import { replayError } from "./replay-error.js";
import type { ReplayError } from "./replay-error.js";
import type { ResolvedDefinition } from "./resolved-definition.js";

export type { PackageError, PackageErrorCode } from "./canonical/decode.js";

/** The only package format version this engine writes and reads. */
export const REPLAY_PACKAGE_FORMAT_VERSION = 1;

/** Default `maxBytes` of {@link decodePackage}: 64 MiB. */
export const DEFAULT_MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

/** One logged transaction of a package: `seq` is never `null` (empty batches are not logged). */
export interface PackageTransaction {
  readonly seq: Seq;
  readonly eventId: string;
  readonly principal: string;
  readonly actions: readonly Action[];
}

/** One idempotency receipt with its key (the session id is the package's). */
export interface PackageReceipt {
  readonly principal: string;
  readonly eventId: string;
  readonly receipt: Receipt;
}

/**
 * A replay package, format v1 (spec PFR-033, §7.4): canonical JSON, field order as declared.
 * Contains no wall-clock value. `initial` is the full state at `seq` 0.
 */
export interface ReplayPackage {
  readonly formatVersion: 1;
  readonly sessionId: SessionId;
  readonly definition: {
    readonly id: DefinitionId;
    readonly gameId: string;
    readonly contentHash: string;
  };
  readonly actionSchemaVersion: number;
  readonly initial: Snapshot<SessionState>;
  readonly params: JsonValue;
  readonly log: readonly PackageTransaction[];
  /** Sorted by principal, then eventId, in UTF-16 code-unit order. */
  readonly receipts: readonly PackageReceipt[];
  readonly digests: readonly { readonly seq: Seq; readonly digest: string }[];
  readonly forkedFrom?: { readonly sessionId: SessionId; readonly seq: Seq };
}

/**
 * Canonical UTF-8 bytes of `pkg` (PFR-034): byte-identical for the same package on every run,
 * process and platform. Throws `CanonicalError` (with a path) for a value that is not a valid
 * package (programmer error, like `canonicalize`).
 */
export function encodePackage(pkg: ReplayPackage): Uint8Array {
  return canonicalize(replayPackageSchema, pkg);
}

export interface DecodePackageOptions {
  /** Inputs longer than this are rejected before parsing. Default {@link DEFAULT_MAX_PACKAGE_BYTES}. */
  readonly maxBytes?: number;
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** Receipt fields the schema leaves as `json` (nullable) are checked here. */
function receiptErrors(pkg: ReplayPackage, room: number): PackageError[] {
  const out: PackageError[] = [];
  pkg.receipts.forEach((entry, i) => {
    if (out.length >= room) return;
    const base = `$.receipts[${String(i)}].receipt`;
    const r = entry.receipt as unknown as Record<string, unknown>;
    const code = r["errorCode"];
    if (
      code !== null &&
      !(typeof code === "string" && ERROR_CODE_SET.has(code))
    ) {
      out.push({
        code: "PACKAGE_SCHEMA",
        path: `${base}.errorCode`,
        detail: "expected null or an engine error code",
      });
    }
    const seq = r["seq"];
    if (seq !== null && !(typeof seq === "number" && seq >= 0)) {
      out.push({
        code: "PACKAGE_SCHEMA",
        path: `${base}.seq`,
        detail: "expected null or a non-negative integer",
      });
    }
  });
  return out;
}

/**
 * Parses a package (PFR-036). Tolerant of formatting (any whitespace, any key order), strict
 * about content: input over `maxBytes`, invalid JSON, duplicate or unknown keys, missing keys,
 * wrong types, non-integer or unsafe numbers, `bigint` not given as a decimal string, a
 * `formatVersion` other than 1 and a `log` whose `seq` values are not exactly `1..n` are
 * rejected with path-bearing errors (up to 100, in document order). No definition is needed:
 * the package schema is definition-independent (D-026).
 */
export function decodePackage(
  bytes: Uint8Array,
  opts: DecodePackageOptions = {},
): Result<ReplayPackage, readonly PackageError[]> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_PACKAGE_BYTES;
  if (bytes.length > maxBytes) {
    return err([
      {
        code: "PACKAGE_TOO_LARGE",
        path: "$",
        detail: `${String(bytes.length)} bytes exceed the limit of ${String(maxBytes)}`,
      },
    ]);
  }
  const parsed = parseDocument(bytes);
  if (!parsed.ok) return parsed;
  const version = rootMember(parsed.value, "formatVersion");
  if (
    version !== undefined &&
    version.kind === "int" &&
    version.value !== REPLAY_PACKAGE_FORMAT_VERSION
  ) {
    return err([
      {
        code: "PACKAGE_FORMAT_VERSION",
        path: "$.formatVersion",
        detail: `unsupported formatVersion ${String(version.value)} (this engine reads ${String(REPLAY_PACKAGE_FORMAT_VERSION)})`,
      },
    ]);
  }
  const decoded = decodeDocument(replayPackageSchema, parsed.value);
  if (!decoded.ok) return decoded;
  const pkg = decoded.value as ReplayPackage;
  const errors: PackageError[] = [];
  for (let i = 0; i < pkg.log.length; i++) {
    const entry = pkg.log[i];
    if (entry !== undefined && entry.seq !== i + 1) {
      errors.push({
        code: "PACKAGE_LOG_GAP",
        path: `$.log[${String(i)}].seq`,
        detail: `expected seq ${String(i + 1)}, got ${String(entry.seq)}`,
      });
      break;
    }
  }
  errors.push(...receiptErrors(pkg, MAX_DECODE_ERRORS - errors.length));
  return errors.length > 0 ? err(errors) : ok(pkg);
}

export interface BuildPackageOptions {
  /**
   * The definition the session runs on (binding, `gameId` and digest computation). Required:
   * a `StoredSession` carries no game id and a digest needs the definition's schemas (D-027).
   */
  readonly resolved: ResolvedDefinition;
  /** `none` (default), the `final` seq only, or `every` seq `1..n`. */
  readonly digests?: "none" | "final" | "every";
  /** Deterministic setup parameters (a `json` value). Default `{}`. */
  readonly params?: JsonValue;
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Assembles a package from a stored session and the ledger's receipts (PFR-038). Receipts are
 * sorted by principal, then eventId (UTF-16 order); `digests` are `stateDigest`s of the states
 * produced by folding the log through `apply` (hook-free, no proposal). The stored log must
 * be gapless `1..seq`, bind to `opts.resolved` and replay without error.
 */
export function buildPackage(
  stored: StoredSession,
  receipts: readonly PackageReceipt[],
  opts: BuildPackageOptions,
): Result<ReplayPackage, ReplayError> {
  const { definitionId, definition } = opts.resolved;
  const mismatch = (field: string) =>
    err(
      replayError(
        "REPLAY_MISMATCH",
        0,
        `stored session does not match the resolved definition: ${field}`,
        { path: field },
      ),
    );
  if (stored.definitionId !== definitionId) return mismatch("definition.id");
  if (stored.definitionHash !== definitionContentHash(definition)) {
    return mismatch("definition.contentHash");
  }
  if (stored.schemaVersion !== definition.schemaVersion) {
    return mismatch("actionSchemaVersion");
  }

  const log: PackageTransaction[] = [];
  for (let i = 0; i < stored.log.length; i++) {
    const tx = stored.log[i];
    if (tx === undefined) continue;
    if (tx.seq !== i + 1) {
      return err(
        replayError(
          "REPLAY_INVALID",
          i + 1,
          `stored log is not gapless: position ${String(i)} has seq ${String(tx.seq)}`,
        ),
      );
    }
    if (tx.actions.length === 0) {
      return err(
        replayError("REPLAY_INVALID", i + 1, "empty transaction in the log"),
      );
    }
    log.push({
      seq: tx.seq,
      eventId: tx.eventId,
      principal: tx.principal,
      actions: tx.actions,
    });
  }
  if (stored.seq !== log.length) {
    return err(
      replayError(
        "REPLAY_INVALID",
        log.length,
        `stored session seq ${String(stored.seq)} differs from its log length ${String(log.length)}`,
      ),
    );
  }

  const sorted = [...receipts].sort(
    (a, b) =>
      compareUtf16(a.principal, b.principal) ||
      compareUtf16(a.eventId, b.eventId),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (
      prev !== undefined &&
      cur !== undefined &&
      prev.principal === cur.principal &&
      prev.eventId === cur.eventId
    ) {
      return err(
        replayError("REPLAY_INVALID", 0, "duplicate receipt key", {
          path: `receipts[${String(i)}]`,
        }),
      );
    }
  }

  const mode = opts.digests ?? "none";
  const digests: { seq: Seq; digest: string }[] = [];
  if (mode !== "none" && log.length > 0) {
    let state: Snapshot<SessionState> = stored.initial;
    for (const tx of log) {
      for (let a = 0; a < tx.actions.length; a++) {
        const action = tx.actions[a];
        if (
          action === undefined ||
          !(PRIMITIVE_KINDS as readonly string[]).includes(action.kind)
        ) {
          return err(
            replayError(
              "REPLAY_INVALID",
              tx.seq,
              `action is not a logged primitive: ${String(action?.kind)}`,
              { actionIndex: a },
            ),
          );
        }
      }
      const applied = apply(definition, state, tx.actions);
      if (!applied.ok) {
        return err(
          replayError(
            "REPLAY_INVALID",
            tx.seq,
            `${applied.error.code}: ${applied.error.detail}`,
            applied.error.actionIndex === undefined
              ? {}
              : { actionIndex: applied.error.actionIndex },
          ),
        );
      }
      state = applied.value.state;
      if (mode === "every" || tx.seq === log.length) {
        digests.push({ seq: tx.seq, digest: stateDigest(definition, state) });
      }
    }
  }

  return ok({
    formatVersion: REPLAY_PACKAGE_FORMAT_VERSION,
    sessionId: stored.sessionId,
    definition: {
      id: definitionId,
      gameId: definition.gameId,
      contentHash: stored.definitionHash,
    },
    actionSchemaVersion: stored.schemaVersion,
    initial: stored.initial,
    params: opts.params ?? {},
    log,
    receipts: sorted,
    digests,
  });
}
