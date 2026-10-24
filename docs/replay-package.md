# Replay packages, replay and fork

A **replay package** is a self-contained, language-agnostic record of one session: the definition it ran on, the state it started from, every committed transaction and the idempotency receipts. From it the engine rebuilds exactly the state the live session had, at any point, and can verify that against recorded `StateDigest`s. The same package is the archive format, the export format, the migration format between hosts and the input to forking.

Replay never executes game code. Hook outputs are already in the log as ordinary actions; the replayer applies the logged primitives with the definition's reducers and never calls, imports or receives a hook. It never re-randomises: a `shuffle` is applied with the permutation it logged.

The functions are in `packages/core/src/replay` and exported from `@cge/core`. The byte format underneath is the canonical JSON profile ([canonical-json-profile.md](./canonical-json-profile.md)); the read-side counterpart of the log, role-filtered deltas, is described in [visibility.md](./visibility.md).

## Contents

- [The format, field by field](#the-format-field-by-field)
- [Writing and reading](#writing-and-reading)
- [Replaying](#replaying)
- [Forking](#forking)
- [The edge path: `advance`](#the-edge-path-advance)
- [Errors](#errors)
- [Digests](#digests)
- [Version policy](#version-policy)
- [Adding a schema version and an upgrader](#adding-a-schema-version-and-an-upgrader)
- [Limits](#limits)
- [Verifying it yourself](#verifying-it-yourself)

## The format, field by field

A package is canonical JSON: UTF-8, no whitespace, keys in the order below, no wall-clock value anywhere. The current format version is `1` (`REPLAY_PACKAGE_FORMAT_VERSION`).

| # | Field | Content |
|---|-------|---------|
| 1 | `formatVersion` | Always `1`. Any other integer is `PACKAGE_FORMAT_VERSION` |
| 2 | `sessionId` | The session's id (letters, digits and `_ . : / -`, 1 to 128 characters) |
| 3 | `definition` | `{id, gameId, contentHash}`: the `DefinitionId` the log was produced on (`sha256:` plus 64 hex characters), the game id and the definition's content hash |
| 4 | `actionSchemaVersion` | The action-schema version the log was recorded under (see [Version policy](#version-policy)) |
| 5 | `initial` | The complete `SessionState` at `seq` 0: id, lifecycle, every card, every zone, counters, meta, roster, control, gates, delegations, grants. No `derivedCounters` (computed, never stored) |
| 6 | `params` | Deterministic setup parameters as a JSON value (for example the seed and options the host used to set the session up). Not interpreted by the replayer |
| 7 | `log` | Ordered transactions `{seq, eventId, principal, actions}`; `seq` runs exactly `1..n`, each transaction holds the **committed primitive** actions (never a macro) |
| 8 | `receipts` | Every idempotency receipt as `{principal, eventId, receipt}`, sorted by principal then event id in UTF-16 order. `receipt` is `{fingerprint, result, errorCode, seq, detail, privileged}` |
| 9 | `digests` | `[{seq, digest}]`: recorded `StateDigest`s, possibly empty |
| 10 | `forkedFrom` | Optional `{sessionId, seq}`: present only in a package made by `forkFromSeq` |

Encoding rules that matter to another implementation:

- **Id-keyed records are arrays of `[key, value]` pairs**, sorted by key in UTF-16 code-unit order (`cards`, `zones`, `counters`, `meta`, `roster.seats`, `control.pointers`, gates, `grants` inside `initial`). A package never contains a JSON object used as a map in these places. Plain objects (`definition`, an action, a receipt) have their keys in the schema's order.
- **Counters and amounts are decimal strings** (`"100"`, `"-3"`, `"1000000000000000000000000000000"`), never JSON numbers. `counters` values, `counter_adjust.delta`, `counter_transfer.amount` and the `ratio` terms are strings.
- **Integers are safe-range JSON numbers** (`seq`, positions, `direction`). Floats, exponents, `-0` and integers above 2^53 - 1 are rejected.
- **An action** is one object: `kind` first, then the payload fields it uses, sorted by name, every other field absent. For example `{"kind":"move","card_id":"c1","from_zone":"deck","to_zone":"hold"}`.
- **`json` values** (card metadata, meta partitions, sealed gate submissions, grant targets and scopes, outcomes, `params`, receipt `result`/`detail`) have their object keys sorted at every level.
- **The package is definition-independent in shape**: it can be decoded without the definition. Whether `initial` and the log fit the definition is the replayer's check.

A (shortened) package, written out with whitespace added for reading; the real bytes have none:

```json
{
  "formatVersion": 1,
  "sessionId": "golden-pkg-1",
  "definition": { "id": "sha256:3d41...4a9b", "gameId": "test", "contentHash": "b8fa...cdb4" },
  "actionSchemaVersion": 1,
  "initial": {
    "id": "golden-pkg-1", "lifecycle": "active", "seq": 0,
    "cards": [["c1", { "zone": "deck", "orientation": "face_down", "metadata": {} }], "..."],
    "zones": [["deck", { "members": ["c1", "c2", "..."] }], "..."],
    "counters": [["bank", "100"], ["pot", "0"], "..."],
    "roster": { "seats": [["s1", { "status": "seated", "player": "p1", "team": "t1" }], "..."] },
    "...": "..."
  },
  "params": { "game": "property", "seed": "golden-seed-1" },
  "log": [
    { "seq": 1, "eventId": "evt-01", "principal": "host",
      "actions": [{ "kind": "move", "card_id": "c1", "from_zone": "deck", "to_zone": "hold" }, "..."] },
    "..."
  ],
  "receipts": [
    { "principal": "alice", "eventId": "evt-02",
      "receipt": { "fingerprint": "aa0b...2472", "result": { "seq": 2 }, "errorCode": null,
                   "seq": 2, "detail": null, "privileged": false } },
    "..."
  ],
  "digests": [{ "seq": 1, "digest": "59e2...a8da" }, "..."]
}
```

The committed example `packages/core/src/replay/golden-package.json` is a 12-transaction package that exercises every primitive action kind, grants, a gate and a shuffle; it is the byte-for-byte reference for the format.

**Privileged.** A package contains the raw log: principal ids, event ids, every hidden card and every sealed submission. It is for operators, never for a viewer. What a viewer may see of the same log is a `Delta` ([visibility.md](./visibility.md)).

## Writing and reading

`encodePackage(pkg)` returns the canonical bytes: the same package gives byte-identical output on every run, process and platform. It throws `CanonicalError` (with a path) for a value that is not a valid package, which is a programmer error.

`decodePackage(bytes, opts?)` returns `Result<ReplayPackage, readonly PackageError[]>` and never throws. It is **tolerant of formatting**: any whitespace and any key order (and any order of an id-keyed record's pairs) are accepted, so a package that was pretty-printed or reordered by another tool decodes to the same value and re-encodes to the canonical bytes. It is **strict about content**: duplicate keys, unknown keys, missing keys, wrong types, non-integer or unsafe numbers, a `bigint` not written as a decimal string, lone surrogates and a `log` whose `seq` values are not exactly `1..n` are all rejected, with a `path` for each. It reports up to 100 errors, in document order. The default `maxBytes` is 64 MiB (`DEFAULT_MAX_PACKAGE_BYTES`).

`decode(encode(pkg))` deep-equals `pkg`, and `encode(decode(bytes))` equals `bytes` for canonical `bytes`.

`decodeCanonical(schema, bytes)` is the general inverse of `canonicalize` that `decodePackage` is built on: a hand-written tokenizer (not `JSON.parse`, which keeps the last of two duplicate keys and rounds integers beyond 2^53) that rebuilds `bigint` from decimal strings. It is part of the canonical module; see [canonical-json-profile.md](./canonical-json-profile.md).

`buildPackage(stored, receipts, opts)` assembles a package from a `StoredSession` (the persistence port's type) and the ledger's receipts:

| `opts` | Meaning |
|--------|---------|
| `resolved` (required) | The `ResolvedDefinition` `{definitionId, definition}` the session runs on. A `StoredSession` carries no game id and digests need the definition |
| `digests` | `"none"` (default), `"final"` (the last seq only) or `"every"` (seq `1..n`) |
| `params` | The setup parameters to record; default `{}` |

It sorts the receipts, checks the stored session against `resolved` (`REPLAY_MISMATCH` naming the field), checks the log is gapless and non-empty per transaction, and when digests are requested folds the log through `apply` to compute them. It never sets `forkedFrom`.

```ts
import { buildPackage, decodePackage, encodePackage } from "@cge/core";

// stored: StoredSession from SessionStore.load; receipts: PackageReceipt[] from the ledger;
// resolved: { definitionId, definition } from DefinitionRegistry.resolve
const built = buildPackage(stored, receipts, {
  resolved,
  digests: "every",
  params: { seed: "golden-seed-1", game: "property" },
});
if (!built.ok) throw new Error(`${built.error.code}: ${built.error.detail}`);

const bytes = encodePackage(built.value); // Uint8Array, canonical

// elsewhere, on any host
const decoded = decodePackage(bytes);
if (!decoded.ok) {
  for (const e of decoded.error) console.error(e.code, e.path, e.detail);
}
```

Decoding returns a value; writing it into a store and resuming a writer is the application layer's job.

## Replaying

`rebuild(resolved, pkg, opts?)` folds the log through `apply` (with no proposal: turn and authorization checks are not re-run) from the package's initial state and returns `{state, seq, digest}`: the committed, deep-frozen state, its `seq` and its `stateDigest`. `pkg` may be a decoded `ReplayPackage`, the canonical bytes (`Uint8Array`) or `{raw: JsonValue}`; the last two go through the version upgrade chain first (see [Version policy](#version-policy)).

```ts
import { rebuild } from "@cge/core";

const full = rebuild(resolved, decoded.value);             // whole log; recorded digests are verified
// { ok: true, value: { state, seq: 12, digest: "7d63...3b74" } }

const upto = rebuild(resolved, bytes, { uptoSeq: 6 });     // the state after seq 6, straight from bytes

const steps: number[] = [];
rebuild(resolved, decoded.value, {
  verify: "every",                                          // compute and report a digest at every seq
  onStep: (s) => { steps.push(s.seq); return { ok: true, value: undefined }; },
});
```

| Option | Meaning |
|--------|---------|
| `uptoSeq` | Stop after this seq. Default: the whole log. `0` returns the initial state. A value above the last seq, negative or non-integer is `REPLAY_INVALID` (`uptoSeq out of range`) |
| `verify` | `"recorded"` (default): check the package's `digests` up to `uptoSeq`. `"every"`: also compute a digest at every seq and pass it to `onStep` |
| `onStep` | Called after each committed transaction, in order, with `{seq, pre, post, batch, digest?}`; `batch` is a `PrivilegedBatch`. Returning an error stops the replay with that exact error |

`rebuild` checks, in this order, before applying any action: **binding** (the package's `definition.id`, `definition.gameId`, `definition.contentHash` and `actionSchemaVersion` against the resolved definition; each mismatch is `REPLAY_MISMATCH` naming the field), the `uptoSeq` range, the **initial state** (seq 0, lifecycle `active`, and a digest equal to that of a fresh session of the definition built from the initial roster), then the fold. The fold checks that every transaction is non-empty and gapless, that every action is a logged primitive (a macro, an unknown kind or a malformed action is rejected), and that `apply` accepts it. A reducer the definition does not bind is `REPLAY_INVALID` with `reducer not bound: <ref>`; an action is never skipped. A replay starts from a freshly built initial state, so the package value is never frozen or mutated.

The two replay properties the engine tests exhaustively: the live digest equals the replay digest at every seq (over randomised sessions with shuffles, grants, gates, zone creation and lifecycle changes), and a package replays to the same digests whether it was kept as a value or went through `encodePackage` and `decodePackage`.

## Forking

`forkFromSeq(resolved, pkg, n, {sessionId}, replayer?)` makes a new session from the first `n` transactions of a package:

```ts
import { forkFromSeq } from "@cge/core";

const fork = forkFromSeq(resolved, decoded.value, 6, { sessionId: "sess-fork-1" });
if (fork.ok) {
  fork.value.package; // log 1..6, receipts [], digests truncated to <= 6,
                      // forkedFrom {sessionId: "golden-pkg-1", seq: 6}
  fork.value.state;   // the state at seq 6, with id "sess-fork-1"
}
```

The fork package has the same `initial` (re-keyed to the new id), `params` and definition binding, `log` and `digests` cut to `seq <= n`, `receipts: []` and `forkedFrom` set to the immediate parent. `n` runs `0..lastSeq`; `0` forks at the initial state and `lastSeq` copies the whole log under a new id. The fork is verified by replaying it, so a source package whose digests up to `n` do not hold fails with the replayer's error; tampering after `n` does not block it.

The result is deep-frozen and shares no object with the source, which is never touched. The fork's state digest at `n` equals the original's at `n`, because a digest excludes the session id; the fork then continues independently: applying a transaction at `n + 1` on the fork does not affect the original. A fork of a fork records its immediate parent. The new `sessionId` must be a valid session id and different from the source's (`REPLAY_INVALID`: `invalid session id`, `same session id`); `n` out of range is `REPLAY_INVALID` (`fork seq out of range: n (the log ends at seq L)`). `forkFromSeq` takes a decoded package; decode (and, for an old package, upgrade) first. Whether a caller is allowed to fork a session at all is a host policy, outside this function.

## The edge path: `advance`

An edge cache does not replay from the start: it holds a state and folds new transactions onto it. `advance(resolved, state, batch)` is exactly one step of `rebuild`: it opens a `PrivilegedBatch`, requires `batch.seq === state.seq + 1` (`REPLAY_INVALID` otherwise), and applies its actions hook-free. Folding the batches that `rebuild` reports through `onStep` over the initial state with `advance` gives the same state and digest at every seq. The batches are the same `PrivilegedBatch` values the projector takes, so a node that holds only the log can produce exactly the same `View` and `Delta` as the node that committed them ([visibility.md](./visibility.md)). `advance` does not check the definition binding (there is no package).

`createReplayer({versions, upgraders})` builds a replayer with an injected version set and upgrade chain (used to test a chain before a second version exists); the exported `replayer`, `rebuild` and `advance` are the default instance wired to the real constants. `createReplayer` throws `RangeError` if `current` is not a positive integer in `supported`, if `supported` has duplicates or if `upgraders` is not an array; it does not validate the chain (use `assertUpgraderChain`).

## Errors

### Package errors

`decodePackage` and `decodeCanonical` return `PackageError {code, path, detail}`. The `path` uses the canonicalize notation (`$.log[3].eventId`, `$.initial.counters["bank"]`); a syntax error's `path` names the container being read and its `detail` ends with `at offset N`. Package error codes are distinct from engine error codes.

| Code | Meaning |
|------|---------|
| `PACKAGE_TOO_LARGE` | The input is longer than `maxBytes` (default 64 MiB), checked before parsing |
| `PACKAGE_SYNTAX` | Not valid JSON or not valid UTF-8: truncated or empty input, a lone surrogate, nesting deeper than 256 levels |
| `PACKAGE_DUPLICATE_KEY` | An object has the same key twice (`JSON.parse` would silently keep the last) |
| `PACKAGE_UNKNOWN_KEY` | A key the schema does not declare |
| `PACKAGE_SCHEMA` | A missing required key, a wrong type, a float, an exponent, `-0`, an unsafe integer, a `bigint` that is not a decimal string, a receipt `errorCode` that is not null or an engine error code |
| `PACKAGE_FORMAT_VERSION` | `formatVersion` is an integer other than 1; reported alone, before the rest of the schema is read |
| `PACKAGE_LOG_GAP` | `log` `seq` values are not exactly `1..n` (the first violation is reported) |

### Replay errors

`rebuild`, `advance`, `forkFromSeq` and `buildPackage` return `ReplayError`, an `EngineError {code, detail, path?, actionIndex?}` with the `seq` it concerns (`0` for binding and initial-state problems). The `detail` is operator-facing: it names card, zone and counter ids but never hidden metadata, counter values or sealed payloads.

| Code | Typical `detail` | When |
|------|------------------|------|
| `REPLAY_MISMATCH` | `package does not bind to the resolved definition: definition.contentHash is ..., expected ...` (`path` is the field: `definition.id`, `definition.gameId`, `definition.contentHash`, `actionSchemaVersion`) | The package belongs to another definition or schema version |
| `REPLAY_MISMATCH` | `unsupported action_schema_version 7` | The recorded version is not supported, or no upgrade path exists |
| `REPLAY_INVALID` | `initial state: seq is 3, expected 0` / `lifecycle is completed, expected active` / `differs from a fresh session of the definition` / `does not fit the definition: ...` | The initial state is wrong |
| `REPLAY_INVALID` | `uptoSeq out of range: 13 (the log ends at seq 12)` | Bad `uptoSeq` |
| `REPLAY_INVALID` | `CARD_NOT_IN_ZONE: ...` with `seq` and `actionIndex` | An action of the log is rejected by `apply`; the engine code and detail follow |
| `REPLAY_INVALID` | `empty transaction in the log`, `action is not a logged primitive: draw`, `reducer not bound: <ref>`, `log is not gapless: ...` | Log integrity |
| `REPLAY_INVALID` | `digest mismatch at seq 4: computed ..., recorded ...` | A recorded digest does not match the replayed state |
| `REPLAY_INVALID` | `batch seq 5 does not follow state seq 3` | `advance` on a batch that is not the next one |
| `REPLAY_INVALID` | `package cannot be decoded: PACKAGE_SCHEMA at $.initial: ...` | Raw bytes given to `rebuild` failed to decode |
| `REPLAY_INVALID` | the upgrader's own message, at seq 0 | An upgrader returned an error, threw or returned a non-object |
| `REPLAY_INVALID` | `invalid session id`, `same session id`, `fork seq out of range: ...` | Fork arguments |

A real digest failure, from a package whose fourth recorded digest was changed:

```
REPLAY_INVALID (seq 4): digest mismatch at seq 4: computed 3b32...eb72, recorded 0000...0000
```

## Digests

A digest is the `StateDigest` (lower-case hex SHA-256 of the canonical state bytes) of the state after a seq; the digest of seq 0 is that of the initial state. The digest covers the whole logical state, including derived counters, and **excludes the session id**: a fork and its original share a digest at every common seq, and two states with equal content have equal digests however they were built.

`digests` in a package are optional (`buildPackage`'s `none`, `final`, `every`). `rebuild` verifies the recorded ones with `seq <= uptoSeq` (and a recorded seq 0 against the initial state); a mismatch is `REPLAY_INVALID` at that seq. Digests are computed only where needed: at recorded seqs, at the last seq and, with `verify: "every"`, at every seq. The returned `digest` is the digest of the final state, computed once.

## Version policy

Two versions are in play and they move independently:

- **`formatVersion`** is the shape of the package itself. It is `1`; a package with another value is rejected before anything else is read.
- **`actionSchemaVersion`** is the version of the action vocabulary and its validation (the definition's `action_schema_version`). It is what the upgrade chain evolves.

**The policy.** Every action-schema version ever released stays replayable. The upgrader chain is append-only: no version is dropped and no upgrader is edited or removed, except by a decision that declares a breaking change and says so. Bumping the current version requires, in the same change, an upgrader from the previous version, a golden package for the new version and an updated chain test. A package whose version is not supported, is above the current one or has no upgrade path is `REPLAY_MISMATCH` (`unsupported action_schema_version <n>`): detected, never silently misread. Because packages are the archive and migration format, a host running a newer engine can always replay an older package, and no host has to change domain code to do so.

**How an old package replays.** `rebuild` given bytes or `{raw}` reads `actionSchemaVersion` from the raw JSON; if it is below the current version it runs the upgraders in order over the **raw JSON** (the old shape cannot be decoded by the current schema), decodes the result under the current schema and replays it. The upgrade is pure and never mutates its input. The package is bound to the definition with the version it was **recorded** under: a version-1 package binds to a definition whose `schemaVersion` is 1 even after the engine's current version is 2; moving a session to a newer definition is a definition change, not an upgrade. A decoded `ReplayPackage` value is taken as already current-shaped, so a caller holding an old package passes its bytes (or raw JSON) to `rebuild`; `upgradeToCurrent(raw, policy?)` is the same step on its own.

Today there is one version, `1` (`CURRENT_ACTION_SCHEMA_VERSION`, the maximum of the supported versions) and `PACKAGE_UPGRADERS` is empty. A package with `actionSchemaVersion: 1` replays unchanged.

`assertUpgraderChain(supported, current, upgraders)` returns `null` for a valid chain and otherwise the first violation as a message naming the version: no supported versions, `current` not supported, a supported version above `current`, an upgrader with `to` different from `from + 1`, a duplicate `from`, a `from` at or above `current`, a missing upgrader (`no upgrader from version n`), or too few upgraders. A test asserts the real constants pass it, so adding a version to the supported list without an upgrader fails the build.

## Adding a schema version and an upgrader

To introduce action-schema version `N + 1`:

1. **Add the version.** Add `N + 1` to `SUPPORTED_ACTION_SCHEMA_VERSIONS` (`packages/core/src/definition/compile/constants.ts`); `CURRENT_ACTION_SCHEMA_VERSION` follows as the maximum.
2. **Write the upgrader.** Append `{from: N, to: N + 1, upgrade}` to `PACKAGE_UPGRADERS` (`packages/core/src/replay/upgrade.ts`). `upgrade(raw: JsonValue): Result<JsonValue, string>` is pure, never mutates `raw` (it receives a deep copy anyway), may rewrite any part of the package (log actions, `initial`, `params`) and does not set `actionSchemaVersion` (the chain does). Return an error string for a package it cannot upgrade; that becomes `REPLAY_INVALID` at seq 0. Never remove or edit an existing upgrader.

   ```ts
   // example: version 2 renamed counter_adjust.by to counter_adjust.delta
   const upgrade1to2: PackageUpgrader = {
     from: 1,
     to: 2,
     upgrade: (raw) => { /* return ok(rewritten) or err("reason") */ },
   };
   ```
3. **Commit a golden package** for the new version next to `golden-package.json` and register it in the golden-file map of `upgrade.test.ts`; the test fails without it. Keep the old golden package, and keep a package in the old shape replaying through the chain to the new digests.
4. **Keep the chain valid.** `assertUpgraderChain(SUPPORTED_ACTION_SCHEMA_VERSIONS, CURRENT_ACTION_SCHEMA_VERSION, PACKAGE_UPGRADERS)` must return `null`.
5. **Teach the engine the new shape**: the package action schema, the action validation and `apply`, and make the compiler accept the new `action_schema_version`. Regenerate golden files only for the new version; the vectors and digests of older versions stay byte-identical.
6. **Update this document** (the version policy) and record the change.

To exercise a chain before a second real version exists, build a replayer with `createReplayer({versions: {current: 2, supported: [1, 2]}, upgraders: [upgrade1to2]})` and replay a version-1 package through it. The repository does this with a committed version-1 package in a pretend old shape.

## Limits

- **Package size**: 64 MiB by default (`maxBytes`); at most 100 errors reported; `json` nesting at most 64 levels, tokenizer depth at most 256.
- **Ids are not charset-checked on decode.** `decodePackage` checks structure and types, not that ids match the id charset; the replayer rejects what cannot enter a state. `eventId` and `principal` of a log entry are not validated either.
- **`buildPackage` does not run upgraders**: it builds current-version packages from a stored session whose `schemaVersion` equals the definition's.
- **A seat without a player is valid** in `initial` (a session may start with open seats).
- **Replay needs bound reducers.** A definition compiled from YAML carries reducer references; the functions must be bound before replay, otherwise `meta` and `roster` actions fail with `reducer not bound`. Replay otherwise needs nothing from the host.
- **`decodePackage` accepts any integer `actionSchemaVersion`**; only `rebuild` rejects an unsupported one.
- **Quality bounds** at the engine's size floor (14 seats, 700 cards, 64 zones, 40 counters): `encodePackage` plus `decodePackage` of a 1 000-transaction, 590 KB package took about 64 ms (limit 3 s); `rebuild` of the same log about 58 ms (limit 10 s); `forkFromSeq` of the same prefix about the same as `rebuild`; a 1 000-transaction `rebuild` retains about 0.02 MiB beyond its result (limit 64 MiB).

## Verifying it yourself

```sh
pnpm build && pnpm exec vitest run packages/core/src/replay
# the golden package is byte-identical in a second process:
GOLDEN_PACKAGE_OUT=/tmp/golden-package.second.json pnpm exec vitest run packages/core/src/replay/package.test.ts
cmp packages/core/src/replay/golden-package.json /tmp/golden-package.second.json && echo IDENTICAL
# replay equivalence over 600 random sessions:
pnpm exec vitest run packages/core/src/replay/replay-properties.test.ts --reporter=verbose
```

To regenerate the golden package after a deliberate format or fixture change: `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/package.test.ts`, then review the bytes by hand. The file is listed in `.prettierignore` because it is canonical bytes on one line; do not run Prettier over it.
