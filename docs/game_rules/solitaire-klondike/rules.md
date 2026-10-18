# Solitaire (Klondike)

A single-player patience game: build four suit foundations from Ace to King by working through seven tableau columns and a stock.

## 1. Components

- One standard 52-card deck, no jokers. Rank order, low to high: A 2 3 4 5 6 7 8 9 10 J Q K. The Ace is always low.
- One player.
- Areas:
  - **Stock**: face-down draw pile.
  - **Waste**: face-up pile fed from the stock.
  - **Tableau**: 7 columns, numbered 1 to 7.
  - **Foundations**: 4 piles, initially empty.

## 2. Objective

Move all 52 cards to the foundations. Each foundation is built up in a single suit from Ace to King.

## 3. Setup and dealing

1. Shuffle the deck.
2. Deal 28 cards to the tableau. Column *n* (n = 1..7) gets *n* cards.
3. Only the top card of each column is face up. All other tableau cards are face down.
4. The remaining 24 cards form the stock, face down. The waste starts empty.

## 4. Gameplay

There are no turns and no opponents. The player makes legal moves in any order until the game is won or no moves remain.

### Legal moves

1. **Tableau to tableau**
   - A face-up card, together with every card on top of it, moves as one unit onto another column.
   - The unit's lowest-ranked card (the one at the base of the unit) must be exactly one rank lower than the destination column's top card.
   - The two cards must be opposite colors. Example: a black 5 on a red 6.
   - Cards inside a moved unit must already form a valid descending, alternating-color run.
2. **Waste to tableau**
   - The top waste card may be placed on a column under the same rule as above.
3. **To foundation**
   - The top card of the waste or of any tableau column may go to a foundation.
   - An empty foundation accepts only an Ace.
   - A non-empty foundation accepts the next rank of its suit.
4. **To an empty column**
   - Only a King, or a unit whose base card is a King, may be moved into an empty column.
5. **Reveal**
   - When a move leaves a column whose top card is face down, that card is turned face up immediately. Reveal is mandatory and automatic.
6. **Stock draw**
   - Main rule: turn the top 3 cards of the stock face up onto the waste, one at a time, so the last one turned is on top. Only the top waste card is playable.
   - If the stock holds fewer than 3 cards, turn over what remains.
   - Cards beneath the top waste card become playable once the top one is removed.
7. **Recycle**
   - When the stock is empty, the waste may be turned over (without shuffling, order preserved) to form a new stock.
   - Main rule: unlimited recycles.

### Foundation to tableau

Moving a foundation's top card back to a tableau column is permitted in many implementations, under the normal tableau rule. See Appendix A: it is a point of disagreement between sources.

## 5. Special cards and terms

- **Aces**: start the foundations. Only a face-up Ace on the waste or at the top of a tableau column can go to a foundation.
- **Kings**: the only cards that can fill an empty tableau column.
- **Build / sequence / unit**: a run of face-up cards in descending rank and alternating colors.
- **Tableau**: the 7 columns. **Stock**: undealt pile. **Waste**: discard pile beside the stock.
- **Redeal / recycle**: turning the waste over to make a new stock.

## 6. Scoring, winning and end of game

- **Win**: all 4 foundations hold 13 cards each.
- **Loss**: the player has no legal move that changes the position (and, under limited redeals, the stock and recycles are exhausted).
- Scoring is optional. Common "Standard" scoring (Microsoft-style):

| Event | Points |
|---|---|
| Waste to tableau | +5 |
| Waste to foundation | +10 |
| Tableau to foundation | +10 |
| Turn over a tableau card | +5 |
| Foundation to tableau | -15 |
| Recycle waste (draw-one mode) | -100 |

  Score never goes below 0.
- **Vegas (casino) scoring**: see Appendix A.

## 7. Edge cases and clarifications

- A column may be emptied by moving all its cards. Only a King or a King-based unit can refill it.
- A unit move must move all face-up cards from the chosen card to the column's top. You cannot leave cards of the chosen unit behind, but you may choose to move only a sub-run starting from any face-up card that is part of a valid run.
- Face-down cards are never movable. They can only be revealed by removing the cards above them.
- A card sent to a foundation is not required to be sent. Auto-moves are an implementation choice.
- When the stock has 1 or 2 cards in a draw-three game, only those cards are turned over. The waste order is maintained when recycling, so a recycle after a draw-three pass presents the same groups unless cards were removed.
- Not every deal is winnable. Win rates vary widely with skill and rule variant (about 3% for draw-one single pass; 18% to 43% for draw-three with unlimited redeals; some deals are unwinnable even with perfect information).
- A game ends as lost only when the player concedes or the engine detects no remaining useful moves. Cycling the stock with no changes does not count as progress.

## Appendix A: Rule Variations

Items marked **(differs)** change the main body.

1. **Draw one card at a time (differs)**: turn one stock card onto the waste per draw. Very common in computer versions. Usually paired with a limited number of passes or a recycle penalty (-100 in Microsoft Standard scoring).
2. **Draw three, limited redeals (differs)**: 3 passes through the stock in total (Pagat/Wikipedia list this alongside the unlimited form).
3. **Draw one, single pass (differs)**: no recycling. Win rate about 3%.
4. **Strict rules (differs)** (Semicolon "Klondike Strict"): cards dealt one at a time, one pass, only full builds (no partial moves).
5. **Partial tableau moves**: the main body allows moving a sub-run from any face-up card. Some stricter versions require moving a complete build.
6. **Foundation to tableau (differs)**: some versions disallow taking cards back from foundations. Microsoft allows it with a -15 penalty.
7. **Vegas scoring (differs)**: pay 52 points (or $52) per game, win back 5 points per card placed on a foundation. The usual pairing is draw-one, single pass (Wikipedia describes $50 stake and $5 per card, a pass-count and stake variation). Tournament play may allow 2 redeals.
8. **Microsoft timed mode**: -2 points per 10 seconds, with a time bonus for fast wins. No bonus if the win takes less than 30 seconds.
9. **Thoughtful Klondike**: all cards visible (face-up) from the start. Win rate about 82% with three-card draw.
10. **Related games (not Klondike)**: Agnes, Easthaven, Westcliff, Whitehead, Double Klondike, Klondike by Threes, Klondike Progressive, Kuifers, Thumb and Pouch, Joker Solitaire.

## Appendix B: Notes on source agreement

All sources agree on the layout, the 28/24 split, building down in alternating colors, King-only empty columns, and foundations building up by suit from the Ace. They disagree on draw count, number of redeals, and foundation-to-tableau moves. The main body uses draw-three with unlimited redeals (the most traditional form) and notes the differences above. Pagat.com could not be fetched (404). Details marked from Pagat/Hoyle above are as relayed by Wikipedia and search summaries, not read directly.

## Sources

- https://en.wikipedia.org/wiki/Klondike_(solitaire)
- https://bicyclecards.com/how-to-play/klondike
- https://semicolon.com/Solitaire/Rules/KlondikeRules.html
- https://www.solsuite.com/games/klondike.htm
- https://www.freesolitaire.com/posts/posts-guides/klondike-solitaire-rules (search result only)
- https://casteel.org/iKlondike/Klondike_rules.html (search result only)
