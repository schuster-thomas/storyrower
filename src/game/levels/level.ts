import type { Anchor, BeatDef } from '../../story/story';
import { generateWorkout, MODES, type PhaseId, type PhaseShare, type Workout, type WorkoutMode, type WorkoutSettings } from '../../workout/workout';

/** Look of the world for one story phase. */
export interface Environment {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  ground: number;
  water: number;
  /** 0–1: lava glow on the volcano */
  lava: number;
  /** 0–1: ash/smoke amount */
  smoke: number;
  /** 0–1: how far the tidal wave is shown behind the boat */
  wave: number;
  /** 0–1: water roughness */
  swell: number;
  /** sun elevation (direction y component, ~0.1 = sunset, 0.5 = high) */
  sunHeight: number;
}

export interface LevelPhase {
  id: PhaseId;
  name: string;
  env: Environment;
  /**
   * Wind-down only: the look once the story has settled (volcano asleep, air clear). `env` is the
   * look right after the escape; the world drifts to this over the first part of the phase.
   */
  settled?: Partial<Environment>;
}

/** A beat used in one mode: as the level defines it, or moved / reworded for that mode. */
export type ModeBeat = true | { anchor?: Anchor; caption?: string };

/**
 * What a level does in one workout mode – the one place that decides which story elements
 * a mode gets.
 */
export interface LevelMode {
  /** One line on the setup screen, e.g. what happens in the story in this mode. */
  summary: string;
  /**
   * Where the story phases (scenery, music, phase names) sit along a shaped workout, as shares of
   * the total time in story order. Not used in story mode – there the training curve sets them.
   */
  phases?: PhaseShare[];
  /** Story beats in this mode: 'all', or by id (beats not listed don't happen). */
  beats: 'all' | Record<string, ModeBeat>;
  /** Per-phase look changes for this mode, e.g. no smoke at sunset when the volcano never erupted. */
  env?: Partial<Record<PhaseId, Partial<Environment>>>;
}

export interface Level {
  id: string;
  title: string;
  /** One line for the start page tile. */
  tagline: string;
  phases: Record<PhaseId, LevelPhase>;
  /** Every story beat the level has; modes pick from these. */
  beats: BeatDef[];
  /** The workout modes this level offers (missing modes aren't shown). */
  modes: Partial<Record<WorkoutMode, LevelMode>>;
}

/** Modes a level offers, in the standard order. */
export function levelModes(level: Level): WorkoutMode[] {
  return MODES.filter((m) => level.modes[m]);
}

/**
 * The mode to use: the wanted one if the level has it, else build-up (the full adventure – also
 * what a saved "story" setting from before becomes), else the level's first.
 */
export function pickMode(level: Level, mode: WorkoutMode): WorkoutMode {
  if (level.modes[mode]) return mode;
  return level.modes.buildup ? 'buildup' : levelModes(level)[0] ?? 'story';
}

/**
 * The level as it plays in one mode: only that mode's beats (with their overrides) and
 * the mode's look changes. The game and the story engine just see a normal level.
 */
export function levelForMode(level: Level, mode: WorkoutMode): Level {
  const m = level.modes[pickMode(level, mode)];
  if (!m) return level;
  const beats = m.beats === 'all' ? level.beats : level.beats.flatMap((b) => {
    const use = (m.beats as Record<string, ModeBeat>)[b.id];
    if (!use) return [];
    return use === true ? [b] : [{ ...b, anchor: use.anchor ?? b.anchor, caption: use.caption ?? b.caption }];
  });
  const phases = { ...level.phases };
  for (const [id, env] of Object.entries(m.env ?? {}) as [PhaseId, Partial<Environment>][]) {
    phases[id] = { ...phases[id], env: { ...phases[id].env, ...env } };
  }
  return { ...level, phases, beats };
}

/** The workout for these settings in this level (the mode's phase plan included). */
export function levelWorkout(level: Level, settings: WorkoutSettings): Workout {
  const mode = pickMode(level, settings.mode);
  return generateWorkout({ ...settings, mode }, level.modes[mode]?.phases);
}
