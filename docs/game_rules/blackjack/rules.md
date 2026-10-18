# Blackjack

Blackjack (Twenty-One) is a banking game in which each player independently tries to beat the dealer by holding a hand closer to 21 than the dealer's without going over.

## 1. Components

- Deck: standard 52-card deck, no Jokers. Casinos commonly use 1, 2, 4, 6 or 8 decks shuffled together (a "shoe"). Main body assumes 6 decks.
- Players: 1 or more players (commonly up to 7 "boxes" at a table), each playing against the dealer, not each other. One dealer (house/banker).
- Chips/bets: each player places a wager before the deal.
- Cut card: a marker inserted into the shoe (by a player) to indicate when to reshuffle.
- Card values: 2-10 = pip value; J, Q, K = 10; Ace = 1 or 11 (whichever is better for the hand).
  - Soft hand: contains an Ace counted as 11. Hard hand: no Ace, or all Aces counted as 1.

## 2. Objective

Beat the dealer: finish with a total higher than the dealer's without exceeding 21, or have the dealer exceed 21 (bust) while you have not. Each player's hand is settled separately against the dealer.

## 3. Setup and Dealing

1. Shuffle the deck(s); cut card placed near the back.
2. Each player places an initial bet.
3. Deal clockwise starting at the dealer's left: one card face up to each player, one face up to the dealer, a second card face up to each player, then the dealer's second card face down (the "hole card").
4. Player hands are face up (in some handheld single/double-deck games players hold them face down and only they see them).

## 4. Turn Structure / Gameplay

1. **Dealer check (hole-card games).** If the dealer's upcard is an Ace, offer Insurance (see section 5). If the upcard is an Ace or 10-value card, the dealer peeks at the hole card.
   - If the dealer has blackjack: reveal it, resolve all bets (player blackjacks push; all other player hands lose; insurance pays 2:1), round ends.
   - Otherwise: play continues (any insurance bets lose).
2. **Player blackjacks.** A player with a natural (Ace + 10-value card as the first two cards) is paid 3:2 immediately if the dealer does not have blackjack (or after the dealer check). Their hand ends.
3. **Players act in order**, from the dealer's left to right, each completing all their hands before the next player. On each hand, the player may repeatedly choose:
   - **Hit:** take one card. If the total exceeds 21 the hand busts and its bet is lost immediately (the dealer does not need to play against it).
   - **Stand:** take no more cards; the turn for that hand ends.
   - **Double down:** (first two cards only) double the bet, receive exactly one more card, then stand.
   - **Split:** (first two cards of equal rank/value) place a second bet equal to the first, separate the cards into two hands, and deal a second card to each. Play each hand in turn.
   - **Surrender:** (if offered; first action only) forfeit the hand and recover half the bet.
   - A hand totalling 21 normally stands (no further action is useful).
4. **Dealer plays** once all players have acted. If every player hand has busted, surrendered or been paid as a natural, the dealer need not draw. Otherwise the dealer reveals the hole card and draws cards until the hand totals 17 or more, then stands. Dealer has no choices. In the main body, the dealer stands on all 17s (including soft 17).
5. **Settlement.** Compare each remaining player hand to the dealer's:
   - Player total > dealer total, or dealer busts: player wins 1:1.
   - Equal totals: push, bet returned.
   - Player total < dealer total: player loses the bet.
6. Cards are discarded, and a new round begins. Reshuffle when the cut card is reached (at the end of the current round).

## 5. Special Cards, Actions, Terms

- **Blackjack / natural:** two-card 21 (Ace + 10-value card). Beats any other 21 (including three or more card 21s) and ties only another blackjack.
- **Bust:** hand total over 21; automatic loss.
- **Push:** tie; stake returned.
- **Hole card:** dealer's face-down card.
- **Insurance:** optional side bet offered when the dealer's upcard is an Ace; costs up to half the original bet; pays 2:1 if the dealer has blackjack, otherwise lost. (Net effect: a player with a natural who insures breaks even, "even money".)
- **Doubling down:** see above; allowed on any two-card hand in the main body.
- **Splitting:** pairs of the same rank; 10-value cards of different rank (e.g. K-J) may also be split in most casinos. Resplitting is allowed if a new pair appears, up to a total of 4 hands. Doubling after split is allowed.
- **Split Aces:** each split Ace receives exactly one additional card only, with no further hitting, splitting or (usually) doubling.
- **Soft/hard totals** as defined in section 1.

## 6. Scoring and Winning

- Hand total: sum of card values with Aces counted as 11 unless that would bust, in which case as 1 (re-evaluated each card).
- Payouts (per original bet): normal win 1:1; blackjack 3:2; push 0; loss -1; insurance win 2:1; surrender -0.5; doubled/split hands pay on the doubled/split stake.
- There is no fixed end to the game: play is a series of independent rounds. Each player wins or loses against the dealer per hand; a session ends when players choose to leave or run out of chips.

## 7. Edge Cases and Clarifications

- A 21 made after splitting (e.g. split Ace + 10, or split ten + Ace) counts as an ordinary 21, not a blackjack, and pays 1:1.
- A blackjack beats a dealer 21 made of three or more cards; a player's three-card 21 ties a dealer's three-card 21 (push).
- If a player busts, they lose even if the dealer subsequently busts (player busts first).
- Surrender, when allowed, is the player's first and only action; "late surrender" is only available after the dealer has checked for blackjack, so a dealer blackjack still takes the full bet.
- With multiple hands from a split, each is independently compared with the dealer.
- Insurance is resolved before players act, and is independent of the main hand result.
- Cards are drawn from the top of the shoe; the player cannot see or choose them.

## Appendix A: Rule Variations

Differences from the main body are noted for each.

- **Blackjack payout:** some casinos pay 6:5 (common on single/double-deck tables) or even 1:1 instead of 3:2; both greatly increase the house edge.
- **Dealer hits soft 17 (H17):** dealer must draw on soft 17 (stands on hard 17+ and soft 18+). Main body: dealer stands on soft 17 (S17).
- **Number of decks:** 1, 2, 4, 6 or 8 decks; fewer decks favors the player.
- **No hole card (European / ENHC):** dealer receives the second card only after all players act; no peek. A dealer blackjack then takes extra bets (doubles and splits) from players, in some variants.
- **Doubling restrictions:** doubling allowed only on certain totals (e.g. 9-11 or 10-11); doubling after split may be prohibited (No DAS).
- **Splitting restrictions:** only identical ranks (not any two 10-value cards); resplitting limited to 2 or 3 hands; Aces may or may not be resplit; some games allow hitting split Aces.
- **Surrender:** not offered at all tables; "early surrender" (before the dealer peeks) exists in few places; "late surrender" is more common.
- **Insurance:** some tables offer insurance only on an Ace upcard (as above) and some also offer "even money" to a player with blackjack against a dealer Ace.
- **Five-Card Charlie:** a five-card hand not exceeding 21 automatically wins (rare, usually pays even money).
- **Swedish Pub Blackjack / pub rules:** house wins ties at some totals (e.g. 17-19); casino versions return the stake. Rules differ by region.
- **Players' cards face down** in hand-held single-deck games.
- **Dealer 22 pushes** ("Push 22") in some promotional games, instead of a bust.

## Sources

- https://www.pagat.com/banking/blackjack.html
- https://en.wikipedia.org/wiki/Blackjack
- https://bicyclecards.com/how-to-play/blackjack/
