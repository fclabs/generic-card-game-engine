# Poker (Texas Hold'em)

A community-card betting game: each player gets two private cards, five shared cards are dealt in stages, and the pot goes to the best five-card hand at showdown or to the last player not to fold.

## 1. Components

- One standard 52-card deck, no jokers. Suits are never ranked against each other.
- 2 to 10 players (9 or 10 at a full table; 2 is "heads-up").
- Chips, or any other betting currency.
- A dealer button that marks the nominal dealer and moves one seat clockwise after every hand.
- Blinds: forced bets from two players. The big blind (BB) equals the minimum bet. The small blind (SB) is typically half the BB.
- Card ranks run A K Q J 10 9 8 7 6 5 4 3 2. The ace is high, and also low in the straight A-2-3-4-5 (the "wheel").

## 2. Objective

Win chips by taking the pot. You win it either by holding the best five-card hand at showdown or by making every other player fold. A hand uses any five of the seven cards available to a player: two hole cards plus five community cards.

## 3. Setup and dealing (per hand)

1. Move the dealer button one seat clockwise. Skip empty seats.
2. Post blinds:
   - 3+ players: the player left of the button posts the SB and the next player left posts the BB.
   - Heads-up: the button posts the SB and the other player posts the BB.
3. Shuffle the deck. Starting with the SB seat and going clockwise, deal one card face down to each player, then a second card to each player (two hole cards each).
4. Burn one card before each community-card deal, as below.
5. Community cards:
   - Flop: burn 1, then deal 3 face up.
   - Turn: burn 1, then deal 1 face up.
   - River: burn 1, then deal 1 face up.

## 4. Gameplay: betting rounds

A hand has four betting rounds, in this order:

| Round | Starts after | First to act |
|---|---|---|
| Pre-flop | Hole cards dealt | First active player left of the BB. Heads-up: the button/SB. |
| Flop | 3 community cards | First active player left of the button. Heads-up: the BB. |
| Turn | 4th card | Same as flop |
| River | 5th card | Same as flop |

Action goes clockwise. On their turn, a player must do one of the following.

- **Fold:** Discard the hand and forfeit any claim to the pot. This is always allowed.
- **Check:** Pass without betting. This is allowed only if no bet is outstanding this round. The BB may check pre-flop if nobody has raised.
- **Bet:** Make the first wager of a round (post-flop).
- **Call:** Match the current highest bet.
- **Raise:** Increase the current bet. The blinds count as the opening bet pre-flop, so the BB is the bet to call.
- **All-in:** Wager all remaining chips. This is allowed at any time, even for less than a call or a full raise.

A betting round ends when all active (non-folded, non-all-in) players have acted and have put in equal amounts. Players who are all-in take no further actions.

### Betting structures

- **No-limit** (the most common main-body form):
  - The minimum bet is the BB.
  - A raise must be at least the size of the previous bet or raise in that round. For example, a bet of 20 means the minimum raise is to 40, and a raise to 60 makes the next minimum raise to 80.
  - The maximum bet is the player's whole stack.
- **Pot-limit:** The maximum raise is the size of the pot, counting the call.
- **Fixed-limit:** Bets and raises use a fixed size. It is the small bet on the pre-flop and flop, and the big bet (double) on the turn and river. The number of raises per round is capped, typically a bet plus 3 (sometimes 4) raises when 3+ players are active. There is no cap heads-up.

### Progression

- If all players but one fold at any point, that player wins the pot immediately with no showdown. They do not have to show cards.
- If two or more players remain after the river betting, there is a showdown.
- If all remaining players are all-in (or only one has chips left to act), the remaining community cards are dealt with no further betting, then showdown.

## 5. Special terms

- **Hole cards:** The player's two private cards.
- **Board:** The community cards.
- **Burn card:** A card discarded face down before each community deal, to guard against marked cards.
- **Kicker:** An unpaired card used to break ties between hands of the same category.
- **Side pot:** A separate pot created when a player is all-in for less than the others (see section 7).
- **Hand rankings**, highest to lowest:
  1. Straight flush (royal flush is the ace-high version)
  2. Four of a kind
  3. Full house (three of a kind plus a pair)
  4. Flush
  5. Straight
  6. Three of a kind
  7. Two pair
  8. One pair
  9. High card

## 6. Showdown and winning a pot

- Order of showing: the last player to bet or raise on the final betting round shows first, then clockwise. If the final round was checked around, the first active player left of the button shows first.
- A player must show both hole cards to claim any part of the pot, even if neither is used. The cards speak for themselves: the best hand wins whether or not the player recognizes it.
- Hand comparison:
  - Compare by category first.
  - Within a category, compare the ranks of the cards that make up the hand, then the kickers.
  - Suits never break ties.
  - Examples: a pair is compared by pair rank, then the three kickers in order. Straights are compared by top card, and the wheel (5-high) is the lowest straight. Flushes are compared card by card from the highest.
- Players may use two, one, or none of their hole cards. Playing the board means using all five community cards.
- Ties: tied players split the pot equally. An indivisible odd chip goes to the first tied player clockwise from the button.
- A player is eliminated when they have no chips. Play continues until one player holds all the chips (tournament), or each player leaves a cash game at will.

## 7. Edge cases and clarifications

- **All-in and side pots:**
  - Each player can win from each opponent only as much as they themselves put in.
  - Once a player is all-in, the extra chips from the deeper-stacked players go into a side pot that only those players can win.
  - There can be several side pots. They are awarded in turn, starting with the last side pot and ending with the main pot.
  - Each pot goes to the best hand among the players eligible for that pot.
  - Folded players' chips remain in the pots they were added to.
  - If a player bets more than any opponent can call, the uncalled excess is returned.
- **Incomplete all-in raise (no-limit/pot-limit):** An all-in raise smaller than a full minimum raise does not reopen the betting for players who have already acted and who are not facing a full raise. Those players may only call or fold. Multiple short all-ins that add up to a full raise do reopen it. Players who have not yet acted may still raise.
- **Pre-flop BB option:** If everyone just calls, the BB may check or raise.
- **Heads-up blinds:** The button posts the SB and acts first pre-flop. Post-flop the BB acts first.
- **Player busts or leaves:** The button and blinds keep advancing by seat position. Common practice is to avoid posting a blind twice in a row. See Appendix A on dead button.
- **Betting out of turn, string bets and similar etiquette** are not part of the core rules. Treat the first clearly announced action as binding if modeled.
- **Raises in a round:** Fixed-limit raise caps apply only to fixed-limit play.
- **Fewer than 2 players with chips:** The hand cannot proceed. The game is over.

## Appendix A: Rule Variations

Differences from the main body are noted.

1. **Betting structure.** The main body is no-limit. Fixed-limit, pot-limit and spread-limit are common alternatives (see section 4).
2. **Burn cards.** The main body burns before each community deal. Some home games and some online sites burn nothing, and the outcome is unaffected.
3. **Blind and ante structure.** The main body uses the SB and BB only. Some games and tournaments add an ante from every player, or a big-blind ante (the BB pays everyone's ante).
4. **Dead button vs. moving button.**
   - Dead button: a busted player's blind is skipped but the button still moves one seat.
   - Moving button: the button is placed so that nobody pays the BB twice and nobody skips the BB.
   - Rooms and tournament rules differ.
5. **Straddle.** An optional voluntary blind raise by the player left of the BB, usually double the BB. This player acts last pre-flop. It is not part of the standard rules.
6. **Run it twice.** Players who are all-in may agree to deal the remaining community cards twice, with each half of the pot awarded separately.
7. **Odd-chip rule.** The main body gives the odd chip to the first player left of the button. Some rooms give it to the high card by suit, or split it into smaller denominations.
8. **Showdown disclosure.** Some rooms allow a player who is the only caller to muck without showing. Some require all players still in to show.
9. **Hole-card variants** (Pagat):
   - **Pineapple:** Three hole cards are dealt and one is discarded before the pre-flop betting.
   - **Crazy Pineapple:** Three hole cards are dealt and one is discarded after the flop betting, before the turn.
   - **Tahoe:** Three hole cards are kept to the end. Players use 0, 1 or 2 of them.
   - **Irish:** Four hole cards are dealt and two are discarded before the turn.
   - **Omaha** (Omaha Hold'em) uses 4 hole cards and requires exactly 2 of them.
   - **Crazy Pineapple Hi-Lo 8:** A split pot between high and low (8-or-better) hands. The low hand needs five cards of different ranks, all 8 or lower.
10. **Table size.** Short-handed tables of 6 or fewer are common. Some variants play with a short deck (36 cards) and use different rankings (flush beats full house). This is not standard.
11. **Raise caps.** Fixed-limit caps are commonly a bet plus 3 raises, though some rooms allow 4.

## Appendix B: Sources

- https://en.wikipedia.org/wiki/Texas_hold_%27em
- https://en.wikipedia.org/wiki/Poker
- https://www.pagat.com/poker/variants/texasholdem.html
- Web search results on no-limit minimum raise and incomplete all-in rules (cardplayer.com, pokerskill.com, pokertda.com forum, homepokertourney.org, gra.gov.sg tournament rules)
- Attempted but unavailable: bicyclecards.com (404), pokertda.com rules (connection refused)
