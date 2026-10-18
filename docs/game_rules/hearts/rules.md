# Hearts

Hearts is a trick-taking game for (usually) four players in which each player tries to AVOID taking hearts and the queen of spades; the lowest score wins.

## 1. Components

- Standard 52-card deck, no jokers.
- Rank (high to low): A K Q J 10 9 8 7 6 5 4 3 2. Suits: clubs, diamonds, spades, hearts. There is no trump suit.
- Players: 4 (standard, individual play, no partnerships). 3 and 5 player adaptations are in Appendix A.
- Penalty cards: each heart = 1 point (13 total); Queen of Spades = 13 points. Total per hand: 26.

## 2. Objective

Finish the game with the lowest total score. The game ends when a player reaches or exceeds 100 points; the player with the lowest total then wins.

## 3. Setup and Dealing

1. Choose the first dealer at random; the deal then rotates clockwise each hand.
2. The dealer shuffles and deals all 52 cards one at a time, face down, clockwise, so each player has 13 cards.
3. Scores start at 0.

### Passing phase (before play)

Each hand has a pass direction, cycling every four hands:

| Hand # (mod 4) | Pass 3 cards to |
|---|---|
| 1 | Left (next clockwise) |
| 2 | Right |
| 3 | Across (opposite) |
| 4 | No pass ("hold" hand) |

- Every player selects 3 cards and places them face down for the receiving player.
- Selection is simultaneous/independent: a player must choose and set down the cards to pass BEFORE picking up the cards passed to them.
- After all passes are complete, players look at their new 13-card hands.

## 4. Gameplay (per hand)

1. **First trick lead**: the player holding the 2 of clubs (after passing) must lead it.
2. **Play order**: clockwise. Each trick has one card from each player.
3. **Follow suit**: a player must play a card of the suit led if able. If void in that suit, any card may be played (subject to the first-trick restriction below).
4. **Winning a trick**: the highest card of the suit led wins (there is no trump). The winner collects the trick and leads the next trick.
5. **First trick restriction**: a player who is void in clubs on the first trick may not play a heart or the Queen of Spades on it (they may play any other card). If a void player holds nothing but hearts and/or the Queen of Spades, they have no other legal card and may play one (see Edge Cases).
6. **Leading hearts**: hearts may not be led until hearts are "broken", i.e. a heart (or, in the Bicycle rule, the Queen of Spades) has been played to an earlier trick as a discard. Exception: a player whose hand contains only hearts may lead a heart.
7. **Leading other suits**: any non-heart card may be led at any time after the first trick, including the Queen of Spades.
8. The hand ends after 13 tricks. Players tally penalty cards in tricks they won.

## 5. Special Cards and Terms

- **Queen of Spades** ("Black Lady", "Black Maria"): 13 penalty points.
- **Hearts**: 1 penalty point each.
- **Breaking hearts**: the first time a heart is played (discarded) on a trick, hearts may be led thereafter.
- **Shooting the moon**: one player wins all 13 hearts and the Queen of Spades in a single hand.
- **Painting / slough**: playing a penalty card onto a trick (usually onto an opponent's winning trick).
- **Smoking out the queen**: leading low spades to force the Queen of Spades out.
- **Passing**: exchange of 3 cards at the start of a hand.

## 6. Scoring and End of Game

- After each hand, each player scores 1 point per heart taken plus 13 for the Queen of Spades. Points always sum to 26 per hand (unless the moon is shot).
- **Shooting the moon**: the shooter scores 0 for the hand and each opponent scores 26. (Common alternative: the shooter instead subtracts 26 from their own score; see Appendix A.)
- Scores accumulate across hands. The game ends at the end of the hand in which any player reaches or exceeds 100 points. The lowest total wins.
- Ties for lowest: play further hands until the tie is broken (common practice).

## 7. Edge Cases and Clarifications

- A void player on the first trick holding only hearts and/or the Queen of Spades may play a penalty card (inferred from "play legally if possible"; not spelled out in all sources).
- The 2 of clubs holder is determined AFTER passing.
- Discarding the Queen of Spades breaks hearts in the Bicycle rule; in other rule sets only a heart breaks hearts (Appendix A).
- Players holding only hearts when they must lead may lead hearts even if hearts are not broken.
- On the no-pass hand, play begins immediately with the 2 of clubs.
- Dealer rotates each hand regardless of the pass direction.

## Appendix A: Rule Variations

Differences from the main body are noted.

1. **Shooting the moon, alternative**: the shooter may choose to either subtract 26 from their own score or add 26 to each opponent's score (Pagat, Wikipedia). Main body uses the "opponents +26, shooter 0" convention (Bicycle, most computer versions).
2. **Hearts broken by Queen of Spades**: In Bicycle's rules, discarding the Queen of Spades also breaks hearts. In Pagat/Wikipedia, only a heart does. Main body follows Bicycle's.
3. **Jack of Diamonds (Omnibus Hearts)**: the J of diamonds (sometimes 10 of diamonds) is worth -10 (older scoring) or a bonus of 10 to the taker. Shooting the moon then requires also taking the jack.
4. **Spot Hearts**: hearts score their pip value (J=11, Q=12, K=13, A=14); target score 500.
5. **Black Maria (British)**: usually 3 players; extra spade penalties A=10, K=7, Q=13; passing always in one direction; no hearts-breaking restriction.
6. **3 players**: remove the 2 of diamonds (51 cards) so each has 17 cards; the 3 of clubs leads first (Bicycle). Alternatively keep a "kitty" that the first trick winner takes.
7. **5 players**: remove the 2 of clubs (Bicycle) so each has 10 cards, or remove both 2 of diamonds and 2 of clubs and use a kitty; Pagat describes a kitty going to the first trick winner. Lead is then the lowest remaining club.
8. **Passing variants**: passing may be skipped, or pass counts other than 3.
9. **Game length**: end score of 50 (shorter) or a fixed number of hands instead of 100.
10. **Turbo Hearts**: ten of clubs doubles taker's score; players may pre-charge penalty cards to double their value.
11. **Cancellation Hearts**: 6 to 11 players, two decks; identical cards played in a trick cancel.
12. **First trick**: some rule sets allow penalty cards on the first trick, while Pagat and Wikipedia note that most forbid it.

## Sources

- https://www.pagat.com/reverse/hearts.html
- https://en.wikipedia.org/wiki/Hearts_(card_game)
- https://bicyclecards.com/how-to-play/hearts
