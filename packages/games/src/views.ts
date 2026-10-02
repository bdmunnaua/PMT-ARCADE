/**
 * What each game's GameModule.viewFor() sends to a player (type-only; used by the web clients).
 * Secret information (other hands, a hidden trump) is never part of a view.
 */
import type { Card, Suit } from './common/cards';
import type { LudoState } from './ludo/rules';
import type { CarromShot, CarromColor } from './carrom/rules';
import type { Piece } from './carrom/physics';

export type LudoView = LudoState & { you: number; deadline: number | null };

export interface TrickPlayView {
  player: number;
  card: Card;
}

export interface CallBridgeView {
  you: number;
  round: number;
  rounds: number;
  dealer: number;
  phase: 'BIDDING' | 'PLAYING' | 'ROUND_END' | 'OVER';
  turn: number;
  deadline: number | null;
  hand: Card[];
  handCounts: number[];
  legal: Card[];
  bids: (number | null)[];
  tricksWon: number[];
  trick: TrickPlayView[];
  lastTrick: { plays: TrickPlayView[]; winner: number } | null;
  scores: number[];
  history: { bids: number[]; tricks: number[]; delta: number[] }[];
  forfeited: boolean[];
  winner: number | null;
  draw: boolean;
}

export interface TwentyNineView {
  you: number;
  yourTeam: number | null;
  hand: Card[];
  handCounts: number[];
  handNumber: number;
  dealer: number;
  phase: 'BIDDING' | 'TRUMP' | 'PLAYING' | 'HAND_END' | 'OVER';
  turn: number;
  deadline: number | null;
  bid: number | null;
  bidder: number | null;
  passed: boolean[];
  bidLog: { player: number; bid: number | null }[];
  mustBid: boolean;
  trump: Suit | null;
  trumpChosen: boolean;
  /** the face-down trump card (bidder only) and whether it is still set aside */
  trumpCard: Card | null;
  trumpFaceDown: boolean;
  trumpRevealed: boolean;
  target: number;
  pairShown: { player: number; team: number } | null;
  trick: TrickPlayView[];
  lastTrick: { plays: TrickPlayView[]; winner: number; points: number } | null;
  legal: Card[];
  canReveal: boolean;
  canShowPair: boolean;
  teamPoints: [number, number];
  gameScore: [number, number];
  history: { bidder: number; bid: number; target: number; trump: Suit; points: [number, number]; made: boolean }[];
  winnerTeam: number | null;
  draw: boolean;
}

export interface ChessView {
  you: 'w' | 'b' | null;
  fen: string;
  moves: string[];
  turn: 'w' | 'b';
  inCheck: boolean;
  clock: { w: number; b: number };
  turnStartedAt: number | null;
  drawOfferBy: 'w' | 'b' | null;
  result: { type: 'WIN'; winner: 'w' | 'b'; reason: string } | { type: 'DRAW'; reason: string } | null;
}

export interface CarromView {
  you: number;
  colors: CarromColor[];
  coins: Piece[];
  pocketedBy: Record<CarromColor, string[]>;
  queen: { status: 'BOARD' | 'PENDING' | 'COVERED'; by: number | null };
  turn: number;
  phase: 'AIM' | 'OVER';
  deadline: number | null;
  lastShot: CarromShot | null;
  shots: number;
  winner: number | null;
  draw: boolean;
  baseline: { min: number; max: number; y: [number, number] };
}
