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
