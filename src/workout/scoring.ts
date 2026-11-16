import type { Band, Segment } from './workout';

export type Zone = 'low' | 'close-low' | 'in' | 'close-high' | 'high';

/** Where a value sits relative to a band. "close" = within 5 % outside. */
export function zoneOf(value: number, band: Band): Zone {
  if (value >= band.lo && value <= band.hi) return 'in';
  const margin = Math.max(2, (band.hi + band.lo) / 2 * 0.05);
  if (value < band.lo) return value >= band.lo - margin ? 'close-low' : 'low';
  return value <= band.hi + margin ? 'close-high' : 'high';
}

export const isIn = (z: Zone) => z === 'in';
export const isLow = (z: Zone) => z === 'low' || z === 'close-low';

export interface ScoreState {
  /** seconds of active workout time evaluated */
  time: number;
  powerIn: number;
  spmIn: number;
  /** 0 = threat on top of you, 1 = safe distance */
  threat: number;
  coins: number;
  combo: number;
}

export const newScore = (): ScoreState => ({ time: 0, powerIn: 0, spmIn: 0, threat: 1, coins: 0, combo: 0 });

/**
 * Advances the score by dt seconds. Hitting the power band is what matters most;
 * stroke rate counts half. Being too low lets the threat close in, being too high
 * earns nothing (protects against overdoing it). There is no game over.
 */
export function updateScore(s: ScoreState, dt: number, seg: Segment, power: number, spm: number): { power: Zone; spm: Zone } {
  const pz = zoneOf(power, seg.power);
  const sz = zoneOf(spm, seg.spm);
  s.time += dt;
  if (isIn(pz)) s.powerIn += dt;
  if (isIn(sz)) s.spmIn += dt;

  // Threat distance: recovers in band, shrinks when too low, holds when too high
  const rate = isIn(pz) ? 0.06 : isLow(pz) ? (pz === 'low' ? -0.08 : -0.03) : 0;
  s.threat = Math.max(0, Math.min(1, s.threat + rate * dt));

  // Coins: one per second fully in band, combo grows while it lasts
  if (isIn(pz) && isIn(sz)) {
    s.combo += dt;
    s.coins += dt * (1 + Math.min(4, Math.floor(s.combo / 15)));
  } else if (!isIn(pz)) s.combo = 0;
  return { power: pz, spm: sz };
}

/** Share of time in band, power weighted 2:1 over stroke rate. */
export const accuracy = (s: ScoreState) => (s.time > 0 ? (2 * s.powerIn + s.spmIn) / (3 * s.time) : 0);

export function stars(s: ScoreState): 0 | 1 | 2 | 3 {
  const a = accuracy(s);
  return a >= 0.85 ? 3 : a >= 0.7 ? 2 : a >= 0.5 ? 1 : 0;
}
