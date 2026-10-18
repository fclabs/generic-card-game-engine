# Cribbage

A 2-player (also 3 or 4) card game in which players build scores by combining cards in a pegging play phase ("the play") and in counting hands ("the show"), recording points on a board; first to 121 wins.

## 1. Components

- Standard 52-card deck, no jokers. Rank order (for runs): A(low) 2 3 4 5 6 7 8 9 10 J Q K(high). No wrap-around (Q-K-A is not a run). Suits are irrelevant except for flushes and His Nob.
- Pip values for counting to 15/31: A=1, 2-10 = face value, J=Q=K=10.
- Players: 2 (standard). 3 and 4 player versions in Appendix A.
- Scoring: cribbage board (120 holes plus game hole) with 2 pegs per player (leapfrogging), or any score counter. Scores only increase.
- The main body below describes standard 2-player, 6-card cribbage.

## 2. Objective

Be the first player to reach 121 points (the game hole). The exact total is not required; scoring ends the instant a player reaches 121, even mid-play or mid-count.

## 3. Setup and Dealing

1. Choose the first dealer: each player cuts; the lower card deals (ace is low). The dealer owns the crib for that hand. Deal alternates each hand.
2. Dealer shuffles; opponent (non-dealer) may cut.
3. Dealer deals 6 cards face down to each player, one at a time, starting with the non-dealer. Remaining cards form the stock.
4. Each player discards 2 cards face down to form the crib (4 cards total), which belongs to the dealer and is scored by the dealer at the show. Each player keeps 4 cards.
5. The non-dealer cuts the stock (at least a few cards in each portion). The dealer turns up the top card of the lower portion: this is the **starter** (cut card), placed face up on the stock.
6. **His Heels**: if the starter is a jack, the dealer immediately scores 2.

## 4. Gameplay

A hand has three phases: (1) discard and cut (above), (2) the play (pegging), (3) the show (counting). Then the deal passes.

### 4.1 The Play (pegging)

Each player keeps their 4 cards in hand and plays them one at a time, face up, in front of them (not into a shared pile). Cards played since the last reset are still visible for runs/pairs.

1. The non-dealer plays first. The running count starts at 0.
2. On their turn a player lays a card and announces the new running total (sum of pip values of all cards played since the last reset). The total must never exceed 31.
3. A player who cannot play without exceeding 31 must say "Go" (pass). If a player can play, they must play (no voluntary passing).
4. When the opponent says Go, the other player continues playing any cards they legally can, one after another, scoring normally.
5. **Reset**: when neither player can play without exceeding 31 (or the count hits exactly 31), the count returns to 0. The player who did not play the last card leads the next sequence. Cards already played are no longer eligible for pairs/runs in the new sequence.
6. Play ends when all cards (4 each, 8 total) have been played. Each player then picks up their own 4 played cards for the show.

#### Scoring during the play

Points are pegged immediately by the player who plays the card:

| Event | Points |
|---|---|
| Count reaches exactly 15 | 2 |
| Count reaches exactly 31 | 2 |
| "Go"/last card: last card played when count is under 31 and neither player can continue | 1 |
| Pair: card matches rank of the previous card | 2 |
| Pair royal: third consecutive card of the same rank | 6 |
| Double pair royal: fourth consecutive card of same rank | 12 |
| Run: the card just played completes a run of 3+ of the most recent consecutive cards (any order, any suit); score = run length | 3, 4, 5, 6, 7 |

Notes:
- Pairs and runs only count among the most recent consecutive cards in the current sequence (since the last reset). A run is judged on the longest tail of the sequence that forms a run, e.g. played 4, 6, 5 = run of 3; then 3 makes 4-6-5-3 = run of 4; played order may be arbitrary, only the set of the last n cards must be consecutive ranks.
- A single card may score several things at once (e.g. reaching 15 and a pair = 2+2). Runs and pairs interrupted by an unrelated card do not count (e.g. 5, 5, 6 scores the pair on the second 5 only; 6 completes no run).
- Face cards pair only by exact rank (K-K, not K-Q); for runs, J/Q/K are consecutive ranks.

### 4.2 The Show (counting)

After the play, hands are counted in this order, each using the player's 4 cards plus the starter (5 cards):
1. Non-dealer's hand
2. Dealer's hand
3. Dealer's crib (4 crib cards plus starter)

Each player pegs their points as they count. Scoring stops the instant a player reaches 121 (hence non-dealer counting first is an advantage near the end).

| Combination | Points |
|---|---|
| Each distinct set of cards totalling 15 | 2 each |
| Each pair (same rank) | 2 (three of a kind = 3 pairs = 6; four of a kind = 6 pairs = 12) |
| Run of 3 / 4 / 5 | 3 / 4 / 5 (a double run, e.g. 3-3-4-5, counts each run separately: 3+3+2 for the pair) |
| Flush: all 4 hand cards same suit | 4 |
| Flush: 4 hand cards plus starter same suit | 5 |
| His Nob: jack in hand matching suit of starter | 1 |

- A flush in hand needs all 4 hand cards of one suit; the starter adds 1 if it matches too. 3 hand cards plus starter does not score.
- **Crib flush**: scores only as a 5-card flush (all 4 crib cards and the starter same suit). A 4-card crib flush alone scores nothing.
- Maximum hand: 29 (5-5-5-J with J matching the suit of a 5 starter). Impossible scores: 19, 25, 26, 27 (a 0-point hand is sometimes called a "nineteen" hand).

## 5. Special Cards and Terms

- **Crib / box**: dealer's extra hand made of discards.
- **Starter / cut card**: the face-up card shared by all hands.
- **His Heels**: jack as starter, 2 points to dealer.
- **His Nob**: jack in hand/crib matching starter suit, 1 point.
- **Go**: inability to play under 31; also the 1 point for last card.
- **Pegging**: scoring during the play (also moving pegs).
- **Pair royal / double pair royal**: three / four of a kind.
- **Peg out**: reaching 121.

## 6. Scoring and Winning

- First to 121 wins immediately, regardless of the phase of the hand.
- Winning games is the usual unit; matches are often best of 3/5/7.
- Common stakes: a "skunk" win (opponent under 91 when the winner reaches 121) counts double or as a bonus; see Appendix A.
- Scoring order within a hand matters only for who reaches 121 first: His Heels, then the play, then non-dealer's hand, dealer's hand, crib.

## 7. Edge Cases and Clarifications

- A card whose play makes exactly 31 scores 2 (not the extra 1 for Go); the opponent then leads the next sequence.
- If the count is 15 or 31 and a pair/run is made simultaneously, all scores are added.
- After a player says Go, the opponent continues playing any cards that fit under 31; a player who can play must play. When neither can, the count resets.
- The last card of the play always scores 1 for Go (or 2 if it makes 31). The last-card point is awarded to whoever played the last card of the sequence, including the final card of the whole play.
- If a player runs out of cards, the opponent continues alone, scoring normally.
- Hands count 4 cards plus starter, even though a player played them out: they must be retained in order to be shown.
- Cards played in the play are not revealed to the show in a different group; each player recovers exactly their own four cards.
- A jack starter gives His Heels immediately; if that takes the dealer to 121, the game ends before any play.
- Runs in the show need no particular order; a card can be part of several scoring combinations (fifteens, pairs, runs all overlap).
- Misdeal and over-scoring penalties are house rules and are not standardised in the sources consulted; an engine should simply deal correctly and compute scores automatically.
- Pegs: a player's front peg shows their current score; back peg shows the previous score, allowing verification.

## Appendix A: Rule Variations

Differences from the main body are marked.

1. **Muggins** (optional, common in the US/Canada): if a player under-counts points in the show or crib, the opponent may call "muggins" and peg the missed points. Main body has no muggins; players simply score what they claim.
2. **5-card cribbage** (older form): deal 5 each, each discards 2 to the crib (keeping 3); play to 61; pegging to 31 only once; non-dealer starts with a 3-point head start (Wikipedia). Differs in deal, discards and target.
3. **3 players**: deal 5 cards each plus 1 card to the crib; each player discards 1; 4 cards each and 4 in the crib. Player to dealer's left leads; after two Gos the third player keeps playing. Individual or 2-vs-1.
4. **4 players (partnership)**: 5 cards each, each discards 1 to dealer's crib; partners opposite, one pegger per team; play continues until all four say Go.
5. **2 players, alternative**: deal 5 cards each plus 2 to the crib; each player discards 1 (Wikipedia/Pagat).
6. **Starter cut**: some groups deal without a non-dealer cut; some allow the non-dealer to take the starter from the cut.
7. **Skunks / lurches**: win with opponent under 91 = skunk (double game/bonus); under 61 = double skunk (some play 4x); under 31 = triple skunk in some circles. Bicyclecards: a loser under 61 is lurched and the winner scores two games. Thresholds differ by source.
8. **Short games**: play to 61 (one lap), or 91 (Manchester, England).
9. **Endgame restrictions** (house rules): cannot win on "Go", or cannot score His Heels, when within a few points of 121.
10. **Lowball / loser's crib**: first to 121 loses.
11. **Nine-card, auction, jokers wild** and other exotic forms exist; not covered.

## Sources

- https://www.pagat.com/adders/crib6.html (Pagat: Cribbage, six-card)
- https://en.wikipedia.org/wiki/Rules_of_cribbage
- https://bicyclecards.com/how-to-play/cribbage
