# CONTEXT — Phase 1 domain kernel (as of Iteration 2)

## Current state
- Iteration 1 of 13 done: toolchain verified, skeleton-purity guardrail exempts `packages/core` only, branded ids, error taxonomy, `Snapshot`/`deepFreeze` exist in `packages/core`.
- No runtime dependencies added; `packages/core/package.json` is unchanged.
- Gate: `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test && pnpm test:guardrails` all green.

## File map (`packages/core/src`)
| Path | Contents |
|------|----------|
| `index.ts` | re-exports `session definition visibility replay spi ports errors` indexes |
| `index.test.ts` | placeholder tests + root-export check for iteration-1 names |
| `errors/codes.ts` | `ERROR_CODES`, `ErrorCode` |
| `errors/result.ts` | `EngineError`, `GameRejection`, `Result`, `ok`, `err` |
| `errors/index.ts` | re-exports the above |
| `errors/errors.test.ts` | VC-003 + Result tests |
| `session/ids.ts` | branded ids, `Seq`, guards, constructors |
| `session/ids.test.ts` | VC-001, VC-002 |
| `session/snapshot.ts` | `DeepReadonly`, `Snapshot`, `deepFreeze` |
| `session/snapshot.testing.ts` | `isDeepFrozen` (test-only; NOT exported from any index) |
| `session/snapshot.test.ts` | VC-012 (type part, local sample type), VC-013 (helper part) |
| `util/utf8.ts`, `util/utf8.test.ts` | internal `encodeUtf8` (not exported from any index) |
| `replay/index.ts` | `export * from "./canonical/index.js"` |
| `replay/canonical/{canonicalize,schema,sha256}.ts` | profile v1 implementation (+ `*.test.ts` beside each; `index.test.ts` = VC-068 partial) |
| `replay/canonical/index.ts` | exports exactly `canonicalize`, `CanonicalError`, `sha256Hex`, type `CanonicalSchema` |
| `replay/canonical/generate-golden-vectors.testing.ts` | vector sources, `buildGoldenVectors`, `encodeInput`/`reviveInput`, `toHex` (pure, test-only) |
| `replay/canonical/golden-vectors.json`, `golden-vectors.test.ts` | 35 committed vectors; VC-060 |
| `purity.test.ts` | VC-065 scan of non-test sources under `packages/core/src` |
| `session/index.ts` | `export * from ids`, `deepFreeze`, `DeepReadonly`, `Snapshot` |
Other changes: `packages/core/tsconfig.json` excludes `src/**/*.testing.ts`; `tools/guardrails/repo-invariants.ts` `checkSkeletonPurity` skips `packages/core/`.

## Public interfaces
- ids (`core/session`): types `SessionId DefinitionId CardId ZoneId SeatId PlayerId TeamId CounterId GateId GrantId` (`string & {[brand]: Name}`), `Seq` (`number & brand`). Guards `isSessionId … isGrantId (v: unknown): v is X` and `isSeq`. Constructors `sessionId definitionId cardId zoneId seatId playerId teamId counterId gateId grantId seq (v: unknown): Result<X>`; failure is `{code: 'MALFORMED_ACTION', detail: 'invalid <Name>: <value>'}` with no `path`/`actionIndex`. String id rule: `^[A-Za-z0-9_.:/-]{1,128}$`; `Seq`: safe integer >= 0.
- errors (`core/errors`): `ERROR_CODES` (readonly tuple of 24), `ErrorCode`, `EngineError {code; detail; actionIndex?; path?}`, `GameRejection {readonly code: string; readonly detail?: string}`, `Result<T, E = EngineError> = {ok:true;value:T}|{ok:false;error:E}`, `ok(value)`, `err(error)`.
- snapshot (`core/session`): `DeepReadonly<T>` (primitives/bigint/functions untouched, arrays -> `readonly`, objects -> readonly mapped), `Snapshot<T> = DeepReadonly<T>`, `deepFreeze<T>(v: T): Snapshot<T>` (iterative, cycle-safe, always descends into frozen shells, freezes in place and returns the same reference).
- Test helper: `isDeepFrozen(v: unknown): boolean` in `session/snapshot.testing.ts`.

- canonical (`core/replay/canonical`, also re-exported by `core/replay` and the root): `canonicalize(schema: CanonicalSchema, value: unknown): Uint8Array` (throws `CanonicalError`), `class CanonicalError extends Error {readonly path: string}` (path syntax `$`, `.field`, `[3]`, `["idMapKey"]`), `sha256Hex(bytes): string` (lower-case, 64 chars), type `CanonicalSchema`. `stateDigest` lands in iteration 4.
- Schema constructors live in `replay/canonical/schema.ts` and are NOT exported from the index (import them from `./schema.js` inside core): consts `intNode bigintNode stringNode boolNode nullNode jsonNode`; functions `optionalNode(of)`, `arrayNode(of)`, `idMapNode(of)`, `objectNode(fields: readonly (readonly [string, CanonicalSchema])[])`. `CanonicalSchema` is a plain JSON-serialisable tree `{kind: 'int'|'bigint'|'string'|'bool'|'null'|'json'} | {kind:'optional'|'array'|'idMap', of} | {kind:'object', fields}`. `JSON_MAX_DEPTH = 64` is exported from `canonicalize.ts` only.
- Semantics fixed in iteration 2: `optional` only omits when the key is absent (own property); a present key holding `undefined` is an error; `null` is accepted only by `nullNode`; objects must be plain (Object.prototype or null prototype), undeclared or symbol keys are errors, missing required fields are errors; `idMap`/`json` keys sorted with default `Array.prototype.sort` (UTF-16 code units); `json` node: depth of the node's value is 1, containers deeper than 64 and cycles are errors; ints reject -0/unsafe/non-number.
- `util/utf8.ts` (internal): `encodeUtf8(text): Result<Uint8Array, {index: number}>`; `err({index})` is the code-unit offset of a lone surrogate.

## Conventions & invariants
- Determinism rules (no `node:*`, `Date`, `Math.random`, `performance.now`, `process.env`, `crypto`, timers, `Atomics`, `SharedArrayBuffer`; core compiles with `types: []`) apply to all non-test code under `packages/core/src`.
- Tests: `*.test.ts` beside source; shared test builders/helpers `*.testing.ts` (compiled only by `tsconfig.test.json`; never exported from an index).
- Skeleton-purity exemption covers `packages/core` only; every other package must stay `export {}`/re-exports.
- Type-level tests: `@ts-expect-error` and `expectTypeOf` run under `pnpm typecheck` (tsconfig.test.json); vitest does not typecheck.
- No `!`/casts that eslint flags as unnecessary; `noUncheckedIndexedAccess` is not tripped by branded-key records.

## Commands (run from the worktree root)
```
export PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"   # Node 22.18.0 (default node is v26, wrong)
corepack enable --install-directory "$HOME/.nvm/versions/node/v22.18.0/bin"   # once; makes pnpm 10.15.1 resolve
hash -r; node -v; pnpm -v        # expect v22.18.0 and 10.15.1
pnpm install --frozen-lockfile
pnpm typecheck | pnpm lint | pnpm depcheck | pnpm test | pnpm test:guardrails | pnpm test:all | pnpm format:check
pnpm exec vitest run <path>      # single test file
pnpm exec prettier --write <paths>
```
Note: `.nvmrc` says 22.23.3 but only 22.18.0 is installed locally; it satisfies `>=22 <23`. Docker target (iterations 12, 13): `docker compose -f deploy/docker-compose.test.yml run --rm tests`. Shell is zsh on macOS: `sed -i` needs a suffix; use the Edit tool.

## Golden vectors
- Source of truth: `GOLDEN_SOURCES` in `generate-golden-vectors.testing.ts`; each has a hand-written `expectedText` that the generator cross-checks against `canonicalize` (and an independent UTF-8 encoding) before writing.
- Regenerate: `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/canonical/golden-vectors.test.ts`, then `pnpm exec prettier --write packages/core/src/replay/canonical/golden-vectors.json` and review the diff by hand. Verify: `pnpm exec vitest run packages/core/src/replay/canonical`.
- JSON entry: `{name, description, schema, input, expectedText, expectedHex, expectedDigest}`; `input` is schema-directed encoded (bigint positions hold decimal strings; `reviveInput(schema, input)` inverts). The profile is frozen: changing any expected byte/digest means a profile change and needs a logged decision.

## Known gaps
- `SessionState` and all §6.4 state types: iteration 4 (re-point `snapshot.test.ts` sample at `SessionState`).
- `stateDigest` and the state schema builder: iteration 4 (add to canonical `index.ts`, update `index.test.ts` and VC-068 to four exports). `docs/canonical-json-profile.md` and its test (VC-066): iteration 13. Definition types: 3. PRNG: 5. `apply`: 6-10.
- `GameRejection` shape (`code` + optional `detail`) is a plan-level choice (D-001); revisit in iteration 11/12 if the SPI needs more.
