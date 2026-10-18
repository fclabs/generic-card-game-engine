# Crazy Eights

Crazy Eights is a shedding game in which players match the rank or suit of the top discard, eights are wild, and the first player to empty their hand wins the round.

## 1. Components

- **Deck:** one standard 52-card deck, no jokers. Two shuffled decks may be used for many players (6+).
- **Players:** 2-7 (Pagat: 2-8; Wikipedia: 2-7; Bicycle: 2-5+). Best with 3-5.
- **Card ranks/suits:** 4 suits (clubs, diamonds, hearts, spades); ranks A, 2-10, J, Q, K. Rank order is irrelevant to play; only matching matters.
- **Zones:** each player's hand (private), stock (face-down draw pile), discard pile (face-up; only the top card matters).
- **State:** an "active suit" that normally equals the suit of the top discard but is overridden when an eight is played.

## 2. Objective

Be the first player to get rid of all the cards in your hand. Optionally, accumulate points over several rounds (section 7).

## 3. Setup and dealing

1. Choose a dealer (any method); the dealer shuffles.
2. Deal cards one at a time, face down, clockwise starting left of the dealer: **5 cards each** (**7 each in a 2-player game**).
3. Place the remaining cards face down as the stock.
4. Turn the top stock card face up to start the discard pile (the "starter").
   - If the starter is an eight: the majority rule (Pagat/Wikipedia) is that the dealer nominates the suit and play proceeds normally. Bicycle instead buries it in the stock and turns another (see Appendix A).
5. Play begins with the player to the dealer's left and proceeds clockwise.

## 4. Turn structure / gameplay

On your turn, exactly one of the following happens:

1. **Play a card.** Place one card from your hand face up on the discard pile if it is legal:
   - it has the **same suit** as the top discard (or as the active suit nominated by an eight), or
   - it has the **same rank** as the top discard, or
   - it is an **eight** (always legal, regardless of top card).
2. **Draw.** If you cannot play, draw cards one at a time from the stock until you draw a playable card (then you may play it) or the stock is empty. If the stock is empty and you still have no playable card, you **pass**.
3. Drawing is mandatory when you cannot play. Most sources also allow drawing voluntarily even if you hold a playable card (Wikipedia, Bicycle); Pagat notes stricter play requires playing if able (see Appendix A).

After a play, check for round end: if the player's hand is empty, the round ends (section 7). Otherwise play passes to the next player clockwise.

### Pseudocode

```
legal(card, top, activeSuit):
    return card.rank == 8 or card.suit == activeSuit or card.rank == top.rank
turn(player):
    if any legal card: (player may play one, or draw voluntarily)
    else: while stock not empty: draw; if drawn legal -> may play, stop
          if still nothing playable: pass
after playing a non-eight: activeSuit = card.suit
after playing an eight:    activeSuit = nominated suit (player's choice, may be the eight's own suit)
```

## 5. Special cards, actions, terms

- **Eight (wild):** may be played on any card at any time. The player must **nominate a suit** (never a rank). The next player must play that suit or another eight (a card matching the *rank* of the eight is only playable if it is an eight itself, since the active suit replaces the eight's own suit).
- **Starter:** the first face-up discard.
- **Stock / talon:** the draw pile.
- **Active suit:** the suit currently required.
- **Pass:** allowed only when the stock is empty and no legal card is held.
- The core game has no other action cards (queen, ace, two effects are variations; see Appendix A).

## 6. Stock exhaustion

Sources differ slightly. Majority (Pagat and Wikipedia-style) handling: when the stock runs out, players who cannot play pass. Pagat additionally describes reshuffling the discard pile (all but the top card) into a new stock; Wikipedia and Bicycle do not reshuffle and simply let players pass. This document's default is: **no reshuffle; players without a legal card pass. If every player passes consecutively, the round is blocked** and ends (section 7). Reshuffle is listed in Appendix A.

## 7. Scoring and winning

- **Round end:** a round ends when a player plays their last card (that player wins the round), or when the game is blocked.
- **Blocked game:** the player with the lowest total card value in hand wins the round (Pagat/Wikipedia-style; some simple rule sets say fewest cards, see Appendix A).
- **Card values (penalty points):** eight = **50**; K, Q, J, 10 = **10**; ace = **1**; 2-9 (other than eight) = pip value.
- **Winner's score:** the round winner scores the sum of the card values remaining in all opponents' hands.
- **Game winner:** play multiple rounds; the first player to reach **100 points** wins (Wikipedia: target 50 x number of players; Bicycle: 100 is not specified, play until agreed). A single round with no scoring is also a valid game. Default: target = 50 x number of players, configurable.
- Dealer rotates to the left after each round.

## 8. Edge cases and clarifications

- Nominating a suit when playing an eight: any of the four suits, including the eight's own suit.
- Eight as the last card: the player wins the round; the nomination is irrelevant.
- A player may only play one card per turn (multi-card plays of equal rank are a variation).
- Drawn cards are not required to be played immediately unless they are legal and the player chooses; a player who draws a playable card may play it or keep drawing only under voluntary-draw rules, but must stop drawing once they have a legal card by the common "draw until playable" rule.
- Stock empty at the start of the game: not applicable with 5-7 card deals from 52 cards.
- With two decks, identical cards may exist; legality is unaffected.
- Hand sizes are public information; contents are hidden.
- A player holding no legal card with an empty stock passes without penalty.

## Appendix A: Rule Variations

| Variation | Difference from main body |
|---|---|
| Starter is an eight | Bury it and turn another (Bicycle) rather than dealer nominating a suit (Pagat). |
| Deal size | 6 cards each (some rule sets, ages 4+, 2-4 players); 7 each for 2 players is standard; some deal 8. |
| Draw limit | Draw exactly one card per turn, then pass if unplayable (common house rule). Differs from "draw until playable". |
| Must-play | You must play if able; no voluntary drawing (strict version). |
| Reshuffle | When stock is empty, shuffle the discard pile except the top card into a new stock (Pagat), instead of passing. |
| Queen = skip | Next player misses a turn. |
| Ace = reverse | Reverses play direction (in 2-player games acts as a skip/extra turn). |
| Two = draw two | Next player draws two or plays a two on it (stacking allowed in some versions). |
| "Last card" call | Announce "last card" when down to one card or draw 2 penalty cards (Pagat house rule). |
| Special last card | If the winner's last card is a special card, its effect is ignored. |
| Multiple same-rank play | Several cards of the same rank may be played in one turn. |
| Stacking eights | Eights may be stacked (some house rules). |
| Blocked-game winner | Fewest cards in hand wins (officialgamerules) rather than lowest point value. |
| No scoring | Single-round game with no points (officialgamerules). |
| Crazy Eights Countdown | Start with 8 cards, decrease by one each round; the rank equal to the number of cards dealt is wild for that round (8, 7, 6, ... Ace). |
| Special-effect ranks | Which ranks are skip/reverse/draw varies by house; Uno-like rules are the commercial game "Uno"/"Crazy 8s" derivatives. |

## Sources

- https://www.pagat.com/eights/crazy8s.html
- https://en.wikipedia.org/wiki/Crazy_Eights
- https://bicyclecards.com/how-to-play/crazy-eights
- https://www.officialgamerules.org/card-games/crazy-eights
