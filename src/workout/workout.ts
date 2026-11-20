import { paceFromPower, powerFromPace } from '../rower/ftms';

/**
 * How the targets move over the workout.
 * - story:   the full adventure curve (warm-up, build-up, intervals, peak, cool-down)
 * - steady:  the same targets from start to finish
 * - buildup: targets get harder step by step up to the peak, then an easy cool-down
 * - pyramid: easy → hardest in the middle → easy
 * - waves:   up and down, several times
 */
export type WorkoutMode = 'story' | 'steady' | 'buildup' | 'pyramid' | 'waves';
export const MODES: WorkoutMode[] = ['story', 'steady', 'buildup', 'pyramid', 'waves'];
export type ShapedMode = Exclude<WorkoutMode, 'story'>;

/** User settings before a workout. */
export interface WorkoutSettings {
  mode: WorkoutMode;
  minPower: number;   // W – easiest target (warm-up, cool-down)
  maxPower: number;   // W – hardest target (peak)
  minSpm: number;
  maxSpm: number;
  durationMin: number;
  /** Shortest allowed section in seconds – fewer target changes with higher values. */
  minSegmentSec: number;
  /** Steady mode: one power and one stroke-rate target instead of a range. */
  steadyPower: number;
  steadySpm: number;
}

export const DEFAULT_SETTINGS: WorkoutSettings = {
  mode: 'story',
  // Based on the first Woodrower recordings: easy ≈ 55 W / 23 spm, hard ≈ 85–100 W / 27–30 spm
  minPower: 55,
  maxPower: 110,
  minSpm: 22,
  maxSpm: 30,
  durationMin: 20,
  // two minutes: targets do not change too often
  minSegmentSec: 120,
  steadyPower: 80,
  steadySpm: 26,
};

/** The five story phases every level maps its beats onto. */
export type PhaseId = 'idyll' | 'omens' | 'escalation' | 'finale' | 'winddown';
export const PHASES: PhaseId[] = ['idyll', 'omens', 'escalation', 'finale', 'winddown'];

export interface Band { lo: number; hi: number }
/** A band around the value actually asked for: `target` is the goal, lo–hi the tolerance around it. */
export interface Target extends Band { target: number }

/**
 * Where the story phases sit on a shaped (non-story) workout: a share of the total time each,
 * in story order (idyll → omens → escalation → finale → winddown; phases may be left out).
 * Levels set these per mode (src/game/levels/level.ts).
 */
export interface PhaseShare { phase: PhaseId; share: number }

/** Used when a level gives no plan for a mode. */
export const DEFAULT_PHASE_PLANS: Record<ShapedMode, PhaseShare[]> = {
  steady: [{ phase: 'idyll', share: 0.85 }, { phase: 'winddown', share: 0.15 }],
  buildup: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.22 }, { phase: 'escalation', share: 0.28 }, { phase: 'finale', share: 0.15 }, { phase: 'winddown', share: 0.15 }],
  pyramid: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.08 }, { phase: 'finale', share: 0.12 }, { phase: 'winddown', share: 0.4 }],
  waves: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.45 }, { phase: 'winddown', share: 0.15 }],
};

export interface Segment {
  phase: PhaseId;
  /** seconds from workout start */
  start: number;
  end: number;
  /** 0 = easiest, 1 = hardest */
  intensity: number;
  power: Target;
  spm: Target;
  /** s/500 m; lo = faster split (from power.hi), target = the split of the target power */
  pace: Target;
  /** short label, e.g. "Hard" / "Easy" for intervals */
  kind: 'steady' | 'ramp' | 'hard' | 'easy' | 'peak';
}

export interface Workout {
  settings: WorkoutSettings;
  duration: number; // s
  segments: Segment[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r10 = (x: number) => Math.round(x / 10) * 10;
/** How far off the target still counts as on target: seconds on the 500 m split, strokes per minute. */
export const SPLIT_TOLERANCE = 5;
export const SPM_TOLERANCE = 2;
/** Intensity of the easy row-out at the end of a build-up. */
const COOL_DOWN = 0.1;

/**
 * Targets for a given intensity (0–1). The configured minimum is the target at intensity 0 (the
 * start), the maximum the target at 1 (the peak); the tolerance band lies around the target, so it
 * may reach below the minimum and above the maximum.
 */
export function bandsFor(s: WorkoutSettings, intensity: number): { power: Target; spm: Target; pace: Target } {
  // the settings may hold fractional watts (they are entered as splits): the split target comes
  // from the exact value, so a 2:50 start shows as 2:50 and not 2:49
  const exact = Math.max(1, lerp(s.minPower, s.maxPower, intensity));
  // the band: ±5 s on the 500 m split, ±2 strokes; the watts follow from the split
  const split = paceFromPower(exact);
  const pace = { lo: split - SPLIT_TOLERANCE, hi: split + SPLIT_TOLERANCE, target: split };
  const power = { lo: Math.round(powerFromPace(pace.hi)), hi: Math.round(powerFromPace(pace.lo)), target: Math.round(exact) };
  const spmT = Math.round(lerp(s.minSpm, s.maxSpm, intensity));
  const spm = { lo: spmT - SPM_TOLERANCE, hi: spmT + SPM_TOLERANCE, target: spmT };
  return { power, spm, pace };
}

/**
 * Builds the workout for the chosen mode, always between the easiest and hardest targets
 * the user entered. `plan` places the story phases on shaped modes (the level's choice).
 * Works for any duration from 10 to 90 minutes.
 */
export function generateWorkout(settings: WorkoutSettings, plan?: PhaseShare[]): Workout {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (!MODES.includes(s.mode)) s.mode = 'story';
  if (s.maxPower < s.minPower) [s.minPower, s.maxPower] = [s.maxPower, s.minPower];
  if (s.maxSpm < s.minSpm) [s.minSpm, s.maxSpm] = [s.maxSpm, s.minSpm];
  const total = Math.max(10, Math.min(90, s.durationMin)) * 60;
  // Shortest section, in whole 10 s steps
  const minSeg = Math.max(10, Math.min(600, Math.ceil((s.minSegmentSec || 30) / 10) * 10));
  s.minSegmentSec = minSeg;
  const segs = s.mode === 'story' ? storyCurve(s, total, minSeg) : shapedCurve(s, s.mode, total, minSeg, plan ?? DEFAULT_PHASE_PLANS[s.mode]);
  return { settings: s, duration: segs[segs.length - 1].end, segments: segs };
}

/**
 * Story mode: warm-up (idyll) → build-up (omens) → intervals (escalation)
 * → peak (finale) → cool-down (wind-down).
 */
function storyCurve(s: WorkoutSettings, total: number, minSeg: number): Segment[] {
  // Phase lengths, rounded to whole 10 s steps
  const idyll = r10(total * 0.2);
  const omens = r10(total * 0.15);
  const finale = r10(total * 0.1);
  const winddown = r10(total * 0.15);
  let escalation = total - idyll - omens - finale - winddown;

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

  // the warm-up asks for exactly the configured minimum
  add('idyll', idyll, 0, 'steady');
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
  return segs;
}

/** Intensity (0–1) of a shaped mode at u = 0…1 along the workout. */
function shape(mode: ShapedMode, u: number, waves: number): number {
  switch (mode) {
    case 'steady': return 0.5;
    case 'buildup': return u;
    case 'pyramid': return 1 - Math.abs(2 * u - 1);
    case 'waves': return 0.5 - 0.5 * Math.cos(2 * Math.PI * waves * u);
  }
}

/**
 * Steady, build-up, pyramid and waves: the workout is cut into equal steps (never shorter than
 * the shortest section) and each step takes its targets from the mode's shape. The story phases
 * are laid over the time by the level's plan, so scenery and story beats still follow along.
 */
function shapedCurve(settings: WorkoutSettings, mode: ShapedMode, total: number, minSeg: number, plan: PhaseShare[]): Segment[] {
  // steady has a single target, not a range
  const s = mode === 'steady'
    ? { ...settings, minPower: settings.steadyPower, maxPower: settings.steadyPower, minSpm: settings.steadySpm, maxSpm: settings.steadySpm }
    : settings;
  // about 20 steps, 30 s to 3 min each
  const stepLen = Math.max(minSeg, Math.min(180, Math.max(30, r10(total / 20))));
  let n = Math.max(1, Math.floor(total / stepLen));
  let waves = 1;
  if (mode === 'pyramid' && n > 2 && n % 2 === 0) n -= 1; // odd, so one step sits exactly on the top
  if (mode === 'waves' && n >= 3) {
    // a wave every ~6 min, with at least three steps up and three down where there's room;
    // n - 1 a multiple of 2·waves so every crest and trough lands on a step
    waves = Math.max(1, Math.min(Math.round(total / 360), Math.floor((n - 1) / 6)));
    n = 2 * waves * Math.max(1, Math.floor((n - 1) / (2 * waves))) + 1;
  }

  // build-up: the last ~15 % of the steps are an easy cool-down after the peak
  const coolSteps = mode === 'buildup' && n >= 3 ? Math.max(1, Math.round(n * 0.15)) : 0;
  const climb = n - coolSteps;

  // step lengths in 10 s units, the remainder spread evenly so the total stays exact
  const units = total / 10;
  const base = Math.floor(units / n);
  const extra = units - base * n;
  const lens = Array.from({ length: n }, (_, i) => (base + Math.floor(((i + 1) * extra) / n) - Math.floor((i * extra) / n)) * 10);

  // phase plan → cumulative boundaries (shares normalised)
  const used = plan.filter((p) => p.share > 0);
  const sum = used.reduce((a, p) => a + p.share, 0) || 1;
  let acc = 0;
  const bounds = used.map((p) => ({ phase: p.phase, end: (acc += p.share / sum) }));
  const phaseAt = (x: number): PhaseId => (bounds.find((b) => x < b.end) ?? bounds[bounds.length - 1])?.phase ?? 'idyll';

  const segs: Segment[] = [];
  let t = 0;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const len = lens[i];
    const u = mode === 'buildup' ? (climb <= 1 ? 1 : i / (climb - 1)) : n === 1 ? 0.5 : i / (n - 1);
    const intensity = i >= climb ? COOL_DOWN : Math.round(shape(mode, u, waves) * 100) / 100;
    const phase = phaseAt((t + len / 2) / total);
    const kind: Segment['kind'] = mode === 'steady' || i === 0 ? 'steady'
      : intensity >= 0.995 ? (mode === 'waves' ? 'hard' : 'peak')
      : intensity > prev ? 'ramp' : intensity < prev ? 'easy' : 'steady';
    const last = segs[segs.length - 1];
    // same targets in the same phase: one longer section rather than a "new target" with the same numbers
    if (last && last.phase === phase && last.intensity === intensity) last.end += len;
    else segs.push({ phase, start: t, end: t + len, intensity, kind, ...bandsFor(s, intensity) });
    t += len;
    prev = intensity;
  }
  return segs;
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
