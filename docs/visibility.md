# Visibility and projection

The engine's state is omniscient: it holds every card, every hidden counter and every sealed submission. Nobody outside the engine ever receives that state. A **projector** turns it into a `View` (a snapshot of what one viewer may see), a `Delta` (what one viewer may learn from one committed transaction) and a role-filtered log entry. This page defines exactly what each viewer receives, how a game author controls it, and which guarantees the types and tests give.

The guarantee is **fail closed**. Absent declarations hide the entity, an unknown role or subject is an error and never a default view, and a privileged role that the game did not register is refused. A typo can make something invisible; it cannot make something visible.

The functions live in `packages/core/src/visibility` and are exported from `@cge/core`. They are pure: they read nothing but their arguments (no clock, randomness or I/O), never mutate them and return the same value for the same input. The declarations they interpret are the `visibility`, `roles` and field `visibility` keys of `game.yaml` ([game-definition-schema.md](./game-definition-schema.md)). The replay side of the engine (export, replay, fork) is in [replay-package.md](./replay-package.md).

## Contents

- [The entitlement model](#the-entitlement-model)
- [Viewers and roles](#viewers-and-roles)
- [Declaring visibility](#declaring-visibility)
- [What a viewer sees](#what-a-viewer-sees)
- [The View](#the-view)
- [Deltas and log entries](#deltas-and-log-entries)
- [Grants and `wouldReveal`](#grants-and-wouldreveal)
- [Fail-closed types](#fail-closed-types)
- [Recipes](#recipes)
- [Limits and the accepted side channel](#limits-and-the-accepted-side-channel)
- [Worked examples](#worked-examples)

## The entitlement model

A viewer is entitled to a **key** on an **entity**. The keys are:

| Key | What it reveals |
|-----|-----------------|
| `zone_count` | how many cards a zone holds |
| `zone_membership` | which card ids a zone holds, with their orientation |
| `zone_order` | the order of an ordered zone's members |
| `card_face` | a card's `type` and its metadata fields (each field has its own rule) |

Entitlement comes from exactly two sources, and they only ever add:

1. **Static rules.** The `visibility` block of the zone, zone template or counter, resolved for the viewer's role (see [Declaring visibility](#declaring-visibility)). For a zone, one rule entitles all three zone keys together (count, membership, order); `card_face` is derived from it and from the card's orientation.
2. **Active grants.** A grant names keys on a target (a card, a zone or the top card of an ordered zone) and a grantee. It extends entitlement for those keys only. There is no deny layer: a grant never removes anything, never applies to `dealer` or `auditor`, and never widens what a privileged role has.

Everything else (the session id, delegations, receipts, principal ids and event ids) is never part of a view.

## Viewers and roles

A viewer is `{role, subject?}`. The `subject` is always a **seat id**; the host maps players to seats before calling the projector. The host has already authenticated the caller and decided that the caller may act as this role and subject; the projector does not authenticate.

| Role | Subject | Meaning |
|------|---------|---------|
| `player` | required | A seated participant. Receives what its seat is entitled to |
| `render` | optional | A display. With a subject it is treated like that seat for `owner`/`team` audiences and `subject` fields; without one, only `public` content |
| `dealer` | forbidden | Privileged. Denied until the game registers it |
| `auditor` | forbidden | Privileged. Denied until the game registers it |
| custom | as declared | Any role under `roles:` in `game.yaml`, with its own subject rule |

The engine ships no spectator. A game that wants one declares it (see [the spectator recipe](#a-spectator-role)). A custom role id equal to a built-in id is rejected by the compiler with `RESERVED_NAME`.

**Registered privileged roles.** `dealer` and `auditor` are registered if and only if some zone, zone template or counter `visibility` block of the definition has an entry keyed by that role (any audience, even `hidden`). The `default` entry never registers them and never entitles them. The registration is data in the definition, so it survives replay and edge nodes.

`buildRoleRegistry(def)` returns the role table and the registered privileged roles; it is deterministic and deeply frozen. `validateViewer(registry, state, viewer)` checks a viewer in this order and returns the first failure:

| Order | Check | Error code |
|-------|-------|-----------|
| 1 | The role is a built-in or declared role (the empty string is unknown) | `UNKNOWN_ROLE` |
| 2 | A subject is given only for roles that allow one | `SUBJECT_NOT_ALLOWED` |
| 3 | A subject is given for roles that require one, and it is a declared seat | `UNKNOWN_SUBJECT` |
| 4 | `dealer` / `auditor` are registered | `VIEW_DENIED` |

The `detail` of these errors names only the role, subject and seat ids the caller supplied, never any hidden value. Real messages from the four-seat trick-taking definition used below:

```
{"role":"wizard"}                           UNKNOWN_ROLE: unknown role "wizard"
{"role":"player"}                           UNKNOWN_SUBJECT: role "player" requires a subject seat
{"role":"player","subject":"ghost"}         UNKNOWN_SUBJECT: subject "ghost" is not a declared seat
{"role":"dealer","subject":"north"}         SUBJECT_NOT_ALLOWED: role "dealer" takes no subject, got "north"
{"role":"dealer"} (not registered)          VIEW_DENIED: role "dealer" is not registered by this definition
```

Every projector function runs `validateViewer` first, so none of them accepts a missing role and none defaults one.

## Declaring visibility

`buildVisibilityPolicy(def)` precompiles, for every zone, zone template and counter, a lookup from role to audience. The lookup is: the entry keyed by the viewer's role, otherwise the `default` entry **for non-privileged roles only**, otherwise nothing. `resolveAudience(rules, role)` is that rule on its own.

| Audience | Entitles the viewer when |
|----------|--------------------------|
| `public` | always |
| `hidden` | never |
| `owner` | the viewer has a subject seat `s` and the entity's owner is `s`, the team of `s`, or the player seated at `s` |
| `team` | the viewer has a subject seat `s` that has a team, and the owner is that team or a seat (or player) on that team |

Rules that follow from this and that game authors rely on:

- **No declaration means hidden.** A zone whose `visibility` is `{}` (or absent) is hidden from every role, including the owner and a registered auditor that has entries elsewhere.
- `owner` and `team` never entitle a viewer without a subject. A `render` viewer without a subject therefore never matches them.
- A seat without a team has no teammates, so `team` never entitles it (not even for its own entity); use `owner` for "my own".
- A player-owned zone is resolved through the roster at query time.
- `dealer` and `auditor` see only what an entry keyed by their own name declares. `default: public` does not show them anything.

The `isEntitled(audience, owner, viewer, state)` function applies one audience to one owner. The grant-aware helpers (`buildEntitlementContext`, `isEntitledToZoneKey`, `isEntitledToCardKey`, `isStaticallyEntitledToZoneKey`, `isStaticallyEntitledToGrant`, `withoutGrants`, `expandGrantee`, `isGrantee`, `isGrantInScope`, `resolveGrantTarget`) are exported for the code that builds on the projector; ordinary callers use the four projector functions.

## What a viewer sees

### Zones

For a zone `Z` whose audience entitles the viewer, the view carries `Z`'s count, its members (ids with orientation) and their order together. An ordered zone lists members in zone order; an unordered zone lists them sorted by id. A zone the viewer is not entitled to is absent from `zones` entirely (no empty placeholder, so absence does not even reveal that the zone exists).

Grants add less than a static rule: a `zone_count` grant gives `count` only; a `zone_membership` grant gives the members sorted by id with `orderKnown: false`; `zone_order` adds the order only together with membership.

### Cards and faces

A listed card shows its `face` (`type` and `metadata`) only when the viewer has `card_face` for it:

- the zone's audience entitles the viewer through `owner` or `team` (a private zone: your own hand is readable regardless of orientation), or
- the zone's audience is `public` and the card is `face_up`, or
- a grant gives `card_face`.

A `face_down` card in a `public` zone is listed by id and orientation, nothing more.

### Metadata fields

Each card metadata field declares `public`, `subject` or `secret`. Inside a visible face:

| Field visibility | Appears when |
|------------------|--------------|
| `public` | whenever the face does |
| `subject` | the face is visible **and** the viewer has a subject seat |
| `secret` | only for a registered privileged role (`dealer`, `auditor`) |
| undeclared | never |

### Counters

A **stored** counter appears, as a decimal string, if its own visibility block entitles the viewer (an `owner` or `team` audience resolves against the counter's owner). Values are strings because counters are `bigint`: `10^30` is exactly `"1000000000000000000000000000000"`.

A **derived** counter (a `zone_size` over a zone) follows one of two rules:

- If it declares its own visibility, that block governs it, **even when its input zone is hidden**. A public `stock_size` over a hidden stock is the intended way to publish a deck size while hiding the deck.
- If it declares none (`{}`), it inherits the `zone_count` entitlement of its input zone: visible over a public zone, absent over a hidden one, visible only to the owner over an `owner` zone.

A declared block that does not cover the viewer's role hides the counter; it does not fall back to inheritance.

### Engine-owned sections

`seq`, `lifecycle`, `control` (`phase`, `turnOrder`, `activeSeats`, `direction`, `pointers`), `roster` (per seat: `status`, `team?`, `player?`) and `outcome` are public to every viewer that is not denied. The game cannot yet declare otherwise.

### Meta partitions

For each declared `meta` schema, only fields whose declared visibility entitles the viewer appear. `public` always. `secret` only for a registered privileged role. A `subject` field must hold an object whose keys are all seat ids: the viewer sees the entry for its own seat (a registered `auditor` sees all entries); any other value shape is omitted, and an empty projection omits the field. A partition with no visible field is absent from `meta`.

### Gates

An open gate appears as `{schemaId, expectedSeats, submitted}`: who has submitted is public, what they submitted is not. A seat that has submitted sees its own submission; a registered `auditor` sees every submission of open and resolved gates. A `dealer`, a subject-less `render` or any other seat never sees a sealed payload. A resolved gate appears as `{schemaId, expectedSeats}` plus the same own/auditor submissions.

### Grants

`View.grants` lists a grant if the viewer is a grantee, or is statically entitled (ignoring all grants) to every key the grant names on its target. A grant's existence is therefore visible only to those who could already see its target, plus the grantee.

A grant has a target (`{kind: "card", card_id}`, `{kind: "zone", zone_id}` or `{kind: "top", zone_id}` for the card currently first in an ordered zone), keys (a subset of the game's `view_keys`), a grantee and a scope:

| Grantee | Expands to |
|---------|-----------|
| a seat id | that seat |
| `all_seated` | every seat whose status is `seated` |
| `team:<id>` | every seat of that team |

| Scope | Applies |
|-------|---------|
| `until_revoked` | while the grant exists in the state |
| `once` | while it exists; the host consumes it once it has revealed something (see [`wouldReveal`](#grants-and-wouldreveal)) |
| `until_seq(n)` | only while the state's `seq` is below `n` |

A grant applies to a viewer only if the viewer's subject seat is in the expanded grantee set and its role is neither `dealer` nor `auditor`. A key with no meaning for the target (for example `zone_order` on a card) has no effect. A card-level grant makes that card appear in its zone's member list even if the rest of the zone is hidden; with `card_face` it also carries its face.

## The View

`projectView(def, state, viewer)` returns a `Result<View, EngineError>`: one of the viewer errors above, or a `View` of the state at `state.seq`. It is plain JSON (no `bigint`, no `undefined`, no functions): `JSON.parse(JSON.stringify(view))` deep-equals it. Key order is deterministic (`VIEW_SECTION_ORDER`), id-keyed records are in ascending UTF-16 order, and equal inputs give deep-equal views.

```ts
interface View {
  seq: number;
  lifecycle: "active" | "completed" | "terminated";
  viewer: { role: string; subject?: SeatId };
  zones: Record<ZoneId, ZoneView>;        // only entitled zones
  counters: Record<CounterId, string>;    // decimal strings, only entitled counters
  control: { phase; turnOrder; activeSeats; direction: 1 | -1; pointers };
  roster: Record<SeatId, { status; team?; player? }>;
  meta: Record<string, JsonValue>;        // only visible fields; empty partitions absent
  gates: { open: Record<GateId, GateView>; resolved: Record<GateId, GateView> };
  grants: Record<GrantId, GrantView>;     // {target, keys, grantee, scope}
  outcome?: JsonValue;
}
interface ZoneView { ordered: boolean; owner?: string; count?: number;
                     members?: CardView[]; orderKnown?: boolean }
interface CardView { id: CardId; orientation: "face_up" | "face_down";
                     face?: { type?: string; metadata: Record<string, JsonValue> } }
interface GateView { schemaId: string; expectedSeats: SeatId[];
                     submitted?: SeatId[]; submissions?: Record<SeatId, JsonValue> }
```

A statically entitled zone always carries `count`, `members` and `orderKnown: true` (also for unordered zones, whose members are sorted by id). A zone reached only through grants may carry less: `count` absent, `orderKnown: false`. `View` input is never shared with the output: the projector copies, so editing a view cannot change the state.

## Deltas and log entries

A `Delta` tells one viewer what one committed transaction changed, as far as the viewer is entitled to know. It is computed from the state before (`pre`), the state after (`post`) and the transaction as an opaque `PrivilegedBatch`:

```ts
projectDelta(def, pre, post, batch, viewer): Result<Delta, EngineError>
projectLogEntry(def, pre, post, batch, viewer): Result<Delta, EngineError>   // identical result
```

`projectLogEntry` returns exactly what `projectDelta` returns for the same arguments, so one implementation serves queries, outbound events and the role-filtered log. Neither ever outputs principal ids, event ids or receipts. If `post.seq` is not `pre.seq + 1`, or the batch's `seq` is not `post.seq`, both return `REPLAY_INVALID` (`batch does not match pre/post`); they never re-apply the batch.

```ts
interface Delta {
  seq: number;                              // = post.seq
  entries: DeltaEntry[];                    // card events, in action order
  zoneCounts: Record<ZoneId, number>;       // new counts the viewer may know
  counters: Record<CounterId, string>;      // new values the viewer may read
  control?; roster?; meta?; gates?; grants?; lifecycle?; outcome?   // present only when changed
}
type DeltaEntry =
  | { i; kind: "move"; card_id?; from_zone?; to_zone?; from_position?; to_position?; face? }
  | { i; kind: "flip"; card_id; orientation; face? }
  | { i; kind: "shuffle"; zone; permutation? }
  | { i; kind: "set_metadata"; card_id; fields }
  | { i; kind: "zone_create" | "zone_destroy"; zone_id };
```

`i` is the index of the action in the committed transaction, so gaps are normal. The rules per entry:

- **`move`:** `card_id` if the viewer is membership-entitled to the source zone (in `pre`) or the destination zone (in `post`); `from_zone` and `to_zone` each only if entitled to membership of that zone; a position only if entitled to the zone's order; `face` only if entitled to `card_face` for the card in `post`. If neither end is visible the entry is omitted.
- **`flip`:** `card_id` and `orientation` for a membership-entitled viewer; `face` by the card-face rule.
- **`set_metadata`:** only for a viewer that can see the card and its face, and only the written fields the viewer may see; no empty entries.
- **`shuffle`:** the zone for a membership-entitled viewer; the `permutation` only for a viewer entitled to the zone's order. A shuffle of a hidden stock is invisible to a player.
- **`zone_create` / `zone_destroy`:** the zone id if the zone's rule entitles membership.
- **Counters:** the amount of an adjust or transfer is never exposed; `counters` carries only new values the viewer could read in a `View`. A transfer from a public counter to a hidden one shows only the public counter's new value.
- **Other sections** are the viewer's own projection of the changed value: `control`, `lifecycle`, `outcome` when changed; `roster` for changed seats (`null` for a removed one); `meta` and `gates` for changed partitions or gates, projected by the same rules as the view (a gate submission gives non-entitled viewers the new public `submitted` list, never the payload); `grants` for added grants the viewer may see and `null` for removed or consumed ones it could see before.
- Entitlements for a delta use the **union of the grants in `pre` and `post`**, so a `once` grant consumed by this very transaction still applies to it. Source-side facts use `pre`, destination-side facts use `post`.

**Consistency.** Folding the deltas onto `projectView(pre)` for a viewer reproduces `projectView(post)` for that viewer, with documented exceptions: facts revealed only by a `once` grant consumed in that transaction (in the delta, absent from the next view), content that appears only because a grant was added or a `top` grant re-resolved (the `grants` entry and the next view carry it), removals when a grant ends (`until_seq`) or a card leaves a granted zone, and the orientation of a card that newly enters the viewer's view (a `move` entry has no orientation until a `flip` or the next view).

A `move` is a public event for whoever is entitled to either end at that moment: a card that passes through a zone the viewer can see in the middle of a transaction is named in the delta even if it ends in a hidden zone.

## Grants and `wouldReveal`

The kernel stores grants and expires them; deciding **when** a `once` grant has done its job belongs to the host's commit pipeline. `wouldReveal` is the pure predicate it calls:

```ts
wouldReveal(def, pre, post, batch, grantee?): readonly GrantId[]
```

It returns the ids, sorted ascending, of the `once` grants **present in `pre`** whose removal would change the projected delta of at least one seat in the grant's expanded grantee set (evaluated as role `player`, optionally restricted to the seat `grantee`). Each grant is tested alone; two identical redundant grants are both omitted, because removing one changes nothing. A grant created by the batch itself is never returned, and a non-`once` grant is never returned. A batch that is not the transaction between `pre` and `post` returns `[]`.

The host then commits the batch together with `engine.grant_consume` for each returned id. The delta of that commit, built with the union of grants, contains the revealed face; the next `projectView` no longer shows the grant or the face.

Example over the trick-taking definition below, with a `once` grant of north's hand (`zone_membership` and `card_face`) to east:

```
grant:  {"grant/1/2": {target: {kind: zone, zone_id: hand-north}, keys: [zone_membership, card_face],
                        grantee: east, scope: {kind: once}}}
batch moving north-1 out of the hand and flipping it face up:  wouldReveal -> ["grant/1/2"]
batch that only adjusts the pot:                               wouldReveal -> []
```

## Fail-closed types

`View` and `Delta` carry a unique-symbol brand (type-level only, no runtime property). A `Snapshot<SessionState>` is not assignable to a `View`, a `View` is not assignable to a `Snapshot`, and a hand-written object literal is assignable to neither. The brand symbols are not exported, and no function other than the projector returns a `View` or `Delta`. The omniscient snapshot therefore cannot be passed where a view is expected, and the compiler says so.

A `PrivilegedBatch` is an opaque handle to a committed transaction. `sealBatch(transaction)` creates one; its payload lives in a module-private `WeakMap`, so the handle has no enumerable property, no symbol, `JSON.stringify` yields `{}` and `structuredClone` or spread lose the payload. Only the projector and the replayer can open one, through an `openBatch` function that is never exported from the package. A dependency-cruiser rule, `core-privileged-batch-opener`, fails `pnpm depcheck` if any file outside `packages/core/src/visibility` and `packages/core/src/replay` imports the module that holds it. The raw log is privileged; the batch type makes sure it can leave the engine only as a `Delta`.

## Recipes

### A spectator role

The engine ships no spectator. Declare one as a custom role that takes no subject, and key `visibility` entries by it:

```yaml
roles:
  - { id: spectator, subject: forbidden }

zones:
  - id: discard
    ordering: ordered
    visibility: { default: hidden, spectator: public }
  - id: "hand-{seat}"
    for_each: seat
    owner_id: "{seat}"
    ordering: unordered
    visibility: { default: hidden, player: owner }
```

`projectView` for `{role: "spectator"}` then shows the discard pile (faces of face-up cards) and no hand; `{role: "spectator", subject: "north"}` is `SUBJECT_NOT_ALLOWED`. Roles are declared in the definition only; no function registers a role at session creation or at run time, so the role table is reproducible from the pinned definition id on every node and in replay tooling.

### Hiding card identity: opaque ids

**Card ids are identity, not secrecy.** A viewer entitled to a zone's membership sees the real card ids in it. The engine does not alias or rename ids: doing so would break the identity the log and replay depend on. A game whose rules require that a card's identity stay unknown even though its position is visible (a face-down card that moves between public zones, say) must use opaque ids in its definition (`c-0417`, not `ace-of-spades`), keep the zone that holds the real mapping hidden, and publish only counts through a derived counter such as `stock_size`. The semantic meaning of the card lives in a `secret` metadata field that only a registered privileged role can read. Do not put the identity in the id.

## Limits and the accepted side channel

- **The notification is a side channel.** A transaction made only of grants or sealed submissions still advances `seq`, and every subscriber is told that something happened. A viewer entitled to nothing receives a delta with `entries: []` and nothing else (a sealed submission shows only the new public `submitted` list). The timing and existence of the notification are an accepted channel: the content is hidden, the fact of a commit is not.
- **A face-down card that moves is named.** `move` entries name the card to anyone entitled to either end, as described above. Hide the identity with opaque ids if that matters.
- **Control, roster and outcome have no declarations yet.** They are public to every non-denied viewer.
- **Grant selectors** are a single card, a single zone or the top of an ordered zone. There are no ranges or filters.
- **Deltas carry no grant-derived content.** A newly added grant, a re-resolved `top` grant and the end of an `until_seq` grant change what the next `View` contains; the delta carries the `grants` entry, not the content.
- **Errors never carry hidden values.** `detail` of a viewer error names only caller-supplied ids. Replay errors are operator-facing and may name card, zone and counter ids but never hidden metadata or sealed payloads.

Measured costs at the engine's size floor (14 seats, 4 teams, 700 cards, 64 zones, 40 counters): a `projectView` takes about 1 ms (limit 100 ms) and serialises to 9-35 KB (82 KB when every zone is public and every card face up); a `projectDelta` of 20 moves takes about 0.1 ms; `wouldReveal` with five `once` grants takes about 3 ms. These are regression bounds, not product targets.

## Worked examples

All examples use the **four-seat trick-taking definition**: seats `north`, `east`, `south`, `west`; teams `ns` (north, south) and `ew` (east, west); players `pn`, `pe`, `ps`, `pw`.

| Entity | Declaration |
|--------|-------------|
| `hand-<seat>` (unordered, owned by the seat) | `{default: hidden, player: owner}` plus `auditor: public` in the examples below |
| `trick`, `discard` (ordered) | `{default: public}` |
| `stock` (ordered) | `{default: hidden}` plus `dealer: public` in the examples below |
| cards `<seat>-1`, `<seat>-2`, `t1`, `t2`, `d1`, `k1`..`k3` | type `playing`; metadata `suit` (public), `own` (subject), `key` (secret), `extra` (undeclared) |
| `pot` | public |
| `chips-<seat>` (owned by the seat) | `{player: owner}` |
| `stock_size` (derived, `zone_size` of `stock`) | `{default: public}` |

Initial layout: each hand holds its seat's two cards; `trick` holds `t1`, `t2`; `discard` holds `d1`; `stock` holds `k1`, `k2`, `k3`. Every card starts face down. In the examples `t1`, `d1` and `north-1` have been flipped face up. Registering the privileged roles is the only change from the plain game: `auditor: public` on every hand and `dealer: public` on the stock. (Without those entries `dealer` and `auditor` get `VIEW_DENIED`.)

Each block lists the zones in the viewer's `View` as `zone: count, members (orientation, face metadata)`.

### `player` (subject required)

A player sees its own hand with faces, every public zone with faces of face-up cards only, its own chips, and the published stock size. It sees no other hand and no stock.

```
player / north
  discard    count 1   d1 (face_up, face {own: 7, suit: hearts})
  hand-north count 2   north-1 (face_up, face ...), north-2 (face_down, face {own: 7, suit: hearts})
  trick      count 2   t1 (face_up, face ...), t2 (face_down, no face)
  counters   chips-north "100", pot "0", stock_size "3"

player / east
  discard    count 1   d1 (face_up, face {own: 7, suit: hearts})
  hand-east  count 2   east-1 (face_down, face ...), east-2 (face_down, face ...)
  trick      count 2   t1 (face_up, face ...), t2 (face_down, no face)
  counters   chips-east "100", pot "0", stock_size "3"
```

Note that `east-1` is face down but east still sees its face: an owner sees its own hand regardless of orientation. Neither player sees `key` (secret) or `extra` (undeclared). `own` is a `subject` field, shown because both have a subject seat.

The same move as a delta. North plays `north-1` from its hand to position 2 of the trick (it is face up):

```
north: entries [move north-1 hand-north -> trick @2, face {own: 7, suit: hearts}]
       zoneCounts {hand-north: 1, trick: 3}
east:  entries [move north-1 -> trick @2, face {own: 7, suit: hearts}]       (no from_zone: east cannot see hand-north)
       zoneCounts {trick: 3}
```

Later, east draws `k1` from the stock while the pot gains 5:

```
north (and south): entries []   zoneCounts {}   counters {pot "5", stock_size "2"}
east:              entries [move k1 -> hand-east, face ...]   zoneCounts {hand-east: 3}   counters {pot "5", stock_size "2"}
```

North learns only the public numbers; the stock is hidden, so the move has no visible end for north, yet `stock_size` falls from 3 to 2 because that counter declares its own public visibility.

### `render` (subject optional)

A display without a subject sees only what is public to everyone. With a subject it behaves like that seat for audiences that need one.

```
render (no subject)
  discard count 1   d1 (face_up, face {suit: hearts})
  trick   count 2   t1 (face_up, face {suit: hearts}), t2 (face_down, no face)
  counters pot "0", stock_size "3"

render / north
  discard count 1   d1 (face_up, face {own: 7, suit: hearts})
  trick   count 2   t1 (face_up, face {own: 7, suit: hearts}), t2 (face_down, no face)
  counters pot "0", stock_size "3"
```

Two differences matter. The subject-less render has no `own` field (a `subject` field needs a subject seat). And even `render / north` does not get north's hand or chips, because those declare `player: owner` and no `render` entry, and `default: hidden` covers `render`: a role needs its own entry to match an owner rule. A game that wants a seat-scoped display declares `render: owner` on the hands.

Delta of north's play for the subject-less render: `entries [move north-1 -> trick @2, face {suit: hearts}]`, `zoneCounts {trick: 3}`; for the draw of `k1`, only `counters {pot "5", stock_size "2"}`.

### `dealer` (no subject, privileged)

Registered by `dealer: public` on the stock. The dealer sees the stock and nothing else: not the `default: public` zones, not the counters (`default` never entitles a privileged role).

```
dealer
  stock   count 3   k1 (face_down), k2 (face_down), k3 (face_down)      (no faces: public zone, cards face down)
  counters {}
```

Dealing, from the dealer's side: for the draw of `k1` to east, `entries [move k1 from stock @0]` (`from_zone` and `from_position` only; the destination hand is hidden from the dealer) and `zoneCounts {stock: 2}`. North's play from its hand to the trick gives the dealer `entries []`. An unregistered dealer gets `VIEW_DENIED`.

### `auditor` (no subject, privileged)

Registered by `auditor: public` on every hand. The auditor sees all four hands, nothing else, and sees the `secret` field of a face-up card.

```
auditor
  hand-east  count 2   east-1 (face_down), east-2 (face_down)
  hand-north count 2   north-1 (face_up, face {key: k-secret, suit: hearts}), north-2 (face_down)
  hand-south count 2   south-1 (face_down), south-2 (face_down)
  hand-west  count 2   west-1 (face_down), west-2 (face_down)
  counters {}
```

The auditor's face rule is the public-zone rule: a face-down card in an auditor-visible zone is listed without a face. The auditor gets `key` (secret) but not `own` (subject needs a subject seat, and the auditor has none) and never `extra`. North's play gives the auditor `entries [move north-1 from hand-north]` and `zoneCounts {hand-north: 1}`: it sees the card leave the hand but not the trick it enters. The draw of `k1` gives `entries [move k1 to hand-east]` and `zoneCounts {hand-east: 3}`. Sealed gate submissions are the exception that makes an auditor special: it sees all of them, open and resolved.

### A grant in action

With a `once` grant of north's hand (`zone_membership` and `card_face`) to east, `player / east` sees north's hand without a count, with `orderKnown: false`:

```
hand-north  (no count)  orderKnown false   north-1 (face_down, face {own: 7, suit: hearts}), north-2 (face_down, face ...)
grants      grant/1/2 -> {target: zone hand-north, keys [zone_membership, card_face], grantee east, scope once}
```

When north then plays `north-1` and flips it, east's delta (computed with the union of grants) shows the whole move with `from_zone: hand-north` and the face; west, with no grant, sees the card enter the trick (and be flipped) but not where it came from. After the host consumes the grant, east's next view no longer shows it.

## Functions, at a glance

| Function | Purpose |
|----------|---------|
| `buildRoleRegistry`, `validateViewer` | role table, viewer validation |
| `buildVisibilityPolicy`, `resolveAudience`, `isEntitled` | declarations compiled to a role to audience lookup |
| `projectView` | the view of a state for a viewer |
| `projectDelta`, `projectLogEntry` | what a transaction tells a viewer |
| `wouldReveal` | which `once` grants a transaction consumes |
| `sealBatch` | wrap a committed transaction as a `PrivilegedBatch` |

The package side of the engine takes the same batches: `encodePackage`, `decodePackage`, `buildPackage` and `decodeCanonical` write and read replay packages; `rebuild`, `advance`, `createReplayer` and `forkFromSeq` replay and fork them; `assertUpgraderChain`, `CURRENT_ACTION_SCHEMA_VERSION` and `PACKAGE_UPGRADERS` govern old formats. Their reference is [replay-package.md](./replay-package.md).
