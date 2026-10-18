# War

War is a two-player luck-only card game in which players repeatedly flip their top cards, the higher card wins both, and ties trigger a "war"; the first player to hold all 52 cards wins.

## 1. Components
- One standard 52-card deck (no jokers). Suits are irrelevant.
- Rank order, high to low: A K Q J 10 9 8 7 6 5 4 3 2 (Ace high).
- Players: 2 (standard). 3-4 player versions are variants (Appendix A).

## 2. Objective
Win all 52 cards.

## 3. Setup and dealing
1. Shuffle the deck.
2. Deal all cards one at a time, face down, alternating: 26 cards each.
3. Each player keeps a face-down stack (their "hand"/"packet") and does not look at it. No decisions are ever made by players.

## 4. Turn structure (a "battle")
1. Both players simultaneously turn over the top card of their stack, face up.
2. Higher rank wins: the winner takes both cards and places them face down on the bottom of their stack.
3. If ranks are equal, a war begins (below).
4. Repeat until a player has no cards.

### War (tie procedure)
1. Each player places one card face down (the "prisoner"/"down" card) on the table next to the tied cards.
2. Each player then turns one more card face up.
3. The higher face-up card wins all cards on the table (6 in a single war: 2 tied + 2 face-down + 2 face-up), placed face down on the bottom of the winner's stack.
4. If the new face-up cards tie, repeat steps 1-3 (one down, one up); the winner of the final comparison takes everything accumulated.

## 5. Special terms
- **Battle**: one simultaneous flip and comparison.
- **War**: a tie on a battle, resolved as above.
- **Pot**: all cards on the table in the current battle/war.
- No special cards; Aces are simply high.

## 6. Winning / end of game
The game ends when one player holds all 52 cards (the other has none); that player wins. No scoring.

## 7. Edge cases and clarifications
- **Player cannot complete a war (insufficient cards).** Sources disagree; Pagat and Wikipedia list several options. Recommended default for an engine (Pagat's second option): if a player runs out during a war, their last remaining card is turned face up and is used as their face-up card for that war (if they have only 1 card, it is the face-up card, with no face-down card). If that card ties again and they have no cards left, the opponent wins the pot. A player with no cards at the start of a battle has lost.
- **Collection order.** Most rules say only "bottom of the winner's stack" and do not specify the order in which won cards are added. This affects determinism, so an engine should fix an order (e.g. winner's own card first, then opponent's; war cards in table order) or randomize it, and document the choice. Fixed order can cause infinite games.
- **Endless games.** The game can in rare cases loop forever (especially with fixed collection order); engines should set a maximum turn cap and treat hitting it as a draw (this cap is an implementation note, not a traditional rule).
- Cards are never reshuffled in the standard game.
- The outcome is fully determined by the initial deal (given a collection order); no player choices exist.

## Appendix A: Rule Variations
Differences from the main body are noted.
1. **Three face-down cards per war** (OfficialGameRules; Wikipedia): each player puts 3 cards face down, then 1 up; the winner takes 10 cards (more with repeated wars). Differs: main body uses 1 face-down card.
2. **Running out during war** (Pagat, Wikipedia): (a) the player short of cards loses immediately; (b) last card played face up (used in main body); (c) restart/other house options; (d) Wikipedia also mentions the player with more cards supplying the shortage. Differs from main body for (a), (c), (d).
3. **Loser shuffles** (OfficialGameRules): the war loser shuffles their whole stack (including cards just lost) before further play. Differs: main body never shuffles.
4. **Multiplayer** (Wikipedia): 3 players receive 17 cards each (one card left over); 4 players receive 13 each; high card wins the pot, ties among top cards fight a war between the tied players only.
5. **Peace / low wins** (Wikipedia): lowest card wins instead of highest.
6. **Prisoners of War** (Wikipedia): winners may capture opponent cards as prisoners.
7. **Named relatives** (Pagat): Steal War, P'yanitsa (Russian), Tod und Leben (German), Syrian War, Casino War; each alters ranking, play sequence or war procedure.
8. **Quadruple war** (Bicycle): mentioned as a related game, with no details given.

## Sources
- https://www.pagat.com/war/war.html
- https://en.wikipedia.org/wiki/War_(card_game)
- https://bicyclecards.com/how-to-play/war
- https://www.officialgamerules.org/war
