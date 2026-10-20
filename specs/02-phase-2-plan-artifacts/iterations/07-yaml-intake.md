# Iteration 7: Safe YAML intake

Commit: see `git log` (message `Phase 2 iteration 7: safe YAML parsing for definitions`).

## Criteria
- VC-201 PASS: `pnpm build && pnpm exec vitest run packages/config` (`yaml.test.ts`: yes/no strings, numbers, null, anchors/aliases, plain JSON output).
- VC-202 PASS: same command; 1 048 576 bytes ok, +1 `YAML_TOO_LARGE`, 100 aliases ok / 101 `YAML_FORBIDDEN_FEATURE`, UTF-8 multi-byte counting.
- VC-203 PASS: depth 1, depth 3, in an anchored mapping, and alias keys colliding after expansion; each `YAML_DUPLICATE_KEY` with key, line, column in `detail`.
- VC-204 PASS: 18 forbidden cases (tags, `<<`, non-string keys, `__proto__`, multi-document, empty, comment only, `.inf`, `%YAML 1.1`...).
- VC-205 PASS: syntax errors with line/column; fast-check property (1000 runs over `fc.string()`, binary strings and YAML-fragment strings) never throws and returns ok or a non-empty `YAML_*` list; 200 000 `[` returns errors.
- VC-206 PASS: 1 KiB nine-level bomb (72 aliases) fails `YAML_FORBIDDEN_FEATURE` in 2.58 ms, RSS delta 0.77 MiB (bounds 200 ms / 64 MiB).
- VC-230 text form PASS: `yaml-compile.test.ts`: `fixtures/equivalence/base.yaml` and `variant.yaml` (anchor+alias, key order, comments, whitespace, explicit `phases`/`enforce_active_seats`) -> equal `contentHash`; compile twice equal; semantic change differs; child process (`node --input-type=module -e` importing `packages/config/dist/index.js`) on both `.yaml` files equals in-process; `fixtures/floor-definition.yaml` hashes to `identity-expected.json` `contentHashes.floor`.
- VC-275 parse parts PASS (`CGE_PERF_STRICT=1 pnpm exec vitest run packages/config`): 1 MiB document (6131 explicit cards, padded to exactly 1 048 576 bytes) parse+compile median of 5 after warm-up = 379.2 ms (bound 2000); 1 MiB + 1 byte -> `YAML_TOO_LARGE` median 0.001 ms (bound 50). Without strict mode bounds are x10.
- Dependencies PASS: `packages/config/package.json` `dependencies` = `@cge/core` `workspace:*`, `yaml` `2.9.1`; `pnpm install --frozen-lockfile` ok; `pnpm test:guardrails` 174 pass.
- Gates PASS: `pnpm build && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm test:guardrails` exit 0 (955 tests, 174 guardrails); `pnpm format:check` ok.
- Artifacts PASS: CONTEXT.md, DECISIONS.md D-019..D-022, this record.

## Files
- Added: `packages/config/src/{yaml.ts,yaml.test.ts,yaml-compile.test.ts}`, `packages/config/fixtures/floor-definition.yaml`, `packages/config/fixtures/equivalence/{base,variant}.yaml`.
- Changed: `packages/config/src/index.ts` (exports), `packages/config/package.json` (`yaml` 2.9.1, devDependency `fast-check` 4.10.2), `pnpm-lock.yaml`, `.prettierignore`, artifacts.

## Deviations
- Added `fast-check` 4.10.2 to config devDependencies (needed by the VC-205 property; depcruise `no-undeclared-deps`). `dependencies` are exactly as the criterion says.
- No export additions to `@cge/core` were needed (`Result`, `JsonValue`, `DefinitionError`, `MAX_DEFINITION_ERRORS`, `compileDefinition`, `definitionContentHash` are on the root).

## Gotchas
- `Result` failure field is `error` (not `errors`). `parseDocument` has no `maxAliasCount` option (it is a `toJS` option); `merge: false` makes `<<` a plain string key, so the walk rejects it explicitly.
- `prettyErrors: false` is used and positions come from a `LineCounter`; `eslint .` run directly (not via `pnpm lint`) can report parser-project errors if `dist` is stale: always use `pnpm lint`.
- Fixture YAML would be reformatted by Prettier without the `.prettierignore` entry.
- Vite's optional `yaml` peer made the lockfile touch every package's vitest snapshot id.

## For the next iteration
- Use `parseYaml(text)` from `./yaml.js` inside `packages/config` (signature, error shape and path/detail conventions in CONTEXT.md). `buildHookBundle` reads `game.yaml` through it and must forward `error` arrays; `ok` values feed `compileDefinition`/`collectHookReferences`/`definitionNeedsBundle` directly.
- Add `esbuild` with `pnpm --filter @cge/config add --save-exact esbuild@<ver>`; the VC-235 static test must keep `yaml.ts` clean (no `import(`, `require(`, `eval(`, `new Function`, `node:vm`; the word `import(` does not appear in `yaml.ts` comments either).
- Put new fixtures beside `packages/config/fixtures/`; data files only (add to `.prettierignore` already covered by `fixtures/**`).
