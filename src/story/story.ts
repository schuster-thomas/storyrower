import type { Environment, Level } from '../game/levels/iceland';
import { phaseSpans, type PhaseId, type Segment, type Workout } from '../workout/workout';

/** One-shot effects the scene and the audio engine know how to play. */
export type EffectId = 'calm' | 'birds' | 'tremor' | 'calving' | 'ash' | 'eruption' | 'wave' | 'escape' | 'sunset';

/**
 * Where a beat sits on the training curve. Anchors are resolved against the generated
 * workout, so one level works for any duration and any minimum section length.
 */
export type Anchor =
  | { at: 'phase-start'; phase: PhaseId; offset?: number }
  | { at: 'phase-fraction'; phase: PhaseId; fraction: number }
  | { at: 'first-section'; kind: Segment['kind']; offset?: number };

export interface BeatDef {
  id: string;
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
}

export function storyStateAt(beats: ScheduledBeat[], workout: Workout, t: number): StoryState {
  const when = (id: string) => beats.find((b) => b.id === id)?.t ?? Infinity;
  const winddown = phaseSpans(workout).find((p) => p.phase === 'winddown')?.start ?? workout.duration;
  const seg = workout.segments.find((s) => t < s.end) ?? workout.segments[workout.segments.length - 1];
  const ramp = (from: number, len: number) => Math.max(0, Math.min(1, (t - from) / len));
  const fade = (to: number, len: number) => Math.max(0, Math.min(1, (to - t) / len));
  const erupted = t >= when('eruption') && t < winddown;
  return {
    // bombs follow the effort: heavier in hard sections and in the finale
    lavaBombs: erupted ? (seg.kind === 'easy' ? 0.35 : seg.kind === 'peak' ? 1 : 0.75) : 0,
    ashfall: Math.min(ramp(when('ash'), 30), fade(winddown + 60, 60)) * (t >= when('ash') ? 1 : 0),
    birds: t < when('tremor') ? 1 : 0,
    unrest: Number.isFinite(when('tremor')) ? ramp(when('tremor'), Math.max(1, Math.min(when('eruption'), winddown) - when('tremor'))) : 0,
    eruptionAge: t >= when('eruption') ? t - when('eruption') : -1,
    cooling: ramp(winddown, 120),
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
  return env;
}
