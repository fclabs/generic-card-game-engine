# Magic: The Gathering - Rules Summary (core 2-player game)

Two players each build a deck of spell and land cards and cast them using mana to reduce the opponent's life total to 0 (or otherwise defeat them). This is a condensed, engine-oriented summary. "CR" refers to the official Comprehensive Rules (version dated 2026-09-25 was current when written); section numbers are given where useful. The CR is authoritative for any detail omitted here.

## 1. Components (deck, players, setup)

- **Players:** 2 in the core game (multiplayer is covered in Appendix A).
- **Deck (Constructed):** minimum 60 cards; at most 4 copies of any card of the same English name, except basic lands (and cards that say otherwise). Optional sideboard of up to 15 cards (between games only).
- **Deck (Limited):** minimum 40 cards built from a pool of opened/drafted cards; no copy limit.
- **Card characteristics (CR 2xx):** name, mana cost, color(s), type line (supertypes, card types, subtypes), rules text, power/toughness (creatures), loyalty (planeswalkers), defense (battles), expansion symbol, etc.
- **Card types (CR 300-):** Land, Creature, Artifact, Enchantment, Planeswalker, Battle, Instant, Sorcery (plus Kindred/Tribal, Dungeon, Plane, etc. in special formats). Permanent types: artifact, battle, creature, enchantment, land, planeswalker. Instants and sorceries are not permanents; they go to the graveyard on resolution.
- **Supertypes:** basic, legendary, snow, world, ongoing.
- **Colors (CR 105):** white, blue, black, red, green. Colorless is not a color.
- **Counters and tokens:** tokens are permanents created by effects (they cease to exist when they leave the battlefield); counters (+1/+1, loyalty, poison, etc.) are markers on objects or players.
- **Zones (CR 400):**
  - **Library** (hidden, ordered, private per player), **Hand** (hidden, per player), **Battlefield** (shared, public), **Graveyard** (public ordered pile per player), **Stack** (shared; spells and abilities waiting to resolve), **Exile** (shared), **Command** (commander/emblems etc.).
  - "Ante" is not part of the game. Objects moving zones become new objects with no memory of the old one (CR 400.7).

## 2. Objective

A player wins by being the last player in the game. The usual way: reduce the opponent's life total to 0 or less. Other ways to lose or win are in section 7 (CR 104).

## 3. Setup and dealing (CR 103)

1. Each player presents a deck as their library; shuffle; opponent may cut/shuffle.
2. Determine the starting player randomly (e.g. coin flip/die). In later games of a match, the loser of the previous game chooses (usually plays first).
3. Each player starts with **20 life** (CR 103.4) and a starting hand size of 7.
4. Each player draws 7 cards. Starting with the starting player, each player decides whether to **mulligan**. Current (London) mulligan, CR 103.5: shuffle hand into library, draw a new 7, then (after finally keeping) put a number of cards from hand on the bottom of the library equal to the number of mulligans taken. A player who keeps cannot mulligan again.
5. Cards that begin the game on the battlefield (e.g. via opening-hand effects) are put there, starting player first.
6. The starting player takes the first turn. In a 2-player game the starting player **skips the draw step of their first turn** (CR 103.8a); in multiplayer no player skips it (CR 103.8c).

## 4. Turn structure / gameplay (CR 5xx)

Players alternate turns. The player whose turn it is is the **active player (AP)**; others are **nonactive players (NAP)**. A turn has 5 phases in order (CR 500):

### 4.1 Beginning phase (CR 501)
1. **Untap step (502):** AP untaps all their permanents simultaneously (phasing is also handled here; phasing happens first). No player receives priority; no spells or abilities are cast/activated (triggers wait until upkeep).
2. **Upkeep step (503):** Upkeep triggers go on the stack; players receive priority.
3. **Draw step (504):** AP draws a card (turn-based action; skipped for the first player's first turn in 2-player games), then triggers go on the stack and players receive priority.

### 4.2 Precombat main phase (505)
- AP may play **one land** per turn (only when the stack is empty, during their own main phase, and they have priority); lands are played, not cast, and do not use the stack.
- AP may cast sorceries, creatures, artifacts, enchantments, planeswalkers, battles (only with an empty stack in their own main phase) and instants/flash spells (any time they have priority); may activate abilities.
- Sagas/other turn-based actions (e.g. Saga lore counter) occur at the start of precombat main.

### 4.3 Combat phase (506-511)
1. **Beginning of combat step (507):** triggers; priority.
2. **Declare attackers step (508):** AP chooses which untapped creatures that have been under control since the turn began (or have haste) attack, and which player/planeswalker/battle each attacks. Attackers tap (unless vigilance). Attack triggers go on stack; priority. If no creatures attack, the declare blockers and damage steps are skipped (the phase goes to end of combat).
3. **Declare blockers step (509):** NAP (defending player) chooses blockers from untapped creatures. Each blocker blocks one attacker; multiple creatures may block the same attacker; an attacker can't be blocked by creatures if restrictions (flying, etc.) apply. AP then orders blockers for each attacker that is blocked by multiple creatures (damage assignment order, CR 509.2; note newer CR versions have changed how this ordering works, check current CR). Triggers; priority.
4. **Combat damage step (510):** Each attacking and blocking creature simultaneously deals combat damage equal to its power. Unblocked attackers damage the player/planeswalker/battle attacked. A blocked attacker assigns damage among its blockers (lethal damage to earlier ones before later ones in order, with deathtouch/trample modifications). Creatures with first strike or double strike cause an extra **first-strike combat damage step** before the regular one (CR 510.4); only creatures with first strike or double strike deal damage in the first step, those with double strike (and ones without first strike) deal in the regular step. State-based actions are checked and then priority is given after each damage step.
5. **End of combat step (511):** "end of combat" triggers; priority; then "until end of combat" effects end and creatures are removed from combat.

### 4.4 Postcombat main phase (505)
Same as precombat main phase. The land-per-turn limit is shared across both main phases.

### 4.5 Ending phase (512-514)
1. **End step (513):** "at the beginning of the end step" triggers; priority.
2. **Cleanup step (514):** (a) AP discards down to **maximum hand size (7)**; (b) simultaneously all damage on permanents is removed and "until end of turn"/"this turn" effects end. These are turn-based actions, performed without priority. If state-based actions need to be checked or triggers are waiting, players receive priority and then another cleanup step occurs.

### 4.6 Priority (CR 117)
- The AP receives priority first at the start of each step/phase that grants it (not untap, and not cleanup normally). With priority, a player may cast a spell, activate an ability, take a special action (e.g. play a land, turning a face-down creature up), or pass.
- Whenever a player would receive priority, **state-based actions are checked first** (repeatedly until none apply), then triggered abilities are put on the stack (AP's first in APNAP order), then the player receives priority (CR 117.5).
- After a spell or ability is put on the stack, the AP receives priority again.
- If all players pass in succession with the stack **empty**, the current step/phase ends. If all pass in succession with a non-empty stack, the **top object of the stack resolves**, then the AP receives priority again.
- Timing: sorcery-speed actions require an empty stack, a main phase, and AP having priority. Instant-speed actions can be done any time the player has priority.

### 4.7 The stack (CR 405, 608, 601, 602)
- LIFO. Spells and activated/triggered abilities go on the stack; lands played, special actions, static abilities and mana abilities do not.
- **Casting a spell (601.2):** (1) move card from hand (or other zone) to stack; (2) choose modes, X, additional/alternative costs; (3) choose targets; (4) divide effects; (5) determine total cost (including cost increases/reductions); (6) activate mana abilities; (7) pay costs. Cast is illegal and rolled back if any step fails. Spell is then "cast" and triggers "when you cast" fire.
- **Resolution (608):** on resolution, check targets: if all targets are illegal, the spell/ability doesn't resolve (fizzles). If some targets are illegal, the rest of the effect still happens. Permanent spells enter the battlefield; instants/sorceries do what they say and go to the graveyard.
- **Mana abilities (605)** don't use the stack and resolve immediately. **Triggered abilities (603)** go on the stack the next time a player would receive priority (APNAP order for simultaneous triggers; each controller orders their own). **Activated abilities (602)** use the format "[cost]: [effect]".
- **Counterspell:** removes a spell from the stack; abilities can be countered only by effects that say so.
- Mana empties from mana pools at the end of each step and phase (CR 500.5).

## 5. Mana and costs (CR 106, 107, 118, 202)

- **Mana types:** W, U, B, R, G, and colorless (C). Generic costs ({1}, {X}) can be paid with any mana. Hybrid, Phyrexian, snow, and X costs exist.
- **Mana cost:** the symbols in the upper right of a card; **mana value** (formerly converted mana cost) is the total (X is 0 in zones other than the stack).
- Lands tap for mana via mana abilities (basic lands: Plains W, Island U, Swamp B, Mountain R, Forest G).
- **Total cost** = mana cost (or alternative cost) + additional costs + cost increases - cost reductions (reductions cannot reduce colored requirements; generic can go to 0 but not below).
- **Tapping** (the symbol {T}) as a cost requires an untapped permanent that isn't a creature with summoning sickness.
- **Summoning sickness (302.6):** a creature can't attack or use {T}/{Q} abilities unless its controller has controlled it continuously since their most recent turn began (haste ignores this).
- **Life payment:** you can pay life only if your life total >= amount.

## 6. Special cards, actions and terms

### 6.1 Permanents
- **Creature:** has power/toughness; damage >= toughness destroys it (SBA). Subtypes e.g. Elf, Wizard.
- **Artifact:** subtypes Equipment (attach by paying equip cost, sorcery speed), Vehicle (becomes creature with crew), Treasure, Food, Clue etc.
- **Enchantment:** subtypes Aura (targets when cast, attached; goes to graveyard if not legally attached), Saga, Class, Room, etc.
- **Planeswalker (306):** enters with loyalty counters; once per turn per planeswalker, at sorcery speed, AP may activate one loyalty ability (cost adds/removes loyalty counters). Dies (SBA) at 0 loyalty. Can be attacked.
- **Battle (310):** enters with defense counters; can be attacked; Siege battles transform when defeated.
- **Land (305):** not cast; played; produces mana.

### 6.2 Keyword actions (CR 701)
Activate, Attach, Cast, Counter, Create, Destroy, Discard, Double, Exchange, Exile, Fight, Mill, Play, Regenerate, Reveal, Sacrifice, Scry, Search, Shuffle, Surveil, Tap/Untap, Transform, Proliferate, Explore, etc.

### 6.3 Keyword abilities (CR 702) - overview of the most common
| Keyword | Meaning |
|---|---|
| Flying | Can be blocked only by creatures with flying or reach |
| Reach | Can block creatures with flying |
| First strike | Deals combat damage in the first-strike damage step |
| Double strike | Deals first-strike and regular combat damage |
| Deathtouch | Any damage dealt to a creature by it is lethal |
| Trample | Excess damage beyond lethal to blockers goes to the defending player/planeswalker |
| Lifelink | Damage dealt by the source also gains its controller that much life |
| Haste | Ignores summoning sickness |
| Vigilance | Doesn't tap to attack |
| Menace | Can't be blocked except by two or more creatures |
| Hexproof | Can't be the target of opponents' spells or abilities |
| Indestructible | Isn't destroyed by lethal damage or "destroy" effects (still dies at toughness 0) |
| Defender | Can't attack |
| Flash | May be cast any time you could cast an instant |
| Protection | From a quality: Damage, Enchanting/Equipping, Blocking, Targeting prevented (DEBT) |
| Ward | Counter a spell/ability that targets it unless its controller pays the ward cost |
| Kicker, Flashback, Cycling, Equip, Enchant, etc. | Additional/alternative cost or special-zone mechanics (CR 702) |

### 6.4 Ability types (CR 113)
Spell abilities (instants/sorceries), activated abilities, triggered abilities ("when/whenever/at"), static abilities (continuous, no stack), mana abilities.

### 6.5 Continuous effects and layers (CR 613)
Continuous effects that change characteristics are applied in layers: 1 copy, 2 control, 3 text, 4 type, 5 color, 6 abilities, 7 power/toughness (7a characteristic-defining, 7b set, 7c modify/counters, 7d switch). Within a layer, timestamp order, with dependency adjustments (613.8).

### 6.6 Replacement and prevention effects (CR 614, 615)
Replacement effects ("instead", "as ... enters", "skip") modify events as they would happen; if several apply, the affected player/controller of the affected object chooses the order (616.1). Damage prevention is a kind of replacement effect.

### 6.7 Targeting (CR 115)
Targets are chosen when the spell/ability is put on the stack; must be legal again on resolution. "Hexproof"/"shroud"/"protection" restrict legal targets.

### 6.8 Combat damage specifics
- Damage dealt to a creature stays marked until the cleanup step; to a player it reduces life; damage from sources with infect/wither gives counters instead.
- Combat damage assignment is simultaneous (except first/double strike).
- Planeswalker damage removes loyalty counters (non-combat damage dealt to a planeswalker also removes that many counters).

## 7. Winning, losing and end of game (CR 104, 704)

### 7.1 Ways to lose (104.3)
- Life total 0 or less.
- Attempting to draw from an empty library (checked as a state-based action, the next time SBAs are checked after the draw).
- Having 10 or more poison counters.
- Conceding (any time, immediately).
- Card-specific effects ("you lose the game"); Commander: 21 combat damage from a single commander.

### 7.2 Ways to win (104.2)
- All opponents have lost; or a card says "you win the game". An effect that says a player wins does not happen if the player can't win (e.g. an opponent has protection from such effects).

### 7.3 Draw (104.4)
If all remaining players lose simultaneously the game is a draw. A game may also be drawn by an infinite loop with no player able to stop it (CR 104.4b), or by an effect.

### 7.4 State-based actions (CR 704.5)
Checked continuously at the points in 4.6; all applicable SBAs happen simultaneously, and are rechecked until none apply:
1. Player with 0 or less life loses.
2. Player who drew from an empty library loses.
3. Player with 10+ poison counters loses.
4. Token in a zone other than the battlefield ceases to exist; a copy of a card in a zone other than stack/battlefield ceases to exist.
5. Creature with toughness 0 or less goes to graveyard (not destruction, so indestructible doesn't help).
6. Creature with damage >= toughness (and positive toughness) is destroyed; creature dealt damage by a deathtouch source is destroyed.
7. Planeswalker with 0 loyalty goes to graveyard.
8. Legend rule (704.5j): if a player controls two or more legendary permanents with the same name, that player chooses one and puts the rest into graveyards.
9. Aura not attached to a legal object, or attached illegally, goes to graveyard; Equipment/Fortification attached illegally becomes unattached; a non-Aura/Equipment attached to a permanent becomes unattached.
10. +1/+1 and -1/-1 counters on the same permanent annihilate in pairs.
11. Battle with 0 defense goes to graveyard (or is defeated); Saga with lore counters >= final chapter and no chapter ability on stack is sacrificed.
12. Permanent with illegal phased status or other corner-case checks as listed in 704.5.
(Exact lettering and the full list is in CR 704.5; consult it for rarer cases.)

## 8. Edge cases and clarifications

- **APNAP order:** when several players would make simultaneous choices/put triggers on the stack, AP goes first and NAP last, so NAP's objects resolve first (CR 101.4, 603.3b).
- **"Can't" beats "can" (101.2).** Where a card contradicts the CR, the card text wins, except for the rules of the game that cannot be overridden.
- **Golden rule - impossible instructions are ignored;** "do as much as possible" (101.3).
- **Draw from an empty library** only causes a loss when SBAs are next checked, so an effect can still shuffle/replace cards in between.
- **Zero or fewer loyalty/toughness** are not destruction, so regeneration or indestructible doesn't save them.
- **Summoning sickness** applies to creatures gained under control during the turn even if they were already on the battlefield.
- **Split second, Stifle-style countering** etc. are handled by card text; "split second" prevents casting or activating (other than mana abilities/special actions) while on the stack.
- **Mana abilities can be activated while paying costs** and in response to nothing; they don't use the stack.
- **Copying a spell/permanent (707)** copies copiable characteristics only (not counters, damage, or effects applied by layers other than copy).
- **Extra turns (500.7)** are inserted immediately after the current turn, most recent first. **Extra phases/steps** similarly after the current one.
- **Loop rule:** mandatory infinite loops produce a draw; optional ones can be shortcut by announcing a number of iterations (CR 731).
- **Hidden information:** hands and libraries are private; players must answer truthfully about public information (graveyards, battlefield, life totals).
- **Priority with empty stack at cleanup:** normally none, but if SBAs/triggers occur in cleanup, a second cleanup step follows.

## Appendix A: Rule Variations

| Format / variant | Differences from main body |
|---|---|
| **Standard** | Constructed; 60+ card deck, max 4 copies; only cards from recent sets (rotating, roughly 3 years); banned list applies. Same game rules as core. |
| **Pioneer / Modern / Legacy / Vintage / Pauper** | Constructed with progressively larger or restricted card pools; 60-card min. Vintage uses a restricted list (1 copy). |
| **Limited: Booster Draft** | Players draft cards from 3 booster packs, passing in alternating directions; deck min 40 cards (usually 17 lands plus 23 spells); no copy limit; sideboard is the remaining pool. |
| **Limited: Sealed Deck** | Players open 6 (typical) boosters and build a 40+ card deck from them. |
| **Commander (EDH) (CR 903)** | 100-card singleton deck (except basic lands) led by a legendary creature (the commander) in the command zone; deck's color identity must be within the commander's; 40 starting life; usually 3-4 players free-for-all; commander can be cast from the command zone (costing {2} more per previous cast); a player that has taken 21 combat damage from one commander loses; commander may go to the command zone instead of graveyard/exile/hand/library. Players draw on first turn (no skip). Commander variants: Brawl (60 cards, Standard cards), Oathbreaker, Duel Commander (2 players). |
| **Multiplayer (CR 800)** | Free-for-all: all opponents are enemies; players leaving the game remove their cards/effects; limited range of influence option; Two-Headed Giant (CR 810): teams share life (30) and take turns together; Emperor, Grand Melee etc. Attack Left/Right variants. No player skips the first draw. |
| **Archenemy / Planechase** | Special oversized cards (schemes, planes) in a separate deck/zone. |
| **Best-of-three matches** | Games played in a match; sideboarding between games; loser chooses who plays first. |
| **Mulligan variants** | Older rules: Vancouver/Paris/Partial Paris mulligan (draw one fewer card). The London mulligan above is current. Some casual groups give a free mulligan. |
| **House rules (casual)** | Common: free mulligans, proxies, ignoring banned lists, "Rule 0" pre-game discussions about power level. |

## Sources

- https://magic.wizards.com/en/rules (Comprehensive Rules index; TXT/PDF 2026-09-25 at https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) - consulted for mulligan (103.5), first draw skip (103.8), SBA list (704.5)
- https://en.wikipedia.org/wiki/Magic:_The_Gathering_rules
- https://en.wikipedia.org/wiki/Magic:_The_Gathering (format and deck-size overview)
- Remaining detail (steps, stack, layers, keyword list) written from general knowledge of the Comprehensive Rules; not fully verified against the live text.
