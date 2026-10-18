# Baccarat (Punto Banco)

Punto Banco is the casino form of baccarat: two hands, Player and Banker, are dealt by the house from a shoe according to fixed drawing rules, and bettors wager on which hand will total closest to 9 (or on a tie).

## 1. Components

- **Deck:** 6 or 8 standard 52-card decks (no jokers) shuffled together and dealt from a shoe. 8 decks is the most common.
- **Participants:** A dealer (house/croupier) and up to ~12-14 bettors. Bettors do not make playing decisions; both hands are played by fixed rules. "Player" and "Banker" are names of the two hands, not of people.
- **Bets:** Each bettor places a stake before the deal on Player, Banker, or Tie (bettors may bet on either hand regardless of who "holds" cards).
- **Cut card:** A cut card is placed near the back of the shoe (commonly about 7 cards from the end, per Wikipedia).

## 2. Objective

Each coup (round) ends with one of three outcomes: Player wins, Banker wins, or Tie. The winning hand is the one whose total is closer to 9. Bettors win by backing the correct outcome.

## 3. Card Values

| Card | Value |
|---|---|
| 2-9 | Face value |
| 10, J, Q, K | 0 |
| Ace | 1 |

A hand's total is the sum of its cards **modulo 10** (only the units digit counts). E.g. 7+6 = 13 -> 3. Maximum is 9. Suits are irrelevant.

## 4. Setup and Dealing

1. Shuffle the decks; the shoe is cut and a cut card inserted.
2. **Burn:** the dealer turns the top card face up, then burns face down a number of cards equal to its value (Ace = 1, 10/face = 10).
3. Bettors place bets (Player / Banker / Tie, plus any side bets).
4. Deal four cards alternately: 1st to Player, 2nd to Banker, 3rd to Player, 4th to Banker. Each hand now has two cards.

## 5. Gameplay (per coup)

1. Compute the two-card totals of Player and Banker.
2. **Naturals:** If either hand totals 8 or 9, it is a natural. Both hands stand; no third card is drawn. Go to step 6.
3. **Player's rule (no natural):**
   - Player total 0-5: Player draws one card.
   - Player total 6-7: Player stands.
4. **Banker's rule (no natural):**
   - **If Player stood** (total 6-7): Banker draws on 0-5, stands on 6-7.
   - **If Player drew a third card:** Banker acts per the table below, based on Banker's two-card total and the *value* of Player's third card (Ace = 1, 10/face = 0).

   | Banker total | Banker draws if Player's third card is | Banker stands if |
   |---|---|---|
   | 0, 1, 2 | any | never |
   | 3 | 0-7, 9 | 8 |
   | 4 | 2-7 | 0, 1, 8, 9 |
   | 5 | 4-7 | 0-3, 8, 9 |
   | 6 | 6-7 | 0-5, 8, 9 |
   | 7 | never | always |

5. Each hand receives at most one third card. No further cards are drawn.
6. Compare final totals (see Scoring). Settle bets, collect cards to the discard, and begin the next coup from the same shoe. The shoe is reshuffled when the cut card appears (the coup in progress is finished; a new shoe is used for the next coup).

## 6. Terms

- **Coup:** One round of play.
- **Natural:** A two-card total of 8 or 9 (9 is the "grand natural" in some usage).
- **Punto / Banco:** Player / Banker hand. "Tie" is also called "égalité" or "standoff".
- **Commission:** The fee on winning Banker bets (see below).

## 7. Scoring and Payouts

- Higher total wins; equal totals are a Tie.
- **Player bet:** pays 1:1.
- **Banker bet:** pays 1:1 minus 5% commission on the win (i.e. 19:20), commission typically tracked and collected later or at once.
- **Tie bet:** pays 8:1 (standard).
- **Tie result:** Player and Banker bets **push** (stake returned); only Tie bets win.
- House edge (8 decks): Banker ~1.06%, Player ~1.24%, Tie ~14.4%.
- There is no fixed "end of game": play continues coup after coup until players leave or the casino closes the table.

## 8. Edge Cases and Clarifications

- Players cannot choose to draw or stand; the rules are mandatory for both hands, and bettors' choices affect only wagers.
- If Player has a natural and Banker does not (or vice versa), the non-natural hand does not draw.
- If both hands have naturals, the higher wins; equal = Tie.
- Banker with 7 always stands; with 0-2 always draws (when no natural exists and Player drew).
- A Player third card of 8 is the only card that stops Banker 3 from drawing; Banker 6 draws only on Player third card 6 or 7.
- Third-card values use baccarat values (10/J/Q/K = 0, Ace = 1).
- Face-up/face-down presentation of cards (squeeze, "calling" cards) is ceremonial and does not affect results.

## Appendix A: Rule Variations

| Variation | Difference from main body |
|---|---|
| Deck count | 6 decks instead of 8 (Bicycle mentions both); some tables use 1-10 decks, changing the edge. |
| Tie payout | 9:1 (e.g. some UK casinos, ~4.85% edge) instead of 8:1. |
| Commission | Some sources list Banker as 19:20 equivalent; commission rate may differ by casino (4-5%). |
| EZ Baccarat / no commission | Banker pays 1:1 with no commission, except Banker wins with a three-card total of 7 (Dragon 7), which pushes. |
| Dragon 7 / Panda 8 side bets | Dragon 7: Banker wins with three-card 7, pays 40:1. Panda 8: Player wins with three-card 8, pays 25:1. |
| Pair side bets | Bet that Player's or Banker's first two cards are a pair (payouts vary by casino). |
| Mini-baccarat | Smaller table, dealer handles cards, faster play; same drawing rules. |
| Chemin de fer | Players bank the game in rotation and Player-side holder may choose to draw or stand on 5; not Punto Banco. |
| Baccarat banque | Three-player format with rotating banker; not Punto Banco. |
| Cut card position | Varies by casino. |

## Sources

- https://en.wikipedia.org/wiki/Baccarat_(card_game)
- https://en.wikipedia.org/wiki/Punto_banco
- https://www.pagat.com/banking/baccarat.html
- https://bicyclecards.com/how-to-play/baccarat
- https://wizardofodds.com/games/baccarat/
