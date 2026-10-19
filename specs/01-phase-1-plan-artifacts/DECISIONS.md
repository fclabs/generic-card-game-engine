# DECISIONS (append-only)

## D-001: Id, error and snapshot API shapes  (Iteration 1)
**Context**: The spec fixes behaviour but not exact names for constructors, `GameRejection`, or how `deepFreeze` treats frozen inputs.
**Decision**: Guards are `isX(v: unknown): v is X`; constructors are lowerCamel `x(v: unknown): Result<X>` (e.g. `cardId`, `seq`) returning `MALFORMED_ACTION` with detail `invalid <Name>: <value>` and no `path`. Brands use a `declare const brand: unique symbol` tag. `GameRejection = {readonly code: string; readonly detail?: string}`. `Result`'s error defaults to `EngineError`; `ok`/`err` return the narrow variant types. `deepFreeze` freezes in place, returns the same reference, is iterative with a visited set (cycle-safe) and always descends, even into already-frozen objects, so a shallow-frozen shell is completed. Callers wanting structural-sharing speed (iteration 6) pass only new objects.
**Rejected**: Making `deepFreeze` skip frozen subtrees (silently leaves unfrozen children); recursion (stack overflow on deep graphs); an opaque brand class for `GameRejection` (no spec need).
**Consequences**: Later iterations validate ids with the guards and convert via the constructors; iteration 4 `createSession` uses `Result`; iteration 6 must freeze only new objects for KNFR-004 performance.

## D-002: Skeleton-purity exemption by path prefix  (Iteration 1)
**Context**: Spec §6.5 exempts `packages/core` only from FR-043 check 4.
**Decision**: `checkSkeletonPurity` filters out files under `<repo>/packages/core/` and checks all other `packages/**` as before. The old VC-074 test now plants code in `packages/app`; a new test shows `packages/core` with code passes. No other guardrail touched.
**Rejected**: Removing the check (spec says it stays for other packages); a configurable allowlist (scope creep).
**Consequences**: A new package that needs code later requires a deliberate guardrail change.

## D-003: Node/pnpm activation on this machine  (Iteration 1)
**Context**: Default node is v26 and pnpm was not on PATH; `.nvmrc` pins 22.23.3 but only 22.18.0 is installed.
**Decision**: Prepend `~/.nvm/versions/node/v22.18.0/bin` to PATH and `corepack enable --install-directory` that dir so the `pnpm@10.15.1` shim resolves. See CONTEXT Commands.
**Rejected**: Using `/usr/local/bin/pnpm` (version not guaranteed to match the pin); installing another Node.
**Consequences**: Every iteration starts with the PATH export; Docker remains the authoritative gate.

## D-004: CanonicalSchema constructors and error surface  (Iteration 2)
**Context**: Spec §6.2 lists node kinds but not constructor names; the plan says the index exports exactly `canonicalize`, `sha256Hex`, `CanonicalError` (+ `stateDigest` later) and types.
**Decision**: `CanonicalSchema` is a plain discriminated union (`kind` tags). Constructors are consts `intNode bigintNode stringNode boolNode nullNode jsonNode` and functions `optionalNode arrayNode idMapNode objectNode`, living in `schema.ts` and not exported from the index (core-internal; iteration 4 imports them directly). `canonicalize` throws `CanonicalError {path}` (it never returns a Result); paths look like `$.a[2]["id"]`.
**Rejected**: Exporting constructors from the index (violates the "exactly" export list); names like `int()`/`null()` (clash with keywords/reads ambiguously); a Result return (spec KFR-070 says "yield a CanonicalError").
**Consequences**: Later phases needing schemas from outside core will need an index change plus a decision; schemas are JSON-serialisable so golden vectors embed them.

## D-005: Strict semantics for optional, null and objects  (Iteration 2)
**Context**: Rule 3 says absent optional fields are omitted yet `undefined` is an error; "null only where declared" needs a declaring node.
**Decision**: Optional is omitted only when the key is absent; a present key with `undefined` is a `CanonicalError`. `nullNode` is the only node accepting `null` (there is no nullable/union node in v1). Objects must be plain; undeclared fields, symbol keys and missing required fields are errors. `optional` outside an object field simply validates its inner node.
**Rejected**: Treating `{k: undefined}` as absent (hides builder bugs and breaks digest determinism); adding a `nullable` node (not in the frozen node list).
**Consequences**: State builders (iteration 4+) must not emit `undefined`-valued keys; a nullable field cannot be expressed in v1 (none is needed in §6.4).

## D-006: Golden-vector generation runs through vitest  (Iteration 2)
**Context**: No `tsx`/ts-node in the repo and no new dependencies allowed; `.testing.ts` files are linted by the determinism rules (no `node:*`).
**Decision**: Vectors are defined in pure `generate-golden-vectors.testing.ts` with hand-written expected text; `golden-vectors.test.ts` writes the JSON when `UPDATE_GOLDEN=1` and always asserts file == generator output and bytes/digest (also against `node:crypto`).
**Rejected**: A standalone node script (needs a TS runner); computing expectations only from the implementation (self-confirming).
**Consequences**: Regeneration command is in CONTEXT.md; any diff to the JSON must be hand-reviewed.
