/** A real 3D dice cube (CSS transforms) that tumbles onto the rolled face each time `rollId` changes. */
import type { CSSProperties } from 'react';
import clsx from 'clsx';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// cube rotation that brings face n (DOM child n, see game3d.css) to the front
const FACE: Record<number, [number, number]> = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

export function Dice3D({ value, rollId, size = 64, dim, className }: { value: number | null; rollId: number; size?: number; dim?: boolean; className?: string }) {
  const [fx, fy] = FACE[value ?? 1]!;
  // whole extra turns per roll make every roll tumble, even when the same number repeats
  // the fixed leading tilt shows three faces so the cube reads as 3D at rest
  const transform = `rotateX(-20deg) rotateY(-26deg) rotateX(${fx + rollId * 720}deg) rotateY(${fy + rollId * 360}deg)`;
  return (
    <div className={clsx('dice-scene', dim && 'opacity-50', className)} style={{ '--size': `${size}px` } as CSSProperties} role="img" aria-label={value ? `Dice shows ${value}` : 'Dice'}>
      <div className="dice" style={{ transform }}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="dice-face">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={clsx(PIPS[n]!.includes(i) && 'pip', n === 1 && 'red')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
