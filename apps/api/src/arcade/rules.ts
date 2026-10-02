/**
 * Free arcade games and their reward rules (from the original pmtarcade.com, unchanged).
 * The server decides rewards — games only report a score.
 *   divisor        PMT = floor(score / divisor)
 *   maxPerRun      PMT cap for a single game
 *   minSec         a game shorter than this earns nothing
 *   maxScorePerSec scores faster than this are rejected as impossible
 *   maxScore       absolute score ceiling for one game
 *   slack          extra score allowed on top of maxScorePerSec × seconds (default 50)
 * Display fields (name, genre, emoji, tag, colours) drive the game cards.
 */
export interface ArcadeGameRule {
  name: string;
  genre: string;
  emoji: string;
  tag: string;
  colors: [string, string];
  isNew: boolean;
  divisor: number;
  maxPerRun: number;
  minSec: number;
  maxScorePerSec: number;
  maxScore: number;
  slack?: number;
}

export const ARCADE_GAMES: Record<string, ArcadeGameRule> = {
  'neon-rush': { name: 'Neon Rush', genre: 'Arcade', emoji: '🚀', tag: 'Dodge & collect', colors: ['#0ea5e9', '#7c3aed'], isNew: false, divisor: 40, maxPerRun: 100, minSec: 8, maxScorePerSec: 160, maxScore: 400000 },
  'fruit-rush': { name: 'Fruit Rush', genre: 'Match-3', emoji: '🍓', tag: 'Swap & match', colors: ['#f43f5e', '#f59e0b'], isNew: false, divisor: 60, maxPerRun: 100, minSec: 15, maxScorePerSec: 400, maxScore: 1000000 },
  'slide-puzzle': { name: 'Slide Puzzle', genre: 'Puzzle', emoji: '🧩', tag: 'Order the tiles', colors: ['#14b8a6', '#0f766e'], isNew: false, divisor: 25, maxPerRun: 150, minSec: 5, maxScorePerSec: 200, maxScore: 3750 },
  'block-fit': { name: 'Block Fit', genre: 'Puzzle', emoji: '🟪', tag: 'Fill rows & cols', colors: ['#a855f7', '#6366f1'], isNew: true, divisor: 50, maxPerRun: 100, minSec: 15, maxScorePerSec: 200, maxScore: 1000000 },
  'merge-2048': { name: '2048 Merge', genre: 'Puzzle', emoji: '🔢', tag: 'Slide & merge', colors: ['#f59e0b', '#ea580c'], isNew: true, divisor: 100, maxPerRun: 100, minSec: 20, maxScorePerSec: 250, maxScore: 4000000 },
  'tower-stack': { name: 'Tower Stack', genre: 'One-tap', emoji: '🏗️', tag: 'Tap to stack', colors: ['#ec4899', '#8b5cf6'], isNew: true, divisor: 2, maxPerRun: 80, minSec: 5, maxScorePerSec: 25, maxScore: 20000, slack: 10 },
  'bubble-pop': { name: 'Bubble Pop', genre: 'Shooter', emoji: '🫧', tag: 'Aim & pop', colors: ['#06b6d4', '#3b82f6'], isNew: true, divisor: 50, maxPerRun: 100, minSec: 15, maxScorePerSec: 200, maxScore: 1000000 },
  'brick-breaker': { name: 'Brick Breaker', genre: 'Arcade', emoji: '🧱', tag: 'Bounce & break', colors: ['#22c55e', '#0891b2'], isNew: true, divisor: 40, maxPerRun: 100, minSec: 10, maxScorePerSec: 150, maxScore: 1000000 },
  'color-sort': { name: 'Color Sort', genre: 'Puzzle', emoji: '🧪', tag: 'Pour & sort', colors: ['#f472b6', '#6366f1'], isNew: true, divisor: 5, maxPerRun: 100, minSec: 10, maxScorePerSec: 40, maxScore: 100000 },
  'sky-hop': { name: 'Sky Hop', genre: 'One-tap', emoji: '🐤', tag: 'Tap to fly', colors: ['#38bdf8', '#16a34a'], isNew: true, divisor: 1, maxPerRun: 60, minSec: 3, maxScorePerSec: 1.3, maxScore: 5000, slack: 3 },
  'knife-throw': { name: 'Knife Throw', genre: 'One-tap', emoji: '🔪', tag: 'Hit the log', colors: ['#b45309', '#7c2d12'], isNew: true, divisor: 2, maxPerRun: 80, minSec: 5, maxScorePerSec: 10, maxScore: 20000, slack: 15 },
  'fruit-slice': { name: 'Fruit Slice', genre: 'Action', emoji: '🍉', tag: 'Swipe to slice', colors: ['#ef4444', '#16a34a'], isNew: true, divisor: 2, maxPerRun: 80, minSec: 8, maxScorePerSec: 8, maxScore: 20000, slack: 20 },
  'snake-arena': { name: 'Snake Arena', genre: 'Arcade', emoji: '🐍', tag: 'Eat & grow', colors: ['#22c55e', '#14532d'], isNew: true, divisor: 10, maxPerRun: 80, minSec: 5, maxScorePerSec: 25, maxScore: 100000, slack: 40 },
  'bounce-up': { name: 'Bounce Up', genre: 'Arcade', emoji: '🦘', tag: 'Jump higher', colors: ['#db2777', '#4c1d95'], isNew: true, divisor: 20, maxPerRun: 80, minSec: 5, maxScorePerSec: 80, maxScore: 500000, slack: 40 },
  'rhythm-tiles': { name: 'Rhythm Tiles', genre: 'Music', emoji: '🎹', tag: 'Tap the beat', colors: ['#0f172a', '#6366f1'], isNew: true, divisor: 4, maxPerRun: 80, minSec: 5, maxScorePerSec: 10, maxScore: 20000, slack: 10 },
  'learn-english': { name: 'Learn English', genre: 'Learning', emoji: '📚', tag: 'বাংলা → English', colors: ['#14b8a6', '#0e7490'], isNew: true, divisor: 10, maxPerRun: 100, minSec: 10, maxScorePerSec: 30, maxScore: 100000, slack: 40 },
};

/** Daily check-in reward by streak day, in PMT (day 7+ repeats the last value). */
export const CHECKIN_TOKENS = [10, 15, 20, 25, 30, 40, 60];
export const MAX_RUNS_PER_HOUR = 120;
/** a game left open longer than this can no longer be saved */
export const RUN_MAX_MS = 3 * 3600_000;

/** Reward for a finished game, in whole PMT, before the daily cap. */
export function judgeRun(g: ArcadeGameRule, score: number, seconds: number): { tokens: number; flagged: boolean; message: string } {
  if (score > g.maxScore || score > g.maxScorePerSec * seconds + (g.slack ?? 50)) {
    return { tokens: 0, flagged: true, message: 'Score could not be verified, so no PMT was given.' };
  }
  if (seconds < g.minSec) return { tokens: 0, flagged: false, message: 'Play a little longer to earn PMT.' };
  const tokens = Math.min(g.maxPerRun, Math.floor(score / g.divisor));
  return { tokens, flagged: false, message: tokens ? '' : `Score ${g.divisor}+ to earn your first PMT.` };
}

// Bangladesh time (UTC+6, no daylight saving) — "today" for caps and check-ins
const BD_OFFSET = 6 * 3600_000;
export const bdDate = (ms: number) => new Date(ms + BD_OFFSET).toISOString().slice(0, 10);
export const bdDayStart = (ms: number) => {
  const d = new Date(ms + BD_OFFSET);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - BD_OFFSET;
};

/**
 * Weekly tournament: Monday 00:00 → next Monday 00:00, Bangladesh time. The featured game
 * rotates through this list (games with a wide score range, so ties are rare).
 */
export const TOURNAMENT_GAMES = ['neon-rush', 'tower-stack', 'merge-2048', 'snake-arena', 'fruit-slice', 'brick-breaker', 'sky-hop', 'block-fit', 'knife-throw', 'bubble-pop', 'bounce-up', 'fruit-rush', 'rhythm-tiles', 'color-sort'];
/** the first tournament week (earlier weeks are never paid) */
export const TOURNAMENT_FIRST_WEEK = '2026-09-28';
export const WEEK_MS = 7 * 86_400_000;
/** prizes are paid this long after the week ends, so games started before the end can still finish */
export const TOURNAMENT_GRACE_MS = RUN_MAX_MS;

/** Start (ms) of the Bangladesh week containing `ms`. */
export function tournamentWeekStart(ms: number): number {
  const daysSinceMonday = (new Date(ms + BD_OFFSET).getUTCDay() + 6) % 7;
  return bdDayStart(ms) - daysSinceMonday * 86_400_000;
}

export function tournamentWeek(startMs: number): { weekStart: string; gameId: string; startsAt: number; endsAt: number } {
  const epoch = Date.UTC(2026, 0, 5) - BD_OFFSET; // a Monday, Bangladesh time
  const i = Math.round((startMs - epoch) / WEEK_MS);
  const n = TOURNAMENT_GAMES.length;
  return { weekStart: bdDate(startMs), gameId: TOURNAMENT_GAMES[((i % n) + n) % n]!, startsAt: startMs, endsAt: startMs + WEEK_MS };
}
