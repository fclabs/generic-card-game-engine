# Bridge (Contract Bridge)

A four-player, two-partnership trick-taking game in which players bid for the right to name trumps and the number of tricks their side must take, then play out 13 tricks. This file documents **rubber bridge** as the main body, with duplicate scoring covered where it differs.

## 1. Components

- Standard 52-card deck, no jokers. Rank high to low: A K Q J 10 9 8 7 6 5 4 3 2 in every suit.
- Suit ranking (for bidding only): No Trump > Spades > Hearts > Diamonds > Clubs. Spades and hearts are "majors", diamonds and clubs are "minors".
- 4 players in 2 fixed partnerships. Partners sit opposite: North-South vs East-West.
- Traditionally two decks are used alternately (one is shuffled while the other is played). Play is identical either way.
- Score pad with a line: points "below the line" count towards game; points "above the line" are bonuses and penalties.

## 2. Objective

Bidding: win the auction by naming a contract (level 1-7 plus a denomination) that your side then tries to fulfil. Play: the declaring side must take at least (6 + level) tricks; the defenders try to stop them. Over the match, score the most points; in rubber bridge the first side to win two games wins the rubber.

## 3. Setup and Dealing

1. Seats are assigned by drawing cards (in rubber bridge the player drawing the highest card chooses seat and deck, and the two highest cards partner). The first dealer is determined by this draw.
2. The deck is shuffled by the dealer's opponent offering a cut (the player to the dealer's right shuffles/cuts).
3. The dealer deals all 52 cards face down, one at a time, clockwise, starting with the player on their left. Each player gets 13 cards.
4. The deal passes clockwise after every hand.
5. A misdeal (card faced during deal, wrong number of cards in a hand) requires a redeal by the same dealer if noticed before the auction starts.

## 4. Turn Structure / Gameplay

### 4.1 The Auction (bidding)

- The dealer makes the first call; calls proceed clockwise. Each turn a player must make exactly one call:
  - **Pass.**
  - **Bid**: a level (1-7) and a denomination (clubs, diamonds, hearts, spades, no trump). A bid of level N commits to taking N + 6 tricks. A bid must be higher than the last bid: either a higher level, or the same level with a higher denomination (C < D < H < S < NT). Lowest bid 1C, highest 7NT.
  - **Double**: legal only when the most recent bid was made by an opponent and has not already been doubled.
  - **Redouble**: legal only when the most recent bid was made by your own side and was doubled by an opponent (and not yet redoubled).
- Doubles and redoubles do not change bid ranking. Any later bid cancels earlier doubles/redoubles.
- Partners may not communicate other than through calls; no information from gestures or tone.
- **End of auction**: the auction ends when three consecutive passes follow any call (bid, double or redouble). If all four players pass with no bid, the hand is "passed out": it is not played, scores nothing, and the next dealer deals.
- **Contract**: the last bid, with any double/redouble. **Declarer**: the member of the declaring side who first bid the contract's denomination (in any bid, for that side). Declarer's partner is **dummy**. The other side are the **defenders**.

### 4.2 The Play

1. The defender to declarer's left (the **opening leader**) leads any card face up to the first trick.
2. After the opening lead, dummy lays their whole hand face up on the table, sorted by suit in columns (trumps on dummy's right, i.e. declarer's left) with cards in descending order. Dummy then takes no part in decisions: declarer plays dummy's cards by naming them. Dummy may not suggest plays or look at defenders' hands.
3. Play is clockwise. Each trick has four cards, one from each player.
4. **Must follow suit**: a player holding a card of the led suit must play one. A player void in the led suit may play any card, including a trump.
5. **Trick winner**: the highest trump played, if any trump was played; otherwise the highest card of the led suit. (In a no-trump contract, the highest card of the led suit wins.)
6. The winner of a trick leads to the next. The side that took the trick gathers it (one player per side collects tricks; tricks are kept face down in order, so counts are verifiable).
7. After 13 tricks the hand ends. The declaring side succeeds if it won at least 6 + level tricks.
8. Players may only look back at their own side's last trick before it is turned over.

## 5. Special Cards / Actions / Terms

- **Trump**: the contract denomination (if not NT); outranks all other suits. **No trump (NT)**: no suit is trump.
- **Book**: first 6 tricks of declarer's side; they score nothing. **Odd tricks**: tricks above six.
- **Part-score**: contract worth under 100 trick points. **Game**: contract worth 100 or more trick points (3NT, 4H/4S, 5C/5D or higher; or accumulated part-scores in rubber). **Small slam**: contract of 6 (12 tricks). **Grand slam**: contract of 7 (13 tricks).
- **Overtrick / undertrick**: tricks won above / short of the contract.
- **Vulnerable**: a side that has won a game in the current rubber; higher bonuses and penalties apply.
- **Honours**: A, K, Q, J, 10 of trumps; in NT, the four aces.
- **Dummy**, **declarer**, **opening leader**: see section 4.

## 6. Scoring and End of Game (Rubber Bridge)

### 6.1 Trick score (below the line, declaring side only, only if contract made)
Per trick bid and made (tricks 7+ in the book, i.e. only contracted tricks):

| Denomination | Undoubled | Doubled | Redoubled |
|---|---|---|---|
| Clubs / Diamonds | 20 each | 40 each | 80 each |
| Hearts / Spades | 30 each | 60 each | 120 each |
| No Trump | 40 first, 30 each after | 80 / 60 | 160 / 120 |

### 6.2 Game and rubber
- Trick scores go below the line. When a side's below-the-line total in the current game reaches 100 or more, it wins that game. A line is then drawn: both sides start the next game below the line at 0 (part-scores do not carry over). A doubled contract made below 100 can combine to a game (e.g. 2H doubled = 120 = game).
- A side that has won one game is vulnerable.
- First side to win two games wins the **rubber**. Rubber bonus (above the line, to winners): **700** if the opponents won no game, **500** if opponents won one game.
- At the end of the rubber, the side with the greater total (above + below, including bonuses) wins; the margin is the result.

### 6.3 Bonuses and penalties (above the line)

**Overtricks (declarer's side):**

| | Undoubled | Doubled NV | Doubled V | Redoubled NV | Redoubled V |
|---|---|---|---|---|---|
| Clubs/Diamonds | 20 each | 100 each | 200 each | 200 each | 400 each |
| Hearts/Spades/NT | 30 each | 100 each | 200 each | 200 each | 400 each |

(NV = not vulnerable, V = vulnerable.)

**Insult bonus** for making a doubled contract: 50; redoubled: 100.

**Slam bonuses:**

| | NV | V |
|---|---|---|
| Small slam (6 bid and made) | 500 | 750 |
| Grand slam (7 bid and made) | 1000 | 1500 |

**Undertricks (penalty to the defenders, above the line):**

| Undertrick | NV undoubled | V undoubled | NV doubled | V doubled | NV redoubled | V redoubled |
|---|---|---|---|---|---|---|
| 1st | 50 | 100 | 100 | 200 | 200 | 400 |
| 2nd, 3rd | 50 each | 100 each | 200 each | 300 each | 400 each | 600 each |
| 4th and later | 50 each | 100 each | 300 each | 300 each | 600 each | 600 each |

**Honours (above the line, to the side holding them, whether declaring or defending; announced at hand end):**
- Five trump honours in one hand: 150.
- Any four trump honours in one hand: 100.
- Four aces in one hand in a NT contract: 150.
- Honours in a passed-out hand are not scored.

### 6.4 Duplicate bridge scoring (differences)
- Each board is played by several tables with the same pre-dealt hands; vulnerability is preset by board number, not by games won. No rubber, no honours bonuses.
- Trick scores as above; instead of accumulating to game, each board scores a bonus for the contract made: **part-score 50**; **game 300 (NV) / 500 (V)** (when trick score is 100+). Slam, doubling and overtrick/undertrick scores are as above.
- Standard vulnerability by board number (repeating every 16): 1 none; 2 N-S; 3 E-W; 4 all; 5 N-S; 6 E-W; 7 all; 8 none; 9 E-W; 10 all; 11 none; 12 N-S; 13 all; 14 none; 15 N-S; 16 E-W. Dealer rotates N, E, S, W with board 1 dealt by North.
- Results are compared with the other tables on the same board: **matchpoints** (points for each pair beaten, half for ties) or **IMPs** (score difference converted via a standard table, 0 IMPs for 0-10 points up to 24 IMPs for 4000+).

## 7. Edge Cases and Clarifications

- A bid that is insufficient (not higher than the previous) or out of turn is an irregularity; in casual play the offender may correct it by making a legal bid; formal rules assign penalties (see Appendix).
- Once the auction ends, no further calls are made. The contract cannot be changed.
- If the final contract is doubled/redoubled, scores are those of 6.1 and 6.3.
- Declarer's side scores trick points only for the contracted tricks; overtricks are above the line.
- Undertrick penalties go to the defenders; declarer's side scores nothing for the hand beyond honours.
- Declarer may play from either hand; the card is played once named (or touched) from the dummy.
- **Revoke** (failing to follow suit when able): if corrected before the revoking side plays to the next trick, the card is withdrawn, a legal card is played, and the opponents may get further penalty under formal laws. If established (the revoker's side has played to the next trick), the card stands and the penalty is normally 2 tricks transferred to the non-offenders (rubber bridge: counted as tricks won, scored as if made in play, only 1 if the revoker had not won the revoke trick or any later trick). Duplicate: the director adjusts the score. Details are simplified here.
- **Claim**: a player may claim the remaining tricks by showing their hand and stating a line; play ceases and if the opponents accept, the claimed tricks count. Disputes are decided by the director/table consent.
- Lead out of turn, exposed cards, or a lead from the wrong hand: the next player may accept it or require/forbid a lead of a suit (rubber bridge: declarer or defender chooses; formal laws).
- A player who looks at another's hand or receives unauthorized information is subject to director adjustment.
- Correct hands: if a hand has other than 13 cards, it must be rectified before play; if a card is missing, the hand is redealt.
- A game of rubber bridge ends when two games won. An unfinished rubber at stopping time: a side with a game scores 300 bonus; a side with only a part-score in an unfinished game scores 100.

## Appendix A: Rule Variations

| Variation | Difference from main body |
|---|---|
| **Chicago (four-deal bridge)** | A round is four deals. Vulnerability: deal 1 none; deals 2 and 3 only the dealer's side; deal 4 both. Part-score bonus 100, game 300 NV / 500 V, slam bonuses as standard; no rubber bonus, no honours; part-scores do not carry over. |
| **Duplicate bridge** | Preset deals, vulnerability by board, game/part-score bonuses per board, matchpoint or IMP comparison (section 6.4). |
| **Honours values** | Some sources do not score honours at all in modern play (all duplicate and many club rubbers). |
| **Rubber bonus** | Some old/American rules give 700 / 500; older rules have 250 for a three-game rubber; main body uses 700 / 500. |
| **Unfinished rubber bonus** | Some clubs: 300 for a game, 100 for a part-score, as in section 7; others vary. |
| **Revoke penalty** | Rubber bridge formal law: two-trick transfer; duplicate: director adjusts. Informal home rules: simple correction with no penalty. |
| **Undertrick doubling** | Wikipedia's summary table for undertricks is inconsistent with Pagat and the laws on vulnerable undoubled undertricks (100 each, as above); the main body follows Pagat and standard laws. |
| **Passed-out hands** | In some home games a passed-out hand is simply redealt by the same dealer; main body passes the deal clockwise. |
| **Nullos/Misère, Chinese/Honeymoon, Boston** | Related games, not standard bridge. |
| **Acol vs Standard American vs 2/1** | Bidding systems (conventions) are partnership agreements only; the rules of play are unchanged. |

## Appendix B: Notes on Sources

Where sources agreed (Pagat, Wikipedia, Bicycle Cards) their shared rule is in the body. Dummy-behaviour and irregularity penalty details are summarised from the standard laws as reflected in Pagat and are simplified.

## 10. Sources

- https://www.pagat.com/auctionwhist/bridge.html
- https://en.wikipedia.org/wiki/Contract_bridge
- https://bicyclecards.com/how-to-play/bridge
- https://en.wikipedia.org/wiki/Glossary_of_contract_bridge_terms
