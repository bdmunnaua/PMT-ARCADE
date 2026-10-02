/** Ludo board geometry on a 15×15 grid (x = column, y = row). Colour 0 = red (top-left), clockwise. */
import { HOME, LAST_TRACK } from '@arena/games/ludo';

export const LUDO_COLORS = ['#e11d48', '#16a34a', '#eab308', '#2563eb'];
export const LUDO_COLOR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'];
/** [light, base, dark] per colour, for the shaded 3D board and pawns */
export const LUDO_SHADES: [string, string, string][] = [
  ['#fb7185', '#e11d48', '#881337'],
  ['#4ade80', '#16a34a', '#14532d'],
  ['#fde047', '#eab308', '#854d0e'],
  ['#60a5fa', '#2563eb', '#1e3a8a'],
];

type Cell = [number, number];

function segment(from: Cell, to: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  let [x, y] = from;
  out.push([x, y]);
  while (x !== to[0] || y !== to[1]) {
    x += dx;
    y += dy;
    out.push([x, y]);
  }
  return out;
}

/** The 52 shared squares; index 0 is red's start, 13 green's, 26 yellow's, 39 blue's. */
export const TRACK: Cell[] = [
  ...segment([1, 6], [5, 6]),
  ...segment([6, 5], [6, 0]),
  [7, 0],
  ...segment([8, 0], [8, 5]),
  ...segment([9, 6], [14, 6]),
  [14, 7],
  ...segment([14, 8], [9, 8]),
  ...segment([8, 9], [8, 14]),
  [7, 14],
  ...segment([6, 14], [6, 9]),
  ...segment([5, 8], [0, 8]),
  [0, 7],
  [0, 6],
];

export const HOME_COLUMNS: Cell[][] = [segment([1, 7], [5, 7]), segment([7, 1], [7, 5]), segment([13, 7], [9, 7]), segment([7, 13], [7, 9])];

/** base origins (top-left cell of each 6×6 corner) */
export const BASES: Cell[] = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];

export const STARS = [0, 8, 13, 21, 26, 34, 39, 47];

/** Grid cell (centre, in cell units) of a token. */
export function tokenCell(color: number, progress: number, token: number): [number, number] {
  if (progress < 0) {
    const [bx, by] = BASES[color]!;
    const slots: Cell[] = [
      [1.75, 1.75],
      [4.25, 1.75],
      [1.75, 4.25],
      [4.25, 4.25],
    ];
    const [sx, sy] = slots[token]!;
    return [bx + sx, by + sy];
  }
  if (progress <= LAST_TRACK) {
    const [x, y] = TRACK[(color * 13 + progress) % 52]!;
    return [x + 0.5, y + 0.5];
  }
  if (progress < HOME) {
    const [x, y] = HOME_COLUMNS[color]![progress - LAST_TRACK - 1]!;
    return [x + 0.5, y + 0.5];
  }
  const centre: Cell[] = [
    [6.9, 7.5],
    [7.5, 6.9],
    [8.1, 7.5],
    [7.5, 8.1],
  ];
  return centre[color]!;
}
