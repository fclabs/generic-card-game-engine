# Canonical JSON profile v1

The byte format that every state digest, content hash and replay comparison in the engine is built on. Two implementations that follow this document produce identical bytes for identical values, so identical digests.

**Status: frozen.** Profile v1 does not change. Any change to an output byte, a node kind or a field order is a new profile version (v2) with a new document, new golden vectors and a migration story for stored digests. The committed golden vectors are the executable form of this document:

`packages/core/src/replay/canonical/golden-vectors.json`

The implementation lives in `packages/core/src/replay/canonical/` and is exported from `@cge/core` as `canonicalize`, `decodeCanonical`, `stateDigest`, `sha256Hex`, `CanonicalError` and the type `CanonicalSchema`. Nothing else in the engine serialises state for identity purposes. The replay package format ([replay-package.md](./replay-package.md)) is written with this same profile; its schema is listed [below](#the-replay-package-schema).

## Overview

```ts
canonicalize(schema: CanonicalSchema, value: unknown): Uint8Array // throws CanonicalError
stateDigest(definition, state): string                            // lower-case hex SHA-256
sha256Hex(bytes: Uint8Array): string
decodeCanonical(schema, bytes): Result<unknown, readonly PackageError[]>  // the inverse of canonicalize
```

`canonicalize` does not inspect a value and guess its shape. The caller passes a **schema**, a plain data tree that says which fields exist, in which order they are written and which node kind each one is. The value must fit the schema exactly; anything that does not fit is a `CanonicalError`. `stateDigest` builds the schema of a session state from the game definition, canonicalizes the state with it and hashes the bytes.

## The rules

### Rule 1: Output encoding

Output is UTF-8 with no byte-order mark, no insignificant whitespace and no trailing newline. Separators are a bare `,` and `:`.

### Rule 2: Key order is schema-defined

Key order is the order the schema declares, never lexicographic. `canonicalize` takes a `CanonicalSchema` built from these node kinds:

| Node | Accepts | Emits |
|------|---------|-------|
| `int` | a safe-range integer `number` | JSON number (rule 5) |
| `bigint` | a `bigint` | JSON string of base-10 digits (rule 4) |
| `string` | a string | JSON string (rule 6) |
| `bool` | a boolean | `true` / `false` (rule 7) |
| `null` | `null` only | `null` |
| `optional(node)` | a field that may be absent | the inner node, or nothing (rule 3) |
| `array(node)` | an array | `[...]` in the array's own order |
| `object([[field, node], ...])` | a plain object with exactly these fields | `{...}` with fields in **declaration order** |
| `idMap(node)` | a plain object used as a record keyed by id | an array of `[key, value]` pairs sorted by key (below) |
| `json` | untyped payload data (below) | `json` form with keys sorted |

A schema is itself plain JSON: `{ "kind": "object", "fields": [["a", { "kind": "int" }]] }`. That is how the golden vectors embed theirs.

**`idMap`.** The value is emitted as an array of two-element arrays `[key, value]`, sorted by ascending UTF-16 code-unit order of the key (the order of the default JavaScript string comparison, so `"B"` sorts before `"a"` and a BMP character such as U+FFFF sorts after an astral one whose high surrogate is lower). The result does not depend on the insertion order of the object's keys. Keys are emitted with the same string escaping as any string. Delegations are not an `idMap`; they are a plain `array` kept in insertion order.

**`object`.** The value must be a plain object (prototype `Object.prototype` or `null`). A field present in the value but not in the schema is a `CanonicalError`; so is a required field that is missing, and so is a symbol-keyed property.

**`json`.** Used only where no schema is declared: sealed gate submissions, grant targets and scopes, session outcomes, and delegation scopes. It admits strings, safe integers, booleans, `null`, arrays and plain objects, nothing else (no `bigint`, no floats). Object keys are sorted by UTF-16 code-unit order at every level. Nesting deeper than 64 levels, counting the node's own value as level 1, is a `CanonicalError`, and so is a cyclic structure.

### Rule 3: Optional fields and `null`

An optional field that is absent is omitted from the output. "Absent" means the key is not an own property of the object. A key that is present with the value `undefined` is an error, never an omission: this keeps builders honest and keeps digests deterministic. `null` is accepted only by the `null` node; v1 has no nullable or union node, so a field cannot be "string or null". `undefined` anywhere else is an error. `optional` outside an object field validates its inner node and nothing more.

### Rule 4: `bigint`

A `bigint` is emitted as a JSON **string** of its base-10 digits: a leading `-` only for negatives, no leading zeros, and `"0"` for zero. Counters, deltas and amounts are always `bigint`; they never appear as JSON numbers.

### Rule 5: Safe-range integers

Integers inside the safe range (`seq`, positions, ordinals, `direction`) are JSON numbers in base 10, with no exponent, no fraction and no sign other than a leading `-`. Any non-integer, any integer outside `[-(2^53 - 1), 2^53 - 1]`, `NaN`, `±Infinity` and negative zero (`-0`) is a `CanonicalError`.

### Rule 6: Strings

Strings use JSON escaping limited to these cases:

- `"` becomes `\"` and `\` becomes `\\`;
- U+0008, U+0009, U+000A, U+000C and U+000D become `\b`, `\t`, `\n`, `\f` and `\r`;
- every other code point from U+0000 to U+001F becomes `\u00xx` with **lower-case** hex digits;
- everything else is written raw: non-ASCII text, U+007F, U+2028, U+2029, `/` and astral characters.

No Unicode normalisation is performed; strings are compared and serialised byte for byte. A lone surrogate (an unpaired high or low half) is a `CanonicalError`.

### Rule 7: Booleans and arrays

Booleans are `true` and `false`. Arrays keep their order.

### Rule 8: Digest

`StateDigest` is the lower-case hexadecimal SHA-256 of the output bytes (64 characters). SHA-256 is implemented in pure TypeScript inside core and verified against the FIPS 180-4 test vectors; `sha256Hex` takes a `Uint8Array`.

## Errors

`canonicalize` throws `CanonicalError`, an `Error` subclass with a `path` property that locates the offender. Paths start at `$` and continue with `.field`, `[3]` for an array index and `["key"]` for an `idMap` key, for example `$.cards["c7"].metadata.rank`. Everything outside the profile or the schema is rejected: floats, `NaN`, `±Infinity`, `-0`, unsafe integers, `undefined`, functions, symbols, cyclic structures, `Map`, `Set`, `Date` and other non-plain objects, lone surrogates, `bigint` inside a `json` node and undeclared fields.

## The session state schema

`stateDigest(definition, state)` serialises the state with the schema below. **Field order is fixed** and is exactly this order. The session `id` is excluded, so a fork or a re-keyed copy with identical content has the same digest.

| # | Field | Node |
|---|-------|------|
| 1 | `lifecycle` | `string` (`active`, `completed`, `terminated`) |
| 2 | `seq` | `int` |
| 3 | `cards` | `idMap` of `{ zone, orientation, metadata }` |
| 4 | `zones` | `idMap` of `{ template?, owner?, members }` |
| 5 | `zoneOrdinals` | `idMap` of `int` |
| 6 | `counters` | `idMap` of `bigint` (stored counters only) |
| 7 | `derivedCounters` | `idMap` of `bigint`, computed on demand, never stored |
| 8 | `meta` | `idMap` of the meta partition object |
| 9 | `roster` | `{ seats }`, `seats` an `idMap` of `{ status, player?, team? }` |
| 10 | `control` | `{ phase, turnOrder, activeSeats, direction, pointers }` |
| 11 | `gates` | `{ open, resolved }`, each an `idMap` of `{ schemaId, expectedSeats, submissions }` |
| 12 | `delegations` | `array` of `{ seat, principal, scope?, boundary? }` in insertion order |
| 13 | `grants` | `idMap` of `{ target, keys, grantee, scope }` |
| 14 | `outcome` | optional `json` |

Details that matter when reimplementing the schema:

- `orientation`, `status` and `lifecycle` are plain `string` nodes; the kernel, not the schema, restricts the values.
- `control.pointers` and `gates.*.submissions` are `idMap`s (`submissions` of `json` values). `control.direction` is an `int` (`1` or `-1`).
- `target`, `scope` (of a grant), `submissions` values, delegation `scope` and `outcome` are `json` nodes.
- `members` order is significant and part of the digest. This includes unordered zones, whose members keep insertion order.
- `derivedCounters` holds one entry per derived counter declared by the definition, evaluated against the state being digested. An evaluator that throws or does not return a `bigint` makes `stateDigest` throw a plain `Error`; this is a programmer error in the definition, not a `CanonicalError`.
- **Metadata and meta partitions use a union node.** An `idMap` has one value node, but every card may declare its own metadata fields and every meta schema its own partition fields. The schema therefore uses one object node per use whose fields are the union of the declared field names across all card metadata schemas (for `cards[*].metadata`) or across all meta schemas (for each `meta` partition). Field names are sorted by UTF-16 code-unit order and every field is optional. A name declared with different types in different schemas becomes a `json` node, which writes strings, integers and booleans with the same bytes the typed node would. A field declared by no schema is a `CanonicalError`. Whether a particular card may hold a particular field is enforced earlier, when `set_metadata` is applied.
- Field types a definition may declare for metadata and meta fields are `string`, `int`, `bool` and `json`.
- An action payload has no canonical schema in this version. Committed actions are compared structurally, not by canonical bytes.

## Definition identity

A game definition is identified by hashes built with this same profile; they are what replay packages bind to. Three schemas are involved. The data being hashed is `definitionData(definition)`: every data member of a `CompiledGameDefinition` and **no function**. The function-valued members (derived-counter evaluators, meta reducers and the roster reducer) are not data and never appear; identity carries only their declarations (`derivedSpec`, `reducerRef`, `rosterReducerRef`), so binding the functions later never changes a hash. Reducers and evaluators are always resolved from the definition value passed to `apply` or `stateDigest`, never from serialised data.

```ts
definitionContentHash(def)                 // sha256Hex(canonicalize(definitionIdentitySchema, definitionData(def)))
hookBundleHash(jsBytes, exports)           // sha256Hex(canonicalize(bundleIdentitySchema, { js: sha256Hex(jsBytes), exports }))
computeDefinitionId(contentHash, bundleHash?)  // "sha256:" + sha256Hex(canonicalize(idIdentitySchema, { contentHash, bundleHash? }))
```

`bundleIdentitySchema` is `object([[js, string], [exports, array(string)]])`; the export names are sorted (UTF-16 order) and de-duplicated before hashing. `idIdentitySchema` is `object([[contentHash, string], [bundleHash, optional(string)]])`; with no bundle the `bundleHash` key is absent, so a definition without a bundle never shares an id with one that has an empty bundle. The id is `sha256:` plus 64 lower-case hex characters. These functions are exported from `@cge/core`; the two small schemas live in `definition/identity.ts`.

### `definitionIdentitySchema`

Defined in `packages/core/src/replay/canonical/definition-schema.ts` (module-level; not exported from the package root, because consumers hash through `definitionContentHash`). It is the root object below, **in this field order**. Fields added after the first version of the schema are appended at the end of their record, which is why `gameId` and `roles` come last at the top level.

| # | Field | Node |
|---|-------|------|
| 1 | `schemaVersion` | `int` |
| 2 | `cards` | `array` of `{ id, type?, metadataSchema, startingZone, initialMetadata, metadataVisibility }`: `string`, optional `string`, `idMap` of `string`, `string`, `idMap` of `json`, `idMap` of `string` |
| 3 | `zones` | `array` of `{ id, ordered, owner?, visibility }`: `string`, `bool`, optional `string`, `idMap` of `string` |
| 4 | `zoneTemplates` | `array` of `{ name, ownerRule, ordered, maxInstances, visibility }`: `string`, `string`, `bool`, `int`, `idMap` of `string` |
| 5 | `counters` | `array` of `{ id, owner, min, max?, initial, scale?, rounding?, supplyRole?, ownerId?, visibility, derivedSpec? }`: `string`, `string`, `bigint`, optional `bigint`, `bigint`, optional `int`, optional `string`, optional `string`, optional `string`, `idMap` of `string`, optional `{ kind, zone }` of `string` |
| 6 | `conservationGroups` | `array` of `{ id, counters }`: `string`, `array` of `string` |
| 7 | `seats` | `array` of `{ id, team? }` |
| 8 | `teams` | `array` of `string` |
| 9 | `viewKeys` | `array` of `string` |
| 10 | `control` | `{ phases, initialPhase, turnOrder, initialActiveSeats, pointerNames, enforceActiveSeats, outOfTurnKinds }` |
| 11 | `metaSchemas` | `array` of `{ id, fields, reducerRef, fieldVisibility }`: `string`, `idMap` of `string`, `string`, `idMap` of `string` |
| 12 | `policies` | `{ cascadeCap, costBudgets }`: `int`, `idMap` of `int` |
| 13 | `hookBindings` | `idMap` of `array` of `string` |
| 14 | `gameId` | `string` |
| 15 | `roles` | `array` of `{ id, subject }` |
| 16 | `rosterReducerRef` | optional `string` |

Sequences (cards, seats, zones, hook lists) keep their order, which is therefore semantic; `idMap` collections are sorted. Optional members are absent, never `undefined`. A definition produced by `compileDefinition` has already passed this schema, so hashing it never throws; a hand-built definition outside the profile (a float in `initialMetadata`, a lone surrogate) throws `CanonicalError`. The schema is frozen like the rest of the profile: any change to a field, its type or its order changes every definition id, and the committed expected hashes next to the tests pin it. The identity schema does not appear in the session-state digest; `stateDigest` still uses only the session state schema above.

## `decodeCanonical`

`decodeCanonical(schema, bytes)` is the inverse of `canonicalize`: given the same schema it reads bytes back into a value (`bigint` nodes are rebuilt from their decimal strings). It was added **without changing profile v1**: it only reads, `canonicalize` is untouched and every golden vector, identity and digest is byte-identical.

It uses a hand-written UTF-8 decoder and tokenizer, not `JSON.parse`, because `JSON.parse` silently keeps the last of two duplicate keys and rounds integers beyond 2^53, and the profile forbids both. It never throws; it returns up to 100 path-bearing errors (`PACKAGE_SYNTAX`, `PACKAGE_DUPLICATE_KEY`, `PACKAGE_UNKNOWN_KEY`, `PACKAGE_SCHEMA`; the full list of codes is in [replay-package.md](./replay-package.md#package-errors)). Reading is **tolerant of formatting**: any whitespace, any object key order and any pair order of an `idMap` is accepted; writing is always canonical. It is **strict about content**: exact schema, safe integers only (a float, an exponent, `-0` or a value above 2^53 - 1 is a `PACKAGE_SCHEMA` error), `bigint` only as `^(0|-?[1-9][0-9]*)$` strings, lone surrogates rejected in values and keys, `json` nesting at most 64 levels (as in the encoder).

## The replay package schema

A replay package is canonicalised with one more schema, `replayPackageSchema` (`packages/core/src/replay/package-schema.ts`, exported from `@cge/core`). It is not part of profile v1's rules; it is a schema written in v1's node kinds, so profile v1 is unchanged. Its fields, **in this order**:

| # | Field | Node |
|---|-------|------|
| 1 | `formatVersion` | `int` (always `1`) |
| 2 | `sessionId` | `string` |
| 3 | `definition` | `{ id, gameId, contentHash }`, all `string` |
| 4 | `actionSchemaVersion` | `int` |
| 5 | `initial` | the session state schema (below) with `id` first and without `derivedCounters`; card `metadata` and `meta` partitions are `json` nodes |
| 6 | `params` | `json` |
| 7 | `log` | `array` of `{ seq, eventId, principal, actions }`: `int`, `string`, `string`, `array` of the action node |
| 8 | `receipts` | `array` of `{ principal, eventId, receipt }`, `receipt` = `{ fingerprint, result, errorCode, seq, detail, privileged }`: `string`, `json`, `json`, `json`, `json`, `bool` |
| 9 | `digests` | `array` of `{ seq, digest }`: `int`, `string` |
| 10 | `forkedFrom` | optional `{ sessionId, seq }`: `string`, `int` |

**The action node** is one `object`: `kind` (`string`) first, then every payload field of every action kind, sorted by name, each `optional`: `active_seats`, `amount` (`bigint`), `boundary`, `card_id`, `counter_id`, `delta` (`bigint`), `direction` (`int`), `fields` (`json`), `from_counter`, `from_zone`, `grant_id`, `grantee`, `grantee_principal`, `keys`, `mode`, `op`, `orientation`, `outcome` (`json`), `owner`, `payload` (`json`), `permutation`, `phase`, `player_id`, `pointer` (`json`), `ratio` (`{ num, den }`, both `bigint`), `remainder_to`, `schema_id`, `scope` (`json`), `seat_id`, `status`, `steps` (`int`), `target` (`json`), `team_id`, `template`, `to_counter`, `to_position` (`int`), `to_state`, `to_zone`, `zone`, `zone_id`, `zones_to_create`. The profile has no tagged union, so one node serves every kind; that an action's fields fit its kind is checked by the replayer, not by the schema.

**The state in a package** has the digest schema's field order with `id` first and no `derivedCounters` (computed, never stored). Where the digest schema consults the definition (card metadata, meta partitions) the package uses `json`; for engine-produced values `json` and the typed nodes write identical bytes, so a package encodes and decodes without a definition. Whether `initial` fits the definition is verified by the replayer, which digests it under the definition's own schema.

## Golden vectors

The committed package example `packages/core/src/replay/golden-package.json` is the golden file of the package schema (a 12-transaction session covering every primitive, a gate, grants and a shuffle; it is compared byte for byte with `encodePackage`). `packages/core/src/replay/canonical/golden-vectors.json` holds 35 vectors. Each entry is `{ name, description, schema, input, expectedText, expectedHex, expectedDigest }`:

- `schema` is the canonical schema as plain JSON;
- `input` is the value, encoded by schema position (positions typed `bigint` hold a decimal string);
- `expectedText` and `expectedHex` are the expected output as text and as bytes;
- `expectedDigest` is `sha256Hex` of those bytes.

The vectors cover the empty object, array and `idMap`; nested arrays; `bigint` zero, minus one, 2^200 and −2^64; safe-integer limits; strings with quotes, backslashes, control characters, U+007F, U+2028/U+2029, astral and non-ASCII text; booleans; a declared `null`; schema order that is not lexicographic; absent and present optionals; `idMap` ordering by case, by UTF-16 code unit, with numeric-looking keys and with keys that need escaping; nested `idMap`s; `json` nodes with unsorted keys, negative numbers and the depth limit; and a miniature state. A unit test asserts every byte and digest, and a second check compares the file with its generator.

To verify: `pnpm exec vitest run packages/core/src/replay/canonical`. To regenerate after a deliberate profile change (v2), run `UPDATE_GOLDEN=1 pnpm exec vitest run packages/core/src/replay/canonical/golden-vectors.test.ts`, format the JSON with Prettier and review the diff by hand; an unexpected diff means the profile changed.

## Deviations from the action reference

The action payload schemas follow the requirements document (section 5.6.3) and the design document. These deliberate differences are part of the shipped behaviour:

1. **Out-of-bounds `move` position.** A `move` whose `to_position` is negative, past the end of the target zone, missing on an ordered zone or supplied for an unordered zone is `MALFORMED_ACTION` naming the id. The reference maps an out-of-bounds position to `CARD_NOT_IN_ZONE`; the kernel keeps that code for a card that is genuinely not in `from_zone`.
2. **`counter_adjust` credits no rounding remainder.** With a `ratio`, `counter_adjust` applies the rounded amount and drops the remainder. The reference mentions crediting it; that is deferred. `counter_transfer` does credit the remainder, to `remainder_to`.
3. **`half_up` rounds ties away from zero.** `half_up` rounds to nearest with ties away from zero (`-5 × 1/2` gives `-3`). `half_even` rounds ties to the even quotient; `floor` rounds toward negative infinity.

Other as-built choices that affect stored values:

- Cards start `face_down` with empty `metadata`; every declared meta schema starts as an empty partition `{}`; `control.direction` starts at `1` and `control.pointers` is empty.
- A `lifecycle` action carrying an `outcome` stores it (overwriting); without one the stored outcome is kept.
- `grant_view` ids are `grant/<seq+1>/<i>` and derived zone ids are `<template>/<ownerToken>/<ordinal>`, so they are identical on live apply and on replay.
