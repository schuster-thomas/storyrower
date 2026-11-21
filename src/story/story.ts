import type { Environment, Level } from '../game/levels/level';
import { phaseSpans, type PhaseId, type Segment, type Workout } from '../workout/workout';

/** One-shot effects the scene and the audio engine know how to play. */
export type EffectId = 'calm' | 'birds' | 'tremor' | 'calving' | 'ash' | 'eruption' | 'wave' | 'escape' | 'sunset'
  // Tokyo Super Row
  | 'blossom' | 'quake' | 'dragon'
  // Mauritius Shark Madness
  | 'visitors' | 'clouds' | 'fin' | 'thunderstorm' | 'shark';

/**
 * Where a beat sits on the training curve. Anchors are resolved against the generated
 * workout, so one level works for any duration and any minimum section length.
 */
export type Anchor =
  | { at: 'phase-start'; phase: PhaseId; offset?: number }
  | { at: 'phase-fraction'; phase: PhaseId; fraction: number }
  | { at: 'first-section'; kind: Segment['kind']; offset?: number }
  /** share of the whole workout, independent of the phases */
  | { at: 'fraction'; fraction: number };

export interface BeatDef {
  id: string;
  /** Short name, e.g. for the start-at list on the setup screen */
  name: string;
  anchor: Anchor;
  /** Short story line shown on screen */
  caption: string;
  effect: EffectId;
}

export interface ScheduledBeat extends BeatDef { t: number }

/** Resolve every beat of a level to a time in seconds; beats that can't be placed are dropped. */
export function scheduleBeats(level: Level, workout: Workout): ScheduledBeat[] {
  const spans = phaseSpans(workout);
  const span = (p: PhaseId) => spans.find((s) => s.phase === p);
  const out: ScheduledBeat[] = [];
  for (const b of level.beats) {
    let t: number | null = null;
    const a = b.anchor;
    if (a.at === 'phase-start') { const s = span(a.phase); if (s) t = s.start + (a.offset ?? 0); }
    else if (a.at === 'phase-fraction') { const s = span(a.phase); if (s) t = s.start + (s.end - s.start) * a.fraction; }
    else if (a.at === 'fraction') t = workout.duration * a.fraction;
    else {
      const seg = workout.segments.find((s) => s.kind === a.kind);
      if (seg) t = seg.start + (a.offset ?? 0);
    }
    if (t == null) continue;
    out.push({ ...b, t: Math.max(0, Math.min(workout.duration - 1, Math.round(t))) });
  }
  return out.sort((x, y) => x.t - y.t);
}

/** Things that are "on" for a stretch of the story, derived purely from the time. */
export interface StoryState {
  /** 0–1 how strongly lava bombs fall */
  lavaBombs: number;
  /** 0–1 falling ash */
  ashfall: number;
  /** 0–1 birds circling */
  birds: number;
  /** 0–1 the volcano wakes up: from the first tremor to the eruption */
  unrest: number;
  /** seconds since the eruption began (-1 before it) – the lava flows down with it */
  eruptionAge: number;
  /** 0–1 the eruption dies down after the escape: the lava cools, the plume thins */
  cooling: number;
  /** seconds until the glacier calves (-1 when it has happened or is not in this workout) */
  calvingIn: number;
  /** 0–1 the earth shakes and buildings shed parts: from the great quake to the escape, stronger in hard sections */
  quake: number;
  /** seconds since the great quake began (-1 before it) */
  quakeAge: number;
  /** 0–1 the dragon is there: from its arrival on, it leaves (fades) with the happy end */
  dragon: number;
  /** seconds since the dragon appeared (-1 before it) */
  dragonAge: number;
  /** 0–1 how hard the threat attacks (dragon lasers, shark lunges): heavier in hard sections and in the finale, 0 after the escape */
  attack: number;
  /** 0–1 people out on the water (snorkelers, surfers, a speedboat): until the clouds gather, back after the storm */
  visitors: number;
  /** 0–1 the storm: dark clouds and wind from the omens (0.4), rain and lightning in the thunderstorm (1), clearing after the escape */
  storm: number;
  /** 0–1 the shark is there (from its first fin far out); it dives away with the happy end */
  shark: number;
  /** seconds since the fin was first seen (-1 before it) */
  sharkAge: number;
  /** 0–1 how close the shark circles: far out at first, round the boat in the thunderstorm, right beside it in the attack */
  sharkNear: number;
}

/**
 * The happy end: after the escape everything calms down over the first half of the wind-down
 * (20 s – 2 min), so the last part of the workout is a clean, quiet fjord at sunset.
 */
export function settling(workout: Workout, t: number): number {
  const span = phaseSpans(workout).find((p) => p.phase === 'winddown');
  if (!span) return 0;
  const len = Math.max(20, Math.min(120, (span.end - span.start) * 0.5));
  return Math.max(0, Math.min(1, (t - span.start) / len));
}

export function storyStateAt(beats: ScheduledBeat[], workout: Workout, t: number): StoryState {
  const when = (id: string) => beats.find((b) => b.id === id)?.t ?? Infinity;
  const winddown = phaseSpans(workout).find((p) => p.phase === 'winddown')?.start ?? workout.duration;
  const cooling = settling(workout, t);
  const seg = workout.segments.find((s) => t < s.end) ?? workout.segments[workout.segments.length - 1];
  const ramp = (from: number, len: number) => Math.max(0, Math.min(1, (t - from) / len));
  const erupted = t >= when('eruption') && t < winddown;
  const shaking = t >= when('quake') && t < winddown;
  const dragonHere = t >= when('dragon');
  const clouds = when('clouds'), fin = when('fin'), storm = when('storm'), bite = when('shark');
  const sharkHere = t >= fin;
  const attacking = (dragonHere || t >= bite) && t < winddown;
  const effort = seg.kind === 'easy' ? 0.35 : seg.kind === 'peak' ? 1 : seg.kind === 'hard' ? 0.85 : 0.6;
  return {
    // bombs follow the effort: heavier in hard sections and in the finale
    lavaBombs: erupted ? (seg.kind === 'easy' ? 0.35 : seg.kind === 'peak' ? 1 : 0.75) : 0,
    // the ash settles while the volcano calms down
    ashfall: Math.min(ramp(when('ash'), 30), 1 - cooling) * (t >= when('ash') ? 1 : 0),
    // (Mauritius: the seabirds leave when the clouds gather and come back once the storm has passed)
    birds: t < when('tremor') ? (Number.isFinite(clouds) ? Math.max(1 - ramp(clouds, 20), t >= winddown ? cooling : 0) : 1) : 0,
    // builds from the tremor up to the eruption, and dies away again with the cooling
    unrest: Number.isFinite(when('tremor')) ? ramp(when('tremor'), Math.max(1, Math.min(when('eruption'), winddown) - when('tremor'))) * (1 - cooling) : 0,
    eruptionAge: t >= when('eruption') ? t - when('eruption') : -1,
    cooling,
    calvingIn: Number.isFinite(when('calving')) && t < when('calving') ? when('calving') - t : -1,
    // the aftershocks follow the effort; once the dragon is there they ease off a little
    quake: shaking ? effort * (dragonHere ? 0.5 : 1) : 0,
    quakeAge: t >= when('quake') ? t - when('quake') : -1,
    dragon: dragonHere ? (t < winddown ? 1 : 1 - cooling) : 0,
    dragonAge: dragonHere ? t - when('dragon') : -1,
    attack: attacking ? effort : 0,
    visitors: Number.isFinite(clouds) ? Math.max(1 - ramp(clouds, 20), t >= winddown ? cooling : 0) : 1,
    storm: Math.max(0.4 * ramp(clouds, 60), ramp(storm, 12)) * (t < winddown ? 1 : 1 - cooling),
    shark: sharkHere ? (t < winddown ? 1 : 1 - cooling) : 0,
    sharkAge: sharkHere ? t - fin : -1,
    // circles closer and closer: far out after the first fin, round the boat in the storm, beside it in the attack
    sharkNear: !sharkHere ? 0 : t >= bite ? 1
      : t >= storm ? 0.35 + 0.4 * ramp(storm, Math.max(1, Math.min(bite, winddown) - storm))
      : 0.04 + 0.26 * ramp(fin, Math.max(1, Math.min(storm, winddown) - fin)),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpHex(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}
export function lerpEnv(a: Environment, b: Environment, t: number): Environment {
  const out = { ...a };
  for (const k of ['fogNear', 'fogFar', 'sunIntensity', 'lava', 'smoke', 'wave', 'swell', 'sunHeight'] as const) out[k] = lerp(a[k], b[k], t);
  for (const k of ['sky', 'fog', 'sun', 'ground', 'water'] as const) out[k] = lerpHex(a[k], b[k], t);
  return out;
}

const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/**
 * The look of the world at time t. Instead of jumping between five fixed moods it drifts
 * towards the next phase during the last part of each phase, and breathes with the effort
 * inside the interval phase (hard = rougher water, more smoke; easy = a little calmer).
 */
export function environmentAt(level: Level, workout: Workout, t: number): Environment {
  const spans = phaseSpans(workout);
  const i = Math.max(0, spans.findIndex((s) => t < s.end));
  const cur = spans[i] ?? spans[spans.length - 1];
  const next = spans[i + 1];
  let env = level.phases[cur.phase].env;
  if (next) {
    const len = cur.end - cur.start;
    const blendLen = Math.min(45, len * 0.35);
    env = lerpEnv(env, level.phases[next.phase].env, smooth((t - (cur.end - blendLen)) / blendLen) * 0.6);
  }
  const seg = workout.segments.find((s) => t < s.end) ?? workout.segments[workout.segments.length - 1];
  if (cur.phase === 'escalation') {
    const k = seg.kind === 'hard' ? 1.15 : 0.85;
    env = { ...env, swell: Math.min(1, env.swell * k), smoke: Math.min(1, env.smoke * k), lava: Math.min(1, env.lava * k) };
  }
  // happy end: from the look right after the escape to the settled one
  const settled = level.phases[cur.phase].settled;
  if (cur.phase === 'winddown' && settled) env = lerpEnv(env, { ...env, ...settled }, smooth(settling(workout, t)));
  return env;
}
