/**
 * Game sound effects, synthesised with Web Audio (no audio files to download). Muting is a
 * per-device preference. Browsers only allow audio after a user gesture, so sounds requested
 * before the first tap/click are silently skipped.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type SoundName = 'dice' | 'step' | 'capture' | 'card' | 'move' | 'take' | 'check' | 'clack' | 'pocket' | 'turn' | 'win' | 'lose' | 'cashout' | 'crash';

const KEY = 'arena.sound';
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx.state === 'running' ? ctx : null;
}

// unlock audio on the first gesture
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (!muted) audio();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

function tone(a: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function noise(a: AudioContext, at: number, dur: number, gain: number, filterFreq: number) {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(at);
}

export function playSound(name: SoundName): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  switch (name) {
    case 'dice':
      for (let i = 0; i < 6; i++) noise(a, t + i * 0.07 + Math.random() * 0.02, 0.045, 0.5, 1800 + Math.random() * 1500);
      break;
    case 'step':
      tone(a, t, 900, 0.05, 'triangle', 0.12);
      break;
    case 'capture':
      tone(a, t, 320, 0.25, 'square', 0.12, 90);
      noise(a, t, 0.12, 0.4, 500);
      break;
    case 'card':
      noise(a, t, 0.08, 0.35, 3500);
      break;
    case 'move':
      noise(a, t, 0.05, 0.6, 1200);
      tone(a, t, 220, 0.06, 'sine', 0.15);
      break;
    case 'take':
      noise(a, t, 0.07, 0.8, 900);
      tone(a, t, 160, 0.1, 'sine', 0.2);
      break;
    case 'check':
      tone(a, t, 660, 0.12, 'triangle', 0.15);
      tone(a, t + 0.1, 880, 0.15, 'triangle', 0.15);
      break;
    case 'clack':
      noise(a, t, 0.04, 0.9, 2600);
      break;
    case 'pocket':
      tone(a, t, 180, 0.18, 'sine', 0.3, 70);
      break;
    case 'turn':
      tone(a, t, 784, 0.12, 'sine', 0.12);
      tone(a, t + 0.11, 1046, 0.16, 'sine', 0.12);
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(a, t + i * 0.12, f, 0.3, 'triangle', 0.16));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) => tone(a, t + i * 0.16, f, 0.3, 'sine', 0.14));
      break;
    case 'cashout':
      tone(a, t, 988, 0.12, 'sine', 0.18);
      tone(a, t + 0.08, 1318, 0.25, 'sine', 0.18);
      break;
    case 'crash':
      noise(a, t, 0.5, 0.9, 300);
      tone(a, t, 200, 0.5, 'sawtooth', 0.08, 40);
      break;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? 'off' : 'on');
  } catch {
    /* preference not saved — still applies for this visit */
  }
  if (!value) audio();
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
    () => false,
  );
}

/**
 * Plays a sound whenever `key` changes after the first render (so opening a page mid-game is
 * silent). `pick` may return null to stay quiet for a particular change.
 */
export function useSoundOnChange(key: string | number | null | undefined, pick: () => SoundName | null): void {
  const [first] = useState(key);
  const last = useRef(key);
  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    if (key === first || key === null || key === undefined) return;
    const name = pick();
    if (name) playSound(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
