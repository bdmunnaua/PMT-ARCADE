# Installed games

| Slot | Game | Players | Type | Server rules | Browser client |
|---|---|---|---|---|---|
| game-01 | Ludo | 2–4 | room (PvP) | `packages/games/src/ludo/` | `apps/web/src/games/ludo/` |
| game-02 | Call Bridge | 4 | room (PvP, individual) | `packages/games/src/call-bridge/` | `apps/web/src/games/call-bridge/` |
| game-03 | Twenty-Nine (29) | 4 (2 v 2) | room (PvP, teams) | `packages/games/src/twenty-nine/` | `apps/web/src/games/twenty-nine/` |
| game-04 | Aviator | any | crash (house-banked) | `packages/games/src/aviator/` + `apps/api/src/durable/crash-game.ts` | `apps/web/src/games/aviator/` |
| game-05 | Carrom | 2 | room (PvP) | `packages/games/src/carrom/` | `apps/web/src/games/carrom/` |
| game-06 | Chess | 2 | room (PvP) | `packages/games/src/chess/` | `apps/web/src/games/chess/` |
| game-07 … 10 | free slots | | | | |

Every room game is **server-authoritative**: dice, shuffles and physics run in the GameRoom Durable Object with a cryptographic random source; the browser only sends intentions (roll, play this card, shoot at this angle) and every move is validated. Outcomes go through `validateResult` and then the single settlement service (1% fee, exactly once).

**Look:** the tables are drawn in 3D with CSS 3D transforms (no WebGL, so they stay smooth on budget phones): tilted wooden boards with a visible edge, standing Ludo pawns and chess pieces, a tumbling dice cube, cards on a felt table that fly in from the player who played them, shaded carrom coins, and a perspective night-sky scene for Aviator. Shared styles live in `apps/web/src/games/shared/game3d.css` (`stage-3d`, `slab`, `upright`, `Dice3D`). Tapping and aiming stay exact on the tilted boards (carrom uses the board's own coordinates).

**Feel (compared with Ludo King, Callbreak/29 apps, Carrom Pool, chess.com and Spribe Aviator):** pawns hop square by square and auto-move when there is only one choice; finished tricks stay on the table for a moment with the winner highlighted and then sweep to the winner; chess shows the last move, captured pieces with the material lead, and a promotion chooser; carrom has pull-back shooting with an aim guide; Aviator has two bet panels with auto bet. Sound effects are synthesised in the browser (no audio files) with a mute button in every game (`games/shared/sound.ts`), plus a ping when it becomes your turn.

Idle players never freeze a table: each module sets a **turn timer**; when it fires the server plays for the idle player (Ludo, Call Bridge, 29) or passes / flags (Carrom, Chess).

## Ludo
- Roll a 6 to bring a token out; move by the die; exact roll to reach home.
- Landing on an opponent (not on ★/start squares) sends it home. Extra roll for a 6, a capture or reaching home; three 6s in a row lose the turn.
- 2 players sit on opposite colours. First player with all four tokens home wins the whole pot (minus 1%).
- Timer: 12 s to roll, 15 s to move (auto-played if missed). Three missed turns in a row → removed from the game; the last player left wins.

## Call Bridge (Call Break, Bangladesh style)
- 52 cards, 13 each, ♠ always trump; redeal if any hand has no spade.
- Each player calls 1–13 tricks. Follow suit and beat the winning card if you can; if you can't follow you must trump (overtrumping if possible; if no spade can win you may discard).
- Round score: made → +call (+0.1 per extra trick); missed → −call. 5 rounds; highest total wins the pot; equal top scores → draw (refund).
- Timer: 20 s per call/card (auto-played). A forfeiting player is auto-played and cannot win.

## Twenty-Nine (29)
- 32 cards (7–A); rank J 9 A 10 K Q 8 7; points J3 9:2 A1 10:1 = 28 per hand. Partners sit opposite (seats 1 & 3 vs 2 & 4).
- 4 cards each (redealt if anyone's four cards hold no points) → bidding 16–28 (if the first three pass, the fourth must bid 16) → the bidder sets **one of their four cards face down**: its suit is trump. That card stays out of their hand until the trump is revealed → 4 more cards each.
- Follow suit. If you can't, you may **call the trump open**; the face-down card goes back to the bidder and you must play a trump if you hold one. Before the reveal trumps have no power. If nobody calls it, the bidder plays the face-down card in the last trick (it is revealed and counts as trump).
- **Pair** (K+Q of trump, after the reveal, once your team has won a trick after the reveal): target −4 for the bidding team, +4 against it.
- Bidding team reaches the target → +1 game point, otherwise −1. First team to +6 wins (−6 loses); after 12 hands the higher score wins, tie = draw.
- Settlement: both partners win; pot minus 1% split equally (4 × 1,000 → each winner 1,980). A player who leaves forfeits for the team.

## Carrom
- Server physics on a 1000 × 1000 board with real proportions (coin, striker, pocket sizes), friction, elastic collisions and cushions; the browser replays the server's keyframes.
- Player 1 White, player 2 Black. Place the striker on your baseline, then pull back from it and let go (or tap to aim and press Shoot). A guide shows the first coin you will hit and where it goes. Pocketing your coin (or the Queen) = shoot again.
- Queen: only after your first coin; must be covered by pocketing your coin in the same or next shot, else it returns.
- Foul (striker pocketed): coins pocketed in that shot, the Queen and one earlier coin return to the centre; turn passes.
- Your last coin before the Queen is covered: foul — it returns with one earlier coin and the turn passes (ICF).
- Pocketing the opponent’s last coin gives them the board.
- All 9 of a colour pocketed with the Queen covered (by either player): that colour wins.
- Timer: 30 s per shot; a missed shot passes the turn; three misses forfeit.

## Chess
- Full rules via chess.js (castling, en passant, promotion, check/mate, stalemate, threefold repetition, 50-move rule, insufficient material). Colours assigned randomly.
- Blitz 5 min + 3 s per move, enforced by the server clock. Flag fall loses (draw if the opponent cannot mate). Resign or agree a draw any time.

## Aviator (crash game)
- Rounds run continuously while someone is watching: 7 s betting → the plane takes off, multiplier = e^(0.00006·t) (2× ≈ 11.6 s) → it flies away at the crash point → 4 s pause.
- Up to **two bets per round** (bet panels 1 and 2, as in Spribe's Aviator), each with an optional auto cash-out ≥ 1.01× and an auto-bet switch that re-places it every round. Press **Cash out** before the crash: payout = stake × multiplier (floored), profit capped per bet (setting `crash_max_profit_tokens`); maximum multiplier `crash_max_multiplier_x100` (default 100×).
- **Provably fair**: SHA-256 of a random server seed is shown before betting; crash = f(HMAC-SHA256(seed, round number)), with ≈1% of rounds ending instantly at 1.00× (house edge ≈ 1%, RTP ≈ 99%). The seed is revealed after the round; the page has a **Verify** button that recomputes it in your browser.
- Money: bets lock stake (BONUS first, then AVAILABLE) like matches; wins are paid from **HOUSE_BANKROLL** (stake back + profit), lost stakes go to HOUSE_BANKROLL. No 1% match fee — the house edge is the platform's margin.
- Bankroll safety: every bet stores its maximum possible profit; bets are refused (`BANKROLL_LIMIT`) unless the bankroll covers the sum for all open bets, so a round can never owe more than the bankroll holds. Fund it in **Admin → Finance → House bankroll** (treasury → bankroll transfer, audited). Withdrawals cannot go below open exposure.
- Cash-out timing is decided by the server clock only. If a round is interrupted (engine evicted), the cron refunds open bets after 10 minutes.

## Ideas for the free slots (07–10)
Snakes & Ladders, Dots & Boxes, Callbreak-style **Spades for 2 teams**, **Rummy (Marriage)**, Teen Patti-style 3-card comparison, Tic-tac-toe ultimate, Connect Four, 8-ball pool (reuse the Carrom physics engine), Kabaddi/football penalty shoot-out (timing skill game). Each is a new folder in `packages/games/src/` and `apps/web/src/games/` — see [ADDING_A_GAME.md](ADDING_A_GAME.md).
