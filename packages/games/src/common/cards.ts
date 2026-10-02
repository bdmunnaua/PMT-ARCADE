/**
 * Playing-card helpers shared by Call Bridge and Twenty-Nine.
 * A card is a 2-character code: rank + suit, e.g. "AS" (ace of spades), "TD" (ten of diamonds).
 * Shuffling always uses the room's server-side cryptographic random source (ctx.random).
 */
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];
export type Card = string;

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const RANK_LABEL: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

export const suitOf = (c: Card): Suit => c[1] as Suit;
export const rankOf = (c: Card): string => c[0]!;
export const isRed = (c: Card): boolean => suitOf(c) === 'H' || suitOf(c) === 'D';
export const label = (c: Card): string => `${RANK_LABEL[rankOf(c)] ?? rankOf(c)}${SUIT_SYMBOL[suitOf(c)]}`;

export function makeDeck(ranks: readonly string[]): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of ranks) deck.push(`${r}${s}`);
  return deck;
}

/** Fisher–Yates with the provided random source in [0, 1). */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Sort a hand for display: by suit (S, H, C, D alternating colours), then by the given rank order. */
export function sortHand(hand: Card[], rankOrder: readonly string[]): Card[] {
  const suitOrder: Suit[] = ['S', 'H', 'C', 'D'];
  return [...hand].sort((a, b) => suitOrder.indexOf(suitOf(a)) - suitOrder.indexOf(suitOf(b)) || rankOrder.indexOf(rankOf(a)) - rankOrder.indexOf(rankOf(b)));
}

export const nextSeat = (seat: number, players: number): number => (seat + 1) % players;
