# Game definition schema (`game.yaml`, version 1)

Reference for the file a game author writes: `games/<id>/game.yaml`. Every key, its type, range and default, the error each mistake produces, the rules for generators and `for_each`, a worked example, and the full list of load-time error codes.

For how a directory of files becomes a content-addressed `DefinitionId`, how the registry verifies it and how the hook bundle is built, see [game-definitions.md](./game-definitions.md). For the server's own configuration file, see [server-config.md](./server-config.md).

## How to read this page

- **The schema is strict.** An unknown key, an unknown enum value or a value of the wrong type is always an error, never ignored and never coerced (`"8"` is not `8`). Every mapping rejects unknown keys.
- **Errors are collected, not thrown.** The compiler reports every problem it finds, in document order, up to 100 (a `truncated` flag says more existed). Each error has a `code`, a `path` such as `zones[2].id`, a `detail` and, when one exists, the `entity` id it is about. The document root has the path `""`.
- **Sections are checked in the order of the table below.** A section whose dependencies failed is skipped rather than reported twice: if `seats` is invalid, `zones`, `counters` and `conservation_groups` are not checked (they all depend on the seat layout), and when `roles` is invalid the role-name check on visibility blocks is skipped. Fix the first errors and run again; more may appear.
- **Defaults** are what the compiled definition holds when the key is absent. An explicit value equal to the default produces the same definition (and the same identity) as omitting it.
- **Integers** are YAML integers. A float where an integer is required is `SCHEMA_TYPE`. Counter amounts may also be written as quoted decimal strings, which is required beyond 2^53 - 1 (see [counters](#counters)).
- **Ids** (cards, zones, counters, seats, teams, roles, meta schemas, phases, pointers, conservation groups) match `^[A-Za-z0-9_.:/-]{1,128}$`. The check runs after `for_each` and generator expansion, so a generated id such as `Seat 1` is reported with the path of the `prefix` or generator that produced it.

## Top-level keys

| Key | Type | Required | Default | Section |
|-----|------|----------|---------|---------|
| `id` | string | yes | | [Identity and version](#identity-and-version) |
| `action_schema_version` | integer | yes | | [Identity and version](#identity-and-version) |
| `roles` | list | no | `[]` | [Roles](#roles) |
| `seats` | mapping | yes | | [Seats and teams](#seats-and-teams) |
| `zones` | list | no | `[]` | [Zones](#zones) |
| `cards` | list | no | `[]` | [Cards and generators](#cards-and-generators) |
| `counters` | list | no | `[]` | [Counters](#counters) |
| `conservation_groups` | list | no | `[]` | [Conservation groups](#conservation-groups) |
| `control` | mapping | no | see [Control](#control) | [Control](#control) |
| `meta_schemas` | list | no | `[]` | [Meta schemas](#meta-schemas) |
| `roster_reducer` | string | no | absent | [Hooks and reducers](#hooks-and-reducers) |
| `view_keys` | list | no | all four grantable keys | [View keys](#view-keys) |
| `hooks` | mapping | no | absent | [Hooks and reducers](#hooks-and-reducers) |
| `policies` | mapping | no | `{cascade_cap: 16, cost_budgets: {}}` | [Policies](#policies) |

The table lists the keys in the order the compiler validates and reports them. A non-mapping document is `SCHEMA_TYPE` at path `""`; an absent required key is `SCHEMA_MISSING` at the key's path; an unknown key is `SCHEMA_UNKNOWN_KEY` at the key's path.

### Structural limits

| Limit | Value | Error |
|-------|-------|-------|
| Seats | 64 | `LIMIT_EXCEEDED` at `seats` |
| Teams | 32 | `LIMIT_EXCEEDED` at `seats.teams` |
| Zones, after `for_each` expansion (fixed zones only) | 1 000 | `LIMIT_EXCEEDED` at `zones`, reported once |
| Cards, after generator expansion | 10 000 | `LIMIT_EXCEEDED` at `cards[i]` or `cards[i].generate` |
| Counters, after `for_each` expansion | 5 000 | `LIMIT_EXCEEDED` at `counters`, reported once |
| Phases | 64 | `LIMIT_EXCEEDED` at `control.phases` |
| Instances of one zone template (`max_instances`) | 256 | `INVALID_VALUE` |
| Template name length | 48 characters, no `/` | `INVALID_VALUE` |
| Any id | 128 characters | `INVALID_VALUE` |
| Errors reported per compile | 100 | the list is cut and `truncated` is set |
| YAML text size | 1 MiB (1 048 576 bytes of UTF-8) | `YAML_TOO_LARGE` |
| YAML aliases | 100 | `YAML_FORBIDDEN_FEATURE` |

## Identity and version

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `id` | string matching `^[a-z0-9][a-z0-9_-]{0,63}$` | required | `INVALID_VALUE` for a bad value; `SCHEMA_MISSING` when absent |
| `action_schema_version` | integer; today only `1` is supported | required | `UNSUPPORTED_SCHEMA_VERSION` for any other integer; `SCHEMA_TYPE` for a non-integer |

`id` becomes `gameId` in the compiled definition and is part of its identity, so renaming a game gives it a new `DefinitionId`. When the file is loaded from a game directory, `id` must equal the directory name (`GAME_ID_MISMATCH` otherwise). `action_schema_version` becomes `schemaVersion`.

## Roles

`roles` declares custom roles on top of the four built in ones (`player`, `dealer`, `auditor`, `render`). A role is referred to by name in `visibility` blocks.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `roles[].id` | id; not a built-in role; unique | required | `INVALID_VALUE` (charset), `DUPLICATE_ID` (a built-in name or a repeat, reported at the later item) |
| `roles[].subject` | `required`, `optional` or `forbidden` | required | `INVALID_VALUE` (unknown value), `SCHEMA_MISSING` |

The compiler validates and stores both fields. What `subject` means, and what a custom role sees, is decided by the projection layer (see [What this schema does not do yet](#what-this-schema-does-not-do-yet)).

## Seats and teams

`seats` is required and takes exactly one of two forms.

**List form** (explicit seats, optional teams):

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `seats.list` | non-empty list of seats | | `INVALID_VALUE` (empty, or `list` together with `count`, or neither form) |
| `seats.list[].id` | id; unique | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `seats.list[].team` | a team declared in `seats.teams` | none | `UNKNOWN_REFERENCE` |
| `seats.teams` | list of distinct ids (only with `list`) | `[]` | `LIMIT_EXCEEDED` above 32, `DUPLICATE_ID`, `INVALID_VALUE` for a team that no seat joins |

**Count form** (generated seats, no teams):

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `seats.count` | integer 1 to 64 | | `INVALID_VALUE` below 1, `LIMIT_EXCEEDED` above 64 |
| `seats.prefix` | string | `seat` | `INVALID_VALUE` when `prefix` plus a number is not a valid id (the first bad id is named, for example `Seat 1`); also `INVALID_VALUE` when given with `list` |

`count: 4` produces `seat1` to `seat4`; `count: 4, prefix: p` produces `p1` to `p4`. `teams` together with `count` is `INVALID_VALUE`. Seat order is declaration order and is semantic: it is the default turn order and the order `for_each: seat` expands in. A game can have up to 64 seats and 32 teams.

## Zones

`zones` is a list of **fixed zones** and **templates**. An entry that has a `template` key is a template.

**Fixed zone**

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `zones[].id` | id (may hold `{seat}` or `{team}` with `for_each`) | required | `INVALID_VALUE`, `DUPLICATE_ID` (also against template names) |
| `zones[].ordering` | `ordered` or `unordered` | required | `SCHEMA_MISSING`, `INVALID_VALUE` |
| `zones[].owner_id` | a declared seat or team (may hold a placeholder) | no owner | `UNKNOWN_REFERENCE` |
| `zones[].for_each` | `seat` or `team` | one instance | `INVALID_VALUE` (see [`for_each`](#for_each-and-placeholders)) |
| `zones[].visibility` | [visibility block](#visibility-blocks) | `{}` | `INVALID_VISIBILITY`, `SCHEMA_TYPE` |

**Template** (zones created at run time, for example one meld per team)

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `zones[].template` | name: no `/`, at most 48 characters, id charset; unique, and never equal to a fixed zone id | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `zones[].owner` | `seat`, `team`, `player` or `none` | required | `SCHEMA_MISSING`, `INVALID_VALUE` |
| `zones[].ordering` | `ordered` or `unordered` | required | as above |
| `zones[].max_instances` | integer 1 to 256 | required | `SCHEMA_MISSING`, `INVALID_VALUE` |
| `zones[].visibility` | [visibility block](#visibility-blocks); `owner` and `team` audiences are allowed unless `owner` is `none` | `{}` | `INVALID_VISIBILITY` |

Instance ids are derived at run time as `<template>/<owner>/<ordinal>`, which is why a template name must not contain `/`. Cards can start only in fixed zones.

## Cards and generators

`cards` is an ordered list. **Card order is semantic**: it is the initial order of every zone's members, so reordering cards changes the definition.

**Explicit card**

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `cards[].id` | id; unique across all cards, including generated ones | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `cards[].type` | string | none | `SCHEMA_TYPE` |
| `cards[].zone` | a declared **fixed** zone | required | `UNKNOWN_REFERENCE` (also for a template name), `SCHEMA_MISSING` |
| `cards[].metadata` | mapping field to value; every field must be declared in `metadata_schema` | `{}` | `INVALID_VALUE` (undeclared field), `SCHEMA_TYPE` (wrong type) |
| `cards[].metadata_schema` | mapping field to `{type, visibility}` | `{}` | `INVALID_VISIBILITY`, `SCHEMA_MISSING` |

`metadata_schema` field entries are `{type: string | int | bool | json, visibility: public | subject | secret}`. Both are required: a field with no `visibility` is `INVALID_VISIBILITY`, because a missing declaration must never silently widen who can see a value. A `json` value may hold any JSON value without floats, nested at most 64 levels, with safe integers only and no lone surrogates. A float inside `json` is `SCHEMA_TYPE`; the other violations are `INVALID_VALUE`.

**Generator**: an entry whose only key is `generate` (`cards[].generate`).

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `cards[].generate.axes` | non-empty ordered list of `{name, values}` | required | `INVALID_VALUE` (empty) |
| `cards[].generate.axes[].name` | `^[a-z][a-z0-9_]*$`; distinct | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `cards[].generate.axes[].values` | non-empty list of strings and safe integers, or `{range: [lo, hi]}` with safe integers and `lo <= hi` | required | `INVALID_VALUE`, `SCHEMA_TYPE` |
| `cards[].generate.id` | id template | required | as `cards[].id` |
| `cards[].generate.type` | string template | none | |
| `cards[].generate.zone` | a declared fixed zone; may hold a placeholder | required | `UNKNOWN_REFERENCE` |
| `cards[].generate.metadata` | mapping; string values may hold placeholders | `{}` | as `cards[].metadata` |
| `cards[].generate.metadata_schema` | as `cards[].metadata_schema`; shared by every generated card | `{}` | as above |

### Generator rules

- A generator expands to the **cartesian product of its axes in list order, the first axis varying slowest and the last fastest**. For `axes: [suit, rank]` the cards come out `S1 ... S13, H1 ... H13, ...`; swapping the two list items gives `S1, H1, D1, C1, S2, ...` and a different definition. Axes are a YAML sequence precisely so that this order never depends on mapping-key order.
- `{axisName}` placeholders are substituted in `id`, `type`, `zone` and **top-level string `metadata` values**. They are not substituted inside nested `json` values. A placeholder naming an axis that does not exist, or an unmatched `{` or `}`, is `INVALID_VALUE` at the field path.
- A metadata value that is **exactly one placeholder** keeps the axis value's type: with an integer axis, `rank: "{rank}"` is an integer. A string that mixes text and placeholders is always a string and needs a `string` or `json` field. Types are checked once per generator against `metadata_schema`, not per card.
- The 10 000 card limit is checked against the product of the axis lengths before anything is expanded (`LIMIT_EXCEEDED` at `cards[i].generate`), so a large range costs nothing.
- Generated-id faults (bad charset, duplicate, unknown zone) are reported once per generator, naming the first offending card, rather than once per card.
- An explicit card is a generator with no axes: braces in an explicit card are literal characters (and are rejected by the id charset).
- Within one generator all cards share the same `metadata_schema` declaration.

## Counters

Counters hold exact integers. Amounts compile to `bigint`, so the range is not limited to 2^53.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `counters[].id` | id (placeholders with `for_each`); unique | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `counters[].owner` | `table`, `player`, `team`, `zone` or `card` | required for a stored counter; `table` for a derived one | `SCHEMA_MISSING`, `INVALID_VALUE` |
| `counters[].owner_id` | forbidden for `table`; otherwise a seat (`player`), a team, a fixed zone or a card id | none | `INVALID_VALUE` on a `table` counter, `SCHEMA_MISSING` when required and absent, `UNKNOWN_REFERENCE` |
| `counters[].min` | integer or decimal string | required for a stored counter | `SCHEMA_MISSING`, `SCHEMA_TYPE`, `INVALID_VALUE` |
| `counters[].max` | integer or decimal string, `>= min` | no maximum | `INVALID_VALUE` |
| `counters[].initial` | integer or decimal string, `min <= initial <= max` | required for a stored counter | `INVALID_VALUE` |
| `counters[].scale` | integer 0 to 18; descriptive only, never used in arithmetic | none | `INVALID_VALUE` |
| `counters[].rounding` | `floor`, `half_up` or `half_even` | none | `INVALID_VALUE` |
| `counters[].supply_role` | `mint` or `burn` | none | `INVALID_VALUE` |
| `counters[].derived` | `{zone_size: <fixed zone>}` | none | `SCHEMA_UNKNOWN_KEY`, `SCHEMA_MISSING`, `UNKNOWN_REFERENCE` |
| `counters[].visibility` | [visibility block](#visibility-blocks) | `{}` | `INVALID_VISIBILITY` |
| `counters[].for_each` | `seat` or `team` | one instance | `INVALID_VALUE` |

**Writing integers.** A bare YAML integer is parsed into a JavaScript number, which silently loses precision above 2^53 - 1. A bare integer outside the safe range is therefore `INVALID_VALUE` ("write it as a quoted decimal string"), and the quoted form (`"9007199254740993"`) compiles to the exact value. A float is `SCHEMA_TYPE`. Decimal strings match `-?(0|[1-9][0-9]*)`.

**Derived counters.** `derived: {zone_size: stock}` declares a counter whose value is the number of cards in that fixed zone, computed on demand and never stored. A derived counter must not declare `min`, `max`, `initial` or `supply_role` (`INVALID_VALUE` at that key). It cannot be adjusted or transferred and cannot join a conservation group. In the compiled definition it carries `min` and `initial` of `0` (required by the data shape, never read) and a `derivedSpec` of `{kind: zone_size, zone}`; no other derived form exists yet, and `derived: {sum: x}` is `SCHEMA_UNKNOWN_KEY`.

## Conservation groups

A conservation group asserts that the sum of its counters changes only through counters with a `supply_role`.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `conservation_groups[].id` | id; unique | required | `INVALID_VALUE`, `DUPLICATE_ID` |
| `conservation_groups[].counters` | list of counter ids, each either a literal id or `{expand: "<pattern>", for_each: seat \| team}` | required | `UNKNOWN_REFERENCE` for an unknown or derived counter (naming it), `DUPLICATE_ID` for a counter listed twice |

`expand` instantiates the pattern once per seat or team in declaration order, so `{expand: "chips-{seat}", for_each: seat}` lists `chips-north`, `chips-east`, and so on. Members must be stored (non-derived) counters.

## Control

`control` can be left out entirely.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `control.phases` | non-empty list of distinct ids, at most 64 | `[main]` | `INVALID_VALUE` (empty), `DUPLICATE_ID`, `LIMIT_EXCEEDED` |
| `control.initial_phase` | a member of `phases` | `main` when `phases` is omitted; **required** when `phases` is given | `SCHEMA_MISSING`, `INVALID_VALUE` |
| `control.turn_order` | a permutation of the declared seats | the seat declaration order | `INVALID_VALUE` when a seat is omitted, `DUPLICATE_ID` for a repeat, `UNKNOWN_REFERENCE` for an undeclared seat |
| `control.initial_active_seats` | non-empty list of distinct declared seats | the first seat of the turn order | `INVALID_VALUE` (empty), `DUPLICATE_ID`, `UNKNOWN_REFERENCE` |
| `control.pointers` | list of distinct ids | `[]` | `DUPLICATE_ID`, `INVALID_VALUE` |
| `control.enforce_active_seats` | boolean | `false` | `SCHEMA_TYPE` |
| `control.out_of_turn` | list of action kinds that may be proposed out of turn | `[]` | `SCHEMA_TYPE` |

## Meta schemas

A meta schema declares a partition of game-owned state and the reducer that updates it.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `meta_schemas[].id` | id; unique; must not start with `engine.` | required | `INVALID_VALUE`, `DUPLICATE_ID`, `RESERVED_NAME` |
| `meta_schemas[].reducer` | export name of the hook bundle | required | `MISSING_REDUCER` when absent (naming the schema), `INVALID_VALUE` for a name that is not a JavaScript identifier |
| `meta_schemas[].fields` | mapping field to `{type, visibility}` as for card metadata | `{}` | `INVALID_VISIBILITY` (missing or unknown visibility, naming schema and field), `SCHEMA_MISSING` |

The `engine.` prefix is reserved for the engine's own schemas (gates and grants). The compiled schema keeps only the reducer **name** (`reducerRef`); it is bound to a function later (see [game-definitions.md](./game-definitions.md#limitations)).

## View keys

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `view_keys` | non-empty list of distinct members of `card_face`, `zone_membership`, `zone_count`, `zone_order` | all four | `INVALID_VALUE` (empty or unknown key), `DUPLICATE_ID` (repeat) |

These are the keys a game allows to be granted to a participant at run time.

## Hooks and reducers

`hooks` binds game code to engine events. Every name is the **export name** of a function in the hook bundle built from `hooks.module`. This phase builds and hashes the bundle and checks that each name exists; it never runs it.

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `roster_reducer` | export name | absent | `INVALID_VALUE` |
| `hooks.module` | relative path starting `./`, without `..`, ending `.ts` or `.js`, made of `[A-Za-z0-9_.@-]` segments | absent | `INVALID_VALUE` |
| `hooks.validation` | mapping inbound action kind to a name or a non-empty list of names | absent | `INVALID_VALUE` (key not an id, empty list, bad name) |
| `hooks.reaction` | mapping `kind:<k>`, `phase:<p>` or `trigger:<t>` to a name or list | absent | `INVALID_VALUE` (key shape), `UNKNOWN_REFERENCE` (`phase:<p>` names an undeclared phase) |
| `hooks.gate_resolve` | mapping gate schema id to a name or list | absent | `INVALID_VALUE` |
| `hooks.authorization` | a name or a list | absent | `INVALID_VALUE` |

A single name and a one-element list are the same thing; list order is registration order and is part of the definition's identity. The compiled `hookBindings` table uses the keys `validation:<kind>`, `reaction:<key>`, `gate_resolve:<schema_id>` and `authorization:default`. `hooks.module` is a build input only and is not part of the compiled data.

References and the bundle:

| Situation | Error |
|-----------|-------|
| a reducer or hook name is referenced but `hooks.module` is not set | `MISSING_HOOK_MODULE`, once, at the first reference |
| the definition needs a bundle (any reference or `hooks.module`) and none was supplied to the compiler, or the files are not built | `BUNDLE_MISSING`, once |
| a bundle is supplied and a referenced name is not among its exports | `UNKNOWN_HOOK_EXPORT`, one per missing name, naming the export |
| the bundle cannot be built (syntax error, missing module, no exports while hooks are referenced) | `BUNDLE_INVALID` (raised by the bundle build, not the compiler) |

These bundle checks run after all sections, so their errors come last.

## Policies

| Key | Type / range | Default | Errors |
|-----|--------------|---------|--------|
| `policies.cascade_cap` | integer 1 to 256, and not above the engine ceiling `limits.cascade_cap.max` of the server | `16` | `INVALID_VALUE` (outside 1 to 256), `LIMIT_EXCEEDED` (above the engine ceiling) |
| `policies.cost_budgets` | mapping with the keys `validation`, `reaction`, `gate_resolve`, `authorization` to a positive integer, not above the engine ceiling `limits.hook.cost_budget` | `{}` | `SCHEMA_UNKNOWN_KEY` (another key), `INVALID_VALUE` (below 1), `LIMIT_EXCEEDED` |

The engine ceilings come from the server configuration (see [server-config.md](./server-config.md)); the compiler is given them by its caller. A game can lower a limit but never exceed it. An absent `cascade_cap` compiles to 16 without a ceiling check, so a server ceiling below 16 does not make every game that leaves it out fail.

## Visibility blocks

A `visibility` block on a zone, template or counter declares who may see it.

- Keys are `default` or a role: a built-in (`player`, `dealer`, `auditor`, `render`) or one declared under `roles`.
- Values are audiences: `public`, `hidden`, `owner` or `team`.
- `owner` and `team` need an owner: a fixed zone with `owner_id`, a template whose `owner` is not `none`, or a counter that is not `table`-owned.
- An unknown role key, an unknown audience, or `owner`/`team` on an unowned entity is `INVALID_VISIBILITY` at `...visibility.<key>`, naming the entity. A block that is not a mapping, or an audience that is not a string, is `SCHEMA_TYPE`.
- An absent block compiles to `{}`: "no declaration". The projection layer treats that as not visible to external views.

Field visibility (`public`, `subject`, `secret`) on card metadata and meta schema fields is declared per field and is required.

## `for_each` and placeholders

`for_each: seat` (or `team`) on a zone, a counter or an `expand` item creates one instance per declared seat (team), in declaration order. `{seat}` (`{team}`) in `id`, `owner_id` and `expand` is replaced with the seat (team) id. Rules:

- Only `{seat}` and `{team}` exist as placeholders. They are valid only when the matching `for_each` is present: a placeholder without `for_each`, an unmatched brace or an unknown name is `INVALID_VALUE`.
- `for_each: team` in a game that declares no teams is `INVALID_VALUE` at `...for_each`.
- Expanded ids are checked like any other id: charset, uniqueness (`DUPLICATE_ID`), and that references resolve (`UNKNOWN_REFERENCE`).
- The zone limit counts expanded fixed zones and the counter limit counts expanded counters.

## Worked example

A four-seat, two-team trick game that uses every section. It compiles as shown; the doc test in `packages/config` checks it on every run.

```yaml
id: mini-tricks
action_schema_version: 1

roles:
  - { id: spectator, subject: forbidden }

seats:
  list:
    - { id: north, team: ns }
    - { id: east, team: ew }
    - { id: south, team: ns }
    - { id: west, team: ew }
  teams: [ns, ew]

zones:
  - id: stock
    ordering: ordered
    visibility: { default: hidden }
  - id: trick
    ordering: ordered
    visibility: { default: public }
  - id: "hand-{seat}"
    for_each: seat
    owner_id: "{seat}"
    ordering: unordered
    visibility: { default: hidden, player: owner, spectator: hidden }
  - template: meld
    owner: team
    ordering: ordered
    max_instances: 8
    visibility: { default: public }

cards:
  - generate:
      axes:
        - { name: suit, values: [S, H, D, C] }
        - { name: rank, values: { range: [1, 13] } }
      id: "{suit}{rank}"
      type: "{suit}"
      zone: stock
      metadata: { suit: "{suit}", rank: "{rank}" }
      metadata_schema:
        suit: { type: string, visibility: public }
        rank: { type: int, visibility: public }
  - { id: joker, zone: stock }

counters:
  - { id: pot, owner: table, min: 0, initial: 0, visibility: { default: public } }
  - id: "chips-{seat}"
    for_each: seat
    owner: player
    owner_id: "{seat}"
    min: 0
    max: "1000000000000000000000"
    initial: 100
    scale: 2
    rounding: half_even
    visibility: { default: public }
  - { id: bank, owner: table, min: 0, initial: 0, supply_role: mint }
  - { id: stock_size, derived: { zone_size: stock }, visibility: { default: public } }

conservation_groups:
  - id: money
    counters: [pot, { expand: "chips-{seat}", for_each: seat }]

control:
  phases: [deal, play]
  initial_phase: deal
  turn_order: [north, east, south, west]
  initial_active_seats: [north]
  pointers: [button]
  enforce_active_seats: true
  out_of_turn: [chat]

meta_schemas:
  - id: tricks.score
    reducer: reduceScore
    fields:
      points: { type: int, visibility: public }
      note: { type: string, visibility: secret }

roster_reducer: reduceRoster
view_keys: [card_face, zone_membership]

hooks:
  module: ./hooks.ts
  validation: { play_card: validatePlay }
  reaction: { "phase:play": [onTrickComplete], "trigger:setup": setup }
  gate_resolve: { "tricks.pass": resolvePass }
  authorization: [authorize]

policies:
  cascade_cap: 16
  cost_budgets: { validation: 500000, reaction: 2000000 }
```

What it compiles to: 4 seats and 2 teams in the order written; zones `stock`, `trick`, `hand-north` ... `hand-west` (the last four owned by their seat) and one `meld` template; 53 cards (`S1` to `S13`, then `H`, `D`, `C`, then `joker`) all starting in `stock`; counters `pot`, `chips-north` ... `chips-west`, `bank` and the derived `stock_size`; one conservation group listing `pot` and the four chip counters; `rank` metadata as integers and `suit` as strings; hook bindings `validation:play_card`, `reaction:phase:play`, `reaction:trigger:setup`, `gate_resolve:tricks.pass` and `authorization:default`.

## Load-time error codes

Every definition failure carries one of these 22 codes (`DefinitionErrorCode`, with the runtime list `DEFINITION_ERROR_CODES`, exported from `@cge/core`). They are load-time errors: they are never engine error codes returned by `apply`.

### Raised while reading YAML (`parseYaml`)

| Code | Triggered by |
|------|--------------|
| `YAML_SYNTAX` | Text that is not valid YAML; the `detail` ends with ` (line L, column C)`. |
| `YAML_TOO_LARGE` | More than 1 048 576 bytes of UTF-8 (checked before any parsing). |
| `YAML_DUPLICATE_KEY` | A mapping repeating a key at any depth, including through aliases that resolve to the same key. |
| `YAML_FORBIDDEN_FEATURE` | An explicit tag (`!!str`, `!custom`), a merge key `<<`, a non-string key (`1:`), the key `__proto__`, more than one document, an empty document, a `%YAML` directive other than 1.2, non-finite numbers (`.inf`, `.nan`), more than 100 aliases, or aliases that expand beyond the expansion guard (a "billion laughs" document). |

YAML is parsed as **1.2 core schema**: `yes`, `no`, `on` and `off` are strings, not booleans.

### Raised by the compiler (`compileDefinition`)

| Code | Triggered by |
|------|--------------|
| `SCHEMA_UNKNOWN_KEY` | An unknown key at any level (the path is the key's path), or `derived` with anything but `zone_size`. |
| `SCHEMA_TYPE` | A value of the wrong type: a string where a list is expected, a float where an integer is required, a non-mapping root, a float inside a `json` value, a non-string audience. |
| `SCHEMA_MISSING` | An absent required key: `id`, `action_schema_version`, `seats`, a zone's `ordering`, a stored counter's `min`/`initial`, `owner_id` where required, `control.initial_phase` when `phases` is given. |
| `INVALID_VALUE` | A value out of range or not allowed: bad id charset or length, an enum value not in its list, `count: 0`, a `list`/`count` mix, a team without seats, an unsafe integer, `lo > hi`, a malformed placeholder, a `turn_order` that omits a seat, a canonical-profile violation found in the final identity check. |
| `DUPLICATE_ID` | The same id twice in one namespace (reported at the later occurrence, naming the id): seats, teams, zones and templates, counters, cards, roles (also a built-in name), phases, pointers, meta schemas, view keys, conservation groups and their members. |
| `UNKNOWN_REFERENCE` | A reference to an undeclared seat, team, zone, counter, phase or card: a seat's `team`, an `owner_id`, a card's `zone`, a counter group member, `turn_order` and `initial_active_seats` entries, `reaction` keys `phase:<p>`. |
| `INVALID_VISIBILITY` | An unresolvable role key, an unknown audience, `owner`/`team` on an unowned entity, or a field without a valid `public`/`subject`/`secret` visibility. |
| `RESERVED_NAME` | A meta schema id starting with `engine.`. |
| `MISSING_REDUCER` | A meta schema with no `reducer`. |
| `MISSING_HOOK_MODULE` | A reducer or hook reference while `hooks.module` is not set. |
| `UNKNOWN_HOOK_EXPORT` | A referenced name that is not among the exports of the supplied bundle. |
| `BUNDLE_MISSING` | The definition needs a bundle (any reference or a `hooks.module`) and none was supplied; in the filesystem registry, `dist/hooks.js` or its manifest is absent. |
| `UNSUPPORTED_SCHEMA_VERSION` | An `action_schema_version` that this build does not support (any integer other than 1). |
| `LIMIT_EXCEEDED` | A collection above a structural limit (see the table above) or a policy above an engine ceiling. |

### Raised while building or loading game directories

| Code | Triggered by |
|------|--------------|
| `BUNDLE_INVALID` | `buildHookBundle` failing: `hooks.module` missing, malformed or pointing at no file, an esbuild error (syntax error, unresolvable import, a Node built-in import), or a module with no exports while the YAML references hooks. Also a hook manifest that is not `{"exports": [...]}` when the registry loads a game. |
| `GAME_YAML_MISSING` | A game directory without a readable `game.yaml`. |
| `GAME_ID_MISMATCH` | A directory whose name differs from the `id` in its `game.yaml`. |
| `SEARCH_PATH_MISSING` | A configured search path that does not exist or is not a directory. |

The registry also reports `DUPLICATE_ID` (path `<dir>/id`) when two directories declare the same game `id`.

## What this schema does not do yet

- **Visibility has no run-time effect yet.** The `roles`, `visibility`, field `visibility` and `view_keys` declarations are validated, stored and part of a definition's identity. Turning them into who can see what, and the meaning of the `owner` and `team` audiences and of custom roles, belongs to the visibility and projection phase (Phase 3).
- **Hooks and reducers are not executed.** The bundle is built, hashed and checked by name only. Running hooks, binding reducer functions to the compiled definition, time and cost limits belong to Phase 4. Until then a `meta` action for a declared schema fails with `REDUCER_ERROR` ("reducer not bound").
- **Derived counters** are limited to the size of one fixed zone.
- **Gate rules and timeouts** (quorum, `timeout_policy`), `carry_over` data and setup parameters are not part of the definition.
- **Old action-schema versions** are not upgraded: only version 1 is accepted.
- The `DefinitionRegistry` described in [game-definitions.md](./game-definitions.md) is a filesystem adapter built once at start-up; a registry service (remote bundles, hot reload) is a later phase.
