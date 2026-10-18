# Gin Rummy

A two-player rummy game in which players draw and discard to form melds (sets and runs), try to reduce unmatched "deadwood", and end each hand by knocking; a match is played over multiple hands to 100 points.

## 1. Components

- Standard 52-card deck, no jokers.
- Exactly 2 players.
- Card rank order (Ace always low): A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K.
- Card point values (deadwood): Ace = 1, 2-10 = face value, J/Q/K = 10.
- A stock (face-down draw pile), a discard pile (face-up), and a score record.

## 2. Objective

Form your hand into melds and minimize deadwood. Win a hand by knocking with a lower deadwood count than the opponent, or by going gin (no deadwood). Win the match by being first to reach 100 points (before bonuses).

## 3. Setup and Dealing

1. First dealer is chosen by drawing cards (lower card deals in Pagat; Bicycle says the higher drawer deals; no effect on play). In later hands, the winner of the previous hand deals (Pagat); Wikipedia says dealership alternates (see Appendix A).
2. Shuffle; deal 10 cards to each player, one at a time (non-dealer first).
3. Turn the 21st card face up beside the stock to start the discard pile.

## 4. Melds and Deadwood

- **Set**: 3 or 4 cards of the same rank.
- **Run**: 3 or more cards of the same suit in consecutive rank. Ace is low only: A-2-3 is valid; Q-K-A is not; no wrap-around.
- A card can belong to only one meld at a time.
- **Deadwood**: cards not in any meld, valued per Section 1. A player's deadwood count is the minimum achievable by the best arrangement of the hand into melds.

## 5. Turn Structure

**First turn (special)**
1. Non-dealer may take the face-up card (then must discard a different card, ending the turn) or pass.
2. If the non-dealer passes, the dealer may take it (and discards a different card) or pass.
3. If both pass, the non-dealer draws the top of the stock and play proceeds normally (non-dealer discards, then the dealer's turn).

**Normal turn**
1. **Draw**: take either the top card of the stock or the top card of the discard pile (hand now 11 cards).
2. **Discard**: place one card face up on the discard pile. A card taken from the discard pile this turn may not be discarded back the same turn.
3. **Or knock** (see below) in place of a normal discard, if eligible.

Only the top discard is available; discards are not fanned/searchable. Turns alternate.

**Knocking**
- A player may knock if, after drawing, the deadwood of the remaining 10 cards (after discarding one card face down for the knock) is 10 points or less. The knocker is never forced to knock.
- The knocker discards one card face down, then exposes the hand arranged into melds and deadwood, declaring the deadwood count.
- **Gin**: knocking with zero deadwood.

**Defender's response (after a non-gin knock)**
- The opponent reveals their hand, arranges melds, and may **lay off** deadwood cards onto the knocker's melds: a 4th card to a 3-card set (same rank), or consecutive same-suit cards to either end of a run. Cards cannot be laid off onto the knocker's deadwood, and the knocker may not lay off onto the opponent's melds.
- After a gin, no laying off is allowed.

## 6. Special Terms

- **Knock**: ending the hand with <= 10 deadwood.
- **Gin**: knocking with 0 deadwood.
- **Undercut**: after a non-gin knock, the opponent's deadwood (after layoffs) is lower than or equal to the knocker's.
- **Layoff**: adding the defender's cards to the knocker's melds.
- **Line (box) bonus**: per-hand-won bonus added at end of match.
- **Deadwood**: unmatched cards.

## 7. Scoring and End of Game

Per hand (counts are the deadwood totals; the defender's count is computed after layoffs):

| Outcome | Points scored |
|---|---|
| Knock, knocker's count < defender's | Knocker scores the difference |
| Undercut (defender's count <= knocker's) | Defender scores the difference + 10 bonus |
| Gin | Knocker scores 20 bonus + defender's full deadwood count (no layoffs; defender scores 0 even with no deadwood) |

- **Game end**: the match continues over successive hands until a player's cumulative score reaches 100 or more. That player wins and receives a **game bonus of 100**.
- **Line (box) bonus**: each player adds 20 points for each hand they won. These are not counted toward the 100 needed to win.
- **Shutout**: if the loser scored nothing at all in the match, the winner's game bonus is 200 instead of 100 (Pagat). Bicycle describes a 100-point shutout bonus (see Appendix A).
- Final result: compare totals (including bonuses); higher total wins the stakes/margin.

## 8. Edge Cases and Clarifications

- **Stock exhaustion**: if the stock is down to two cards and the player who took the third-to-last card discards without knocking, the hand is a draw: no score, and the same dealer deals again.
- A player is never required to knock; a player may keep playing with <= 10 deadwood to try for gin.
- A knocker's discard when knocking is placed face down and is not part of the 10 counted cards.
- A hand with deadwood of 10 or less but where the knocker could meld differently: the best arrangement is used; the knocker may arrange to maximize layoff-resistance only within legal melds (arrangement is the knocker's choice, count must be <= 10).
- Defender must still count the layoffs they make; they may choose not to lay off.
- Undercut applies on ties.
- A gin hand scores even if the opponent has zero deadwood (20 bonus + 0).
- The first-turn upcard rule: whoever takes the upcard must discard a different card.

## Appendix A: Rule Variations

Items marked **(differs)** differ from the main body.

1. **Bonus values (differs)**: Wikipedia and many US sources (e.g. Hoyle-style/tournament) use 25 for gin bonus, 25 for undercut bonus, and 25 per hand-won line bonus; some use 15 or 10 for undercut. Pagat and Bicycle (main body) use 20 gin, 10 undercut, 20 line.
2. **Big Gin (differs)**: with all 11 cards (after drawing) forming melds, a player may declare Big Gin and score 31 (Wikipedia) plus the opponent's deadwood, with no layoffs; in some play it is 6 points more than gin. Not in the main body.
3. **Dealership (differs)**: Wikipedia states dealership alternates each hand; Pagat has the winner of the previous hand deal.
4. **First dealer draw (differs)**: Pagat, lowest card deals; Bicycle, highest card deals.
5. **Shutout (differs)**: Bicycle lists a 100-point shutout bonus; Wikipedia says hand points are doubled in a shutout; Pagat uses a 200 game bonus.
6. **Oklahoma Gin (differs)**: the rank of the first upcard sets the maximum deadwood allowed for knocking (face cards count 10; some require gin if an Ace). If the upcard is a spade, the hand's score (including bonuses) is doubled. Target is often 150 rather than 100.
7. **Hollywood Gin (differs)**: three games are scored simultaneously; a player's first hand win counts in game 1, the second in games 1 and 2, the third and later in all three active games.
8. **Straight Gin (differs)**: no knocking; play continues until a player goes gin.
9. **Target score (differs)**: 100 is standard; 150 (Oklahoma) or 250 (tournament, per Wikipedia) are used.
10. **Strict first-turn stock draw**: some groups let the non-dealer stock-draw after both pass, as in the main body; no known variation changes this.

## Appendix B: Notes on Source Discrepancies

- Pagat and Bicycle agree on 20/10/20 bonuses; Wikipedia gives 25. The 20/10/20 set is used in the body for being the figures given by the two most-detailed rule pages; engines should make bonuses configurable.
- Bicycle's page did not cover big gin, undercut, layoffs, or stock exhaustion; those rules come from Pagat and Wikipedia.

## 10. Sources

- https://www.pagat.com/rummy/ginrummy.html
- https://en.wikipedia.org/wiki/Gin_rummy
- https://bicyclecards.com/how-to-play/gin-rummy/
