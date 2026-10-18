# Spades

A four-player, partnership trick-taking game with a fixed trump suit (spades) in which each side bids a number of tricks and scores by meeting or missing that contract.

## 1. Components

- **Deck:** standard 52-card French-suited deck, no jokers.
- **Rank (high to low) in every suit:** A K Q J 10 9 8 7 6 5 4 3 2.
- **Suits:** Spades are permanently trump. The other suits (clubs, diamonds, hearts) have no ordering.
- **Players:** 4, in two fixed partnerships. Partners sit opposite each other (seats 0 and 2 vs. seats 1 and 3).
- **Other:** a score record per partnership (score and accumulated bags).

## 2. Objective

Each partnership bids a number of tricks and tries to win at least that many in total. Individual players may instead bid Nil (win no tricks). The first partnership to reach the target score (default 500) wins.

## 3. Setup and Dealing

1. The first dealer is chosen at random (e.g., each player draws a card, high card deals). Afterwards the deal rotates one seat clockwise each hand.
2. The deck is shuffled. (The player to the dealer's right may cut.)
3. The dealer deals all 52 cards face down, one at a time, clockwise, starting with the player to the dealer's left. Each player receives 13 cards.
4. Misdeal (unequal hands or out-of-turn deal): the same dealer reshuffles and redeals.

## 4. Gameplay

### 4.1 Bidding (single round)

1. Starting with the player to the dealer's left and proceeding clockwise (dealer last), each player bids exactly once. Bids are not cumulative or ranked, and nobody may pass.
2. A bid is an integer from 0 to 13, where **0 is "Nil"**. Partners' non-Nil bids are added to form the partnership **contract**.
3. **Nil:** the bidder undertakes to win zero tricks. The partner's bid is still made and scored separately.
4. **Blind Nil:** a Nil bid declared before the bidder looks at their cards. It is typically only allowed to a side that is behind (see Appendix) and is worth double (200).
5. Bidding is open: everyone hears every bid.

### 4.2 Trick play (13 tricks)

1. The player to the dealer's left leads the first trick. The leader may lead any card except a spade, unless the player holds only spades.
2. Play proceeds clockwise, one card per player.
3. **Follow suit:** a player must play a card of the suit led if able. A player with no card of that suit may play any card (including a spade, which trumps).
4. **Trick winner:** if any spades were played to a trick that did not lead spades, the highest spade wins. Otherwise the highest card of the suit led wins.
5. The trick winner collects the trick and leads the next trick.
6. **Spades broken:** a spade may not be led until a spade has been played on an earlier trick as a trump (discarded on a non-spade lead), or the leader holds only spades. Once broken, spades may be led by anyone for the rest of the hand.
7. Played tricks are turned face down and may not be examined afterwards, except to check for a revoke. Each side's trick count must remain visible.

### 4.3 Hand resolution

After 13 tricks, count tricks won by each partnership and score per section 6.

## 5. Special Cards, Actions and Terms

- **Trick / Book:** four cards, one from each player.
- **Contract:** the sum of a partnership's non-Nil bids.
- **Set:** failing to make the contract.
- **Bag (sandbag, overtrick):** each trick won above the contract.
- **Nil:** a bid to win no tricks; **Blind Nil:** Nil bid without looking at the hand.
- **Breaking spades:** first time a spade is played to a trick not led in spades.
- **Revoke / renege:** failing to follow suit when able.

## 6. Scoring and Winning

Score each partnership after every hand. Nil bids are scored independently of the contract.

### 6.1 Contract (non-Nil bids)

- **Made** (tricks >= contract): +10 x contract, plus +1 per bag (trick above contract).
- **Set** (tricks < contract): -10 x contract.
- Example: contract 5, took 8 tricks: 50 + 3 = 53.

### 6.2 Nil

- **Nil made:** +100. **Nil failed** (the bidder wins one or more tricks): -100.
- **Blind Nil made:** +200. **Blind Nil failed:** -200.
- The partner's contract is scored normally on its own. Tricks won by a failed Nil bidder do not count toward the partner's bid, but do count as bags for the partnership (majority treatment; see Appendix for the alternative).

### 6.3 Bags

- Each side tracks cumulative bags across hands.
- Upon reaching 10 bags, the side loses 100 points and 10 bags are removed from its tally (the ones digit "rolls over"). The penalty is applied after that hand's score is added. A side accumulating 20 bags loses another 100, and so on.

### 6.4 End of game

- Default target: **500 points**. The game ends at the end of a hand in which a side reaches 500 or more.
- If both sides reach 500 or more in the same hand, the higher score wins.
- If tied at or above the target, further hands are played until the tie is broken.
- Common alternative loss condition: a side falling to -200 loses (some groups use -500).

## 7. Edge Cases and Clarifications

- A bid is binding once spoken; there is no second round or revision.
- A player holding only spades may lead a spade even if unbroken.
- A spade played because a player is void in the led suit breaks spades; a spade led legally (only-spades hand) also makes spades broken thereafter.
- Both partners may bid Nil. Each Nil is scored independently (the two have no shared contract in that case).
- If both partners bid Nil, the partnership contract is 0; all tricks they win are bags.
- Contract total of 0 (e.g., a lone Nil with partner bidding 0 as well) is permitted by the basic rules.
- Revoke: sources differ on the penalty (the side forfeits its contract, or adds tricks to its bid). Mutually agree on one before play; the engine should simply forbid illegal plays rather than model revokes.
- Spades-only first lead: if the first leader holds only spades, that spade may be led.
- Cards played cannot be taken back once the next player has played.
- Dealer is the last to bid; dealer rotation continues regardless of who won the previous hand.

## Appendix A: Rule Variations

Items below differ from the main body.

**Scoring and thresholds**
- Target scores of 200 (short game), 300, 1000, or 250 (quick); lose at -200 or -500.
- Fixed or time-limited number of hands.
- Failed contract scores 0 rather than -10 x bid (Bicycle's basic version).
- Penalty for being set is 10 per trick short rather than 10 x bid.
- Bags: -1 point each (no 10-bag penalty); no bag penalty at all; bags only counted in units digit; bag penalty of 100 per 10 is the standard.
- A designated card (often 3 of spades) cancels a bag if won.
- Nil bidders are immune to the bag penalty (Bicycle); failed-Nil tricks count toward partner's bid (some houses).
- Ten-bag penalty alternatives: 10 bags = -100 is the majority rule.

**Nil variants**
- Half-value Nil: 50 / -50.
- Blind Nil allowed only when behind (typically 100+ points, NYC rules) and with a two-card face-down exchange with partner after bidding.
- Double Nil: both partners Nil; 500 (or 400/800 blind) bonus, penalty 250-500, or auto-loss.
- Blind bidding: bid without looking, bonus bid x 20.
- Nil failure automatically sets partner (some houses).

**Bidding variants**
- Minimum total or individual bid (e.g., 4 tricks each side); ban of totals equal to 13.
- Partnership bidding (partners confer and announce a joint bid); second raising round.
- Mirror: bid equals number of spades held (Nil only with no spades).
- Whiz: bid exact spade count or Nil.
- Suicide: each partnership must have exactly one Nil bidder or a bid of at least 4.
- Misdeal call: hand with no spades (or one spade, a 7+-card suit, or no face cards) can be thrown in and the dealer redeals.
- 10-for-200 (win at least 10 tricks for +200, else -200); Boston/Moon (all 13 tricks for 200, or outright win); Blind Moon 400; Bemo (little/big, first 6 or 9 tricks, +/-60 or 90); No Trump (double stakes); Ace bonus (100 for all four aces).

**Card and play variants**
- 54-card deck with jokers: Joker-Joker-Deuce-Deuce (big joker, little joker, 2 of spades, 2 of diamonds as top trumps; 2 clubs and 2 hearts removed); Joker-Joker-Deuce-Ace; Deuces high (all 2s top trumps).
- Spades may be led any time (no breaking rule); in NYC rules, spades may not be led in first three tricks.
- Dealer leads the first trick (African-American tradition, per Barmore).
- First trick: everyone plays lowest club.
- Pass three cards face down to partner before bidding.
- NYC rules: bids 4-10; at most 2 bags allowed on non-blind bids or side is set; two consecutive sets loses game; making 13 ("Boston") wins.
- Penalty for revoke: contract forfeited or three tricks added to the bid.

**Other player counts**
- 3 players: 17 cards each (discard 1, or 18 each with jokers); lead 2 of clubs, individual scoring.
- 2 players: draw/discard alternately until 13 kept each.
- 6 players: three partnerships of two, 102 cards (two decks with low cards removed); if identical cards tie, the later one wins.
- Solo/Cutthroat: four players, no partners; Solo may compel beating the highest card.
- Three players plus dummy hand.

## Sources

- https://www.pagat.com/auctionwhist/spades.html
- https://en.wikipedia.org/wiki/Spades_(card_game)
- https://bicyclecards.com/how-to-play/spades
- https://www.officialgamerules.org/spades
