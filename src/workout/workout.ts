import { paceFromPower } from '../rower/ftms';

/** User settings before a workout. */
export interface WorkoutSettings {
  minPower: number;   // W – easiest target (warm-up, cool-down)
  maxPower: number;   // W – hardest target (peak)
  minSpm: number;
  maxSpm: number;
  durationMin: number;
}

export const DEFAULT_SETTINGS: WorkoutSettings = {
  // Based on the first Woodrower recordings: easy ≈ 55 W / 23 spm, hard ≈ 85–100 W / 27–30 spm
  minPower: 55,
  maxPower: 110,
  minSpm: 22,
  maxSpm: 30,
  durationMin: 20,
};

/** The five story phases every level maps its beats onto. */
export type PhaseId = 'idyll' | 'omens' | 'escalation' | 'finale' | 'winddown';
export const PHASES: PhaseId[] = ['idyll', 'omens', 'escalation', 'finale', 'winddown'];

export interface Band { lo: number; hi: number }

export interface Segment {
  phase: PhaseId;
  /** seconds from workout start */
  start: number;
  end: number;
  /** 0 = easiest, 1 = hardest */
  intensity: number;
  power: Band;
  spm: Band;
  /** s/500 m; lo = faster split (from power.hi) */
  pace: Band;
  /** short label, e.g. "Hard" / "Easy" for intervals */
  kind: 'steady' | 'ramp' | 'hard' | 'easy' | 'peak';
}

export interface Workout {
  settings: WorkoutSettings;
  duration: number; // s
  segments: Segment[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Target bands for a given intensity (0–1). */
export function bandsFor(s: WorkoutSettings, intensity: number) {
  const p = lerp(s.minPower, s.maxPower, intensity);
  const halfP = Math.max(5, p * 0.08);
  const power = { lo: Math.round(p - halfP), hi: Math.round(p + halfP) };
  const spmT = lerp(s.minSpm, s.maxSpm, intensity);
  const spm = { lo: Math.round(spmT - 2), hi: Math.round(spmT + 2) };
  const pace = { lo: paceFromPower(power.hi), hi: paceFromPower(Math.max(1, power.lo)) };
  return { power, spm, pace };
}

/**
 * Builds the training curve: warm-up (idyll) → build-up (omens) → intervals (escalation)
 * → peak (finale) → cool-down (wind-down). Works for any duration from 10 to 90 minutes.
 */
export function generateWorkout(settings: WorkoutSettings): Workout {
  const s = { ...settings };
  if (s.maxPower < s.minPower) [s.minPower, s.maxPower] = [s.maxPower, s.minPower];
  if (s.maxSpm < s.minSpm) [s.minSpm, s.maxSpm] = [s.maxSpm, s.minSpm];
  const total = Math.max(10, Math.min(90, s.durationMin)) * 60;

  // Phase lengths, rounded to whole 10 s steps
  const r10 = (x: number) => Math.round(x / 10) * 10;
  const idyll = r10(total * 0.2);
  const omens = r10(total * 0.15);
  const finale = r10(total * 0.1);
  const winddown = r10(total * 0.15);
  let escalation = total - idyll - omens - finale - winddown;

  // Intervals: 1 min hard / 1 min easy for longer workouts, 30 s / 30 s for short ones
  const pair = escalation >= 8 * 60 ? 120 : 60;
  const pairs = Math.max(1, Math.floor(escalation / pair));
  const leftover = escalation - pairs * pair;
  escalation = pairs * pair;

  const segs: Segment[] = [];
  let t = 0;
  const add = (phase: PhaseId, len: number, intensity: number, kind: Segment['kind']) => {
    if (len <= 0) return;
    segs.push({ phase, start: t, end: t + len, intensity, kind, ...bandsFor(s, intensity) });
    t += len;
  };

  add('idyll', idyll, 0.1, 'steady');
  // build-up in two steps; leftover interval time goes here so the total stays exact
  const omensTotal = omens + leftover;
  add('omens', r10(omensTotal / 2), 0.3, 'ramp');
  add('omens', omensTotal - r10(omensTotal / 2), 0.5, 'ramp');
  for (let i = 0; i < pairs; i++) {
    add('escalation', pair / 2, 0.85, 'hard');
    add('escalation', pair / 2, 0.35, 'easy');
  }
  add('finale', finale, 1, 'peak');
  add('winddown', r10(winddown / 2), 0.15, 'steady');
  add('winddown', winddown - r10(winddown / 2), 0, 'steady');

  return { settings: s, duration: t, segments: segs };
}

export function segmentAt(w: Workout, t: number): Segment {
  return w.segments.find((s) => t < s.end) ?? w.segments[w.segments.length - 1];
}

export function nextSegment(w: Workout, t: number): Segment | null {
  const i = w.segments.findIndex((s) => t < s.end);
  return i >= 0 && i + 1 < w.segments.length ? w.segments[i + 1] : null;
}

/** Start and end time of each story phase. */
export function phaseSpans(w: Workout): { phase: PhaseId; start: number; end: number }[] {
  return PHASES.map((phase) => {
    const segs = w.segments.filter((s) => s.phase === phase);
    return { phase, start: segs[0]?.start ?? 0, end: segs[segs.length - 1]?.end ?? 0 };
  }).filter((p) => p.end > p.start);
}
