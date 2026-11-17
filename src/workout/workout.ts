import { paceFromPower } from '../rower/ftms';

/** User settings before a workout. */
export interface WorkoutSettings {
  minPower: number;   // W – easiest target (warm-up, cool-down)
  maxPower: number;   // W – hardest target (peak)
  minSpm: number;
  maxSpm: number;
  durationMin: number;
  /** Shortest allowed section in seconds – fewer target changes with higher values. */
  minSegmentSec: number;
}

export const DEFAULT_SETTINGS: WorkoutSettings = {
  // Based on the first Woodrower recordings: easy ≈ 55 W / 23 spm, hard ≈ 85–100 W / 27–30 spm
  minPower: 55,
  maxPower: 110,
  minSpm: 22,
  maxSpm: 30,
  durationMin: 20,
  minSegmentSec: 30,
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

  // Shortest section, in whole 10 s steps
  const minSeg = Math.max(10, Math.min(600, Math.ceil((s.minSegmentSec || 30) / 10) * 10));
  s.minSegmentSec = minSeg;

  // Intervals: 1 min hard / 1 min easy for longer workouts, 30 s / 30 s for short ones,
  // but never shorter than the minimum section length
  const half = Math.max(escalation >= 8 * 60 ? 60 : 30, minSeg);
  const pair = half * 2;
  const pairs = Math.floor(escalation / pair);
  const leftover = pairs > 0 ? escalation - pairs * pair : 0;
  escalation = pairs > 0 ? pairs * pair : escalation;

  const segs: Segment[] = [];
  let t = 0;
  const add = (phase: PhaseId, len: number, intensity: number, kind: Segment['kind']) => {
    if (len <= 0) return;
    segs.push({ phase, start: t, end: t + len, intensity, kind, ...bandsFor(s, intensity) });
    t += len;
  };

  add('idyll', idyll, 0.1, 'steady');
  // build-up in two steps (one if too short); leftover interval time goes here so the total stays exact
  const omensTotal = omens + leftover;
  const twoSteps = (len: number) => r10(len / 2) >= minSeg && len - r10(len / 2) >= minSeg;
  if (twoSteps(omensTotal)) {
    add('omens', r10(omensTotal / 2), 0.3, 'ramp');
    add('omens', omensTotal - r10(omensTotal / 2), 0.5, 'ramp');
  } else add('omens', omensTotal, 0.4, 'ramp');
  if (pairs === 0) add('escalation', escalation, 0.7, 'hard');
  for (let i = 0; i < pairs; i++) {
    add('escalation', half, 0.85, 'hard');
    add('escalation', half, 0.35, 'easy');
  }
  add('finale', finale, 1, 'peak');
  if (twoSteps(winddown)) {
    add('winddown', r10(winddown / 2), 0.15, 'steady');
    add('winddown', winddown - r10(winddown / 2), 0, 'steady');
  } else add('winddown', winddown, 0, 'steady');

  // Whole phases can still be shorter than the minimum (short workout, long minimum):
  // merge them into the previous section so no section is shorter than asked for.
  for (let i = segs.length - 1; i > 0; i--) {
    if (segs[i].end - segs[i].start < minSeg) { segs[i - 1].end = segs[i].end; segs.splice(i, 1); }
  }
  if (segs.length > 1 && segs[0].end - segs[0].start < minSeg) { segs[1].start = 0; segs.shift(); }

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
