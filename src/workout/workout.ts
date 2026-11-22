import { paceFromPower, powerFromPace } from '../rower/ftms';
import { DEFAULT_DURATION_MIN, DEFAULT_TRAININGS, type DefaultMode } from './defaultTrainings';

/**
 * How the targets move over the workout.
 * - steady, buildup, pyramid, waves: the default trainings (src/workout/defaultTrainings.ts) –
 *   sections as shares of the duration the user picks
 * - custom: the user's own sections (see CustomPlan), in any level
 * Every section is set against the peak: seconds over the peak split, strokes under the peak rate.
 */
export type WorkoutMode = DefaultMode | 'custom';
/** The modes a level can offer (custom trainings are offered by every level on top). */
export const MODES = Object.keys(DEFAULT_TRAININGS) as DefaultMode[];

/**
 * One section of a custom training, set against the maximum the user picks before rowing:
 * `slower` seconds per 500 m over the max split (+15 at a 2:35 max = 2:50), `fewer` strokes per
 * minute under the max stroke rate (0 = the max itself).
 */
export interface CustomSection { sec: number; slower: number; fewer: number }
/** A custom training as the workout needs it (the editor keeps a change time on top). */
export interface CustomPlan { id: string; name: string; sections: CustomSection[] }

export const CUSTOM_LIMITS = { sec: [10, 3600], slower: [0, 120], fewer: [0, 20], sections: 60 } as const;

/** User settings before a workout. */
export interface WorkoutSettings {
  mode: WorkoutMode;
  /** Default modes: the length of the workout. */
  durationMin: number;
  /**
   * The peak for every mode, custom trainings included: fastest split (as watts) and highest stroke
   * rate; every section is set against it.
   */
  maxPower: number;
  maxSpm: number;
  /** Custom mode: the training being rowed (a copy, so the history can row it again). */
  custom?: CustomPlan;
  /**
   * "Include story": the adventure with its threat (eruption, dragon, shark …). Off: only the
   * friendly scenery moments, in the level's calm look – the training stays the same.
   */
  story: boolean;
}

export const DEFAULT_SETTINGS: WorkoutSettings = {
  mode: 'buildup',
  durationMin: DEFAULT_DURATION_MIN,
  // Based on the first Woodrower recordings: hard ≈ 85–110 W / 27–30 spm
  maxPower: 110,
  maxSpm: 30,
  story: true,
};

/** Only the known fields, each with a usable value (stored settings may be from an older version). */
export function cleanSettings(input: object): WorkoutSettings {
  const raw = input as Partial<WorkoutSettings> & { customMaxPower?: number; customMaxSpm?: number };
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  const d = DEFAULT_SETTINGS;
  const mode = raw.mode === 'custom' || MODES.includes(raw.mode as DefaultMode) ? raw.mode as WorkoutMode : d.mode;
  // custom trainings once had a max of their own: a custom workout from then keeps the values it was rowed with
  const old = mode === 'custom';
  const s: WorkoutSettings = {
    mode,
    durationMin: num(raw.durationMin, d.durationMin),
    maxPower: num(old ? raw.customMaxPower ?? raw.maxPower : raw.maxPower, d.maxPower),
    maxSpm: num(old ? raw.customMaxSpm ?? raw.maxSpm : raw.maxSpm, d.maxSpm),
    story: raw.story !== false,
  };
  if (raw.custom) s.custom = raw.custom;
  return s;
}

/** The five story phases every level maps its beats onto. */
export type PhaseId = 'idyll' | 'omens' | 'escalation' | 'finale' | 'winddown';
export const PHASES: PhaseId[] = ['idyll', 'omens', 'escalation', 'finale', 'winddown'];

export interface Band { lo: number; hi: number }
/** A band around the value actually asked for: `target` is the goal, lo–hi the tolerance around it. */
export interface Target extends Band { target: number }

/**
 * Where the story phases sit on a workout: a share of the total time each, in story order
 * (idyll → omens → escalation → finale → winddown; phases may be left out). Levels set these per
 * mode (src/game/levels/level.ts); the default trainings bring their own.
 */
export interface PhaseShare { phase: PhaseId; share: number }

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
  /** The training section this belongs to (a section cut at a story phase gives two segments). */
  section: number;
  /** seconds per 500 m over the peak split, strokes under the peak stroke rate */
  slower: number;
  fewer: number;
}

export interface Workout {
  settings: WorkoutSettings;
  duration: number; // s
  segments: Segment[];
}

/** How far off the target still counts as on target: seconds on the 500 m split, strokes per minute. */
export const SPLIT_TOLERANCE = 5;
export const SPM_TOLERANCE = 2;

/** Target bands around an exact power (W) and a stroke rate. */
function bandsAt(watts: number, spmT: number): { power: Target; spm: Target; pace: Target } {
  const exact = Math.max(1, watts);
  // the band: ±5 s on the 500 m split, ±2 strokes; the watts follow from the split
  const split = paceFromPower(exact);
  const pace = { lo: split - SPLIT_TOLERANCE, hi: split + SPLIT_TOLERANCE, target: split };
  const power = { lo: Math.round(powerFromPace(pace.hi)), hi: Math.round(powerFromPace(pace.lo)), target: Math.round(exact) };
  const spm = { lo: spmT - SPM_TOLERANCE, hi: spmT + SPM_TOLERANCE, target: spmT };
  return { power, spm, pace };
}

/** Targets of one section for a peak split (given as watts) and a peak stroke rate. */
export function customBands(maxPower: number, maxSpm: number, sec: { slower: number; fewer: number }) {
  const split = paceFromPower(Math.max(1, maxPower)) + Math.max(0, sec.slower);
  return bandsAt(powerFromPace(split), Math.max(1, Math.round(maxSpm - Math.max(0, sec.fewer))));
}

/**
 * How hard each section of a training is (0–1, for colours and the game), judged within the
 * training: with at least three different splits the easiest is 0 (green) and the hardest 1 (red),
 * the rest in between; with fewer (e.g. steady) every section is 0.5 (amber) – being at the peak
 * the whole way is not "red" when nothing is easier.
 */
export function intensityScale(sections: { slower: number }[]): (sec: { slower: number }) => number {
  const levels = [...new Set(sections.map((s) => s.slower))];
  if (levels.length < 3) return () => 0.5;
  const easy = Math.max(...levels), hard = Math.min(...levels);
  return (sec) => Math.round(Math.max(0, Math.min(1, (easy - sec.slower) / (easy - hard))) * 100) / 100;
}

export const customDuration = (sections: CustomSection[]) => sections.reduce((a, s) => a + s.sec, 0);

/** Sections within the limits (whole seconds, whole strokes). */
export function cleanSections(list: CustomSection[]): CustomSection[] {
  const clamp = (v: number, [lo, hi]: readonly [number, number], d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  return list.slice(0, CUSTOM_LIMITS.sections).map((s) => ({
    sec: clamp(s.sec, CUSTOM_LIMITS.sec, 60), slower: clamp(s.slower, CUSTOM_LIMITS.slower, 20), fewer: clamp(s.fewer, CUSTOM_LIMITS.fewer, 2),
  }));
}

/**
 * A default training's sections in seconds for a workout of `total` seconds: whole 10 s steps,
 * the total exact.
 */
export function defaultSections(mode: DefaultMode, total: number): CustomSection[] {
  const list = DEFAULT_TRAININGS[mode].sections;
  const sum = list.reduce((a, s) => a + s.share, 0) || 1;
  let acc = 0;
  let prevEnd = 0;
  const out: CustomSection[] = [];
  list.forEach((s, i) => {
    acc += s.share;
    const end = i === list.length - 1 ? total : Math.round((acc / sum) * total / 10) * 10;
    if (end > prevEnd) out.push({ sec: end - prevEnd, slower: s.slower, fewer: s.fewer });
    prevEnd = Math.max(prevEnd, end);
  });
  return out;
}

/**
 * Builds the workout for the chosen mode. Default modes: the training's sections stretched to the
 * duration, against the peak split and stroke rate; `plan` (the level's) places the story phases.
 * Custom: the user's sections against the custom max, the phases following the training's peak.
 */
export function generateWorkout(settings: WorkoutSettings, plan?: PhaseShare[]): Workout {
  const s = cleanSettings({ ...DEFAULT_SETTINGS, ...settings });
  // a custom training without sections (or none at all) rows as a build-up
  if (s.mode === 'custom' && !s.custom?.sections.length) s.mode = 'buildup';
  let segs: Segment[];
  if (s.mode === 'custom') {
    const sections = cleanSections(s.custom!.sections);
    segs = sectionCurve(sections, (s.story ? customPhasePlan(sections) ?? plan ?? DEFAULT_TRAININGS.buildup.phases : plan ?? DEFAULT_TRAININGS.steady.phases), s.maxPower, s.maxSpm);
  } else {
    const total = Math.round(Math.max(10, Math.min(90, s.durationMin))) * 60;
    segs = sectionCurve(defaultSections(s.mode, total), plan ?? DEFAULT_TRAININGS[s.story ? s.mode : 'steady'].phases, s.maxPower, s.maxSpm);
  }
  return { settings: s, duration: segs[segs.length - 1].end, segments: segs };
}

/**
 * Where the story phases sit on a custom training: the hardest stretch (the last run of sections
 * at the fastest split) is the finale, the time before it is idyll → omens → escalation and the time
 * after it the wind-down. Null when the peak comes too early for a story to build up to it – then
 * the level's own build-up plan is used.
 */
export function customPhasePlan(sections: CustomSection[]): PhaseShare[] | null {
  const total = customDuration(sections);
  if (!sections.length || total <= 0) return null;
  const top = Math.min(...sections.map((s) => s.slower));
  let last = -1;
  sections.forEach((s, i) => { if (s.slower === top) last = i; });
  let first = last;
  while (first > 0 && sections[first - 1].slower === top) first--;
  const peakStart = customDuration(sections.slice(0, first));
  const peakEnd = customDuration(sections.slice(0, last + 1));
  if (peakStart < total * 0.25) return null;
  return [
    { phase: 'idyll', share: (peakStart * 0.35) / total },
    { phase: 'omens', share: (peakStart * 0.3) / total },
    { phase: 'escalation', share: (peakStart * 0.35) / total },
    { phase: 'finale', share: (peakEnd - peakStart) / total },
    { phase: 'winddown', share: (total - peakEnd) / total },
  ];
}

/**
 * One segment per section, with the targets from the peak split and stroke rate. Where a story
 * phase begins inside a section, the section is cut there (same targets on both sides, so no gate
 * and no "new target" – only the scenery moves on).
 */
function sectionCurve(sections: CustomSection[], phasePlan: PhaseShare[], maxPower: number, maxSpm: number): Segment[] {
  const total = customDuration(sections);
  const plan = phasePlan.filter((p) => p.share > 0);
  const sum = plan.reduce((a, p) => a + p.share, 0) || 1;
  let acc = 0;
  const bounds = plan.map((p) => ({ phase: p.phase, end: Math.round(((acc += p.share) / sum) * total) }));
  const phaseAt = (x: number): PhaseId => (bounds.find((b) => x < b.end) ?? bounds[bounds.length - 1])?.phase ?? 'idyll';
  // a cut closer than this to a section's edge moves to the edge
  const SNAP = 15;
  const segs: Segment[] = [];
  let t = 0;
  let prev: number | null = null;
  const scale = intensityScale(sections);
  sections.forEach((sec, index) => {
    const end = t + sec.sec;
    const intensity = scale(sec);
    // a big jump up is "hard" (an interval), reaching the top step by step the "peak"
    const kind: Segment['kind'] = prev == null || intensity === prev ? 'steady'
      : intensity > prev ? (intensity - prev >= 0.3 ? 'hard' : intensity >= 1 ? 'peak' : 'ramp') : 'easy';
    const cuts = [t, ...bounds.map((b) => b.end).filter((x) => x > t + SNAP && x < end - SNAP), end];
    const bands = customBands(maxPower, maxSpm, sec);
    for (let i = 0; i + 1 < cuts.length; i++) {
      segs.push({ phase: phaseAt((cuts[i] + cuts[i + 1]) / 2), start: cuts[i], end: cuts[i + 1], intensity, kind, section: index, slower: sec.slower, fewer: sec.fewer, ...bands });
    }
    t = end;
    prev = intensity;
  });
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
