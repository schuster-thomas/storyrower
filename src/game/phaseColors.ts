import type { PhaseId } from '../workout/workout';

/** One colour per story phase (setup preview, results chart). */
export const PHASE_COLORS: Record<PhaseId, string> = { idyll: '#5cb86a', omens: '#e3b94e', escalation: '#f08a3c', finale: '#ee5b52', winddown: '#f6c27c' };

/** Colour by difficulty only (workout preview, custom trainings): easy green → amber → hard red. */
export function difficultyColor(intensity: number): string {
  const stops: [number, [number, number, number]][] = [[0, [102, 187, 106]], [0.5, [236, 178, 58]], [1, [229, 83, 61]]];
  const x = Math.max(0, Math.min(1, intensity));
  const i = x <= 0.5 ? 0 : 1;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1];
  const k = (x - a) / (b - a);
  return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
}
