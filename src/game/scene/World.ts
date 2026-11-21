import type * as THREE from 'three';
import type { EffectId, StoryState } from '../../story/story';
import type { Environment } from '../levels/level';
import type { Effects } from './Effects';
import type { QualityLevel, QualityProfile } from './quality';
import type { Sky } from './Sky';
import type { Water } from './Water';

/**
 * The level-specific part of the river scene: banks, backdrop, set piece, fauna and threat.
 * RiverScene owns everything every level shares (renderer, camera, lights, sky, water, boat and
 * rower, gates, splashes, post-processing) and hands each frame to the level's world.
 */
export interface LevelWorld {
  /** Resolves once the world's assets are in place (the game is shown only then). */
  readonly ready: Promise<void>;
  /** Once per frame, after the camera, sky and water have been updated. */
  update(f: WorldFrame): void;
  /** A one-shot story effect (the scene has already shaken the camera / flashed where it applies). */
  play(effect: EffectId, boatZ: number): void;
  /** The blended look changed (called every frame, also before the first update). */
  applyEnvironment(env: Environment): void;
  setQuality(level: QualityLevel, profile: QualityProfile): void;
  dispose(): void;
}

/** What the shared scene lends a world. */
export interface WorldHost {
  scene: THREE.Scene;
  sky: Sky;
  water: Water;
  effects: Effects;
  /** sun shadows are on (not on "low") */
  shadows: boolean;
  quality: QualityProfile;
  /** extra camera shake, 0–2 (keeps the stronger of the current and the new one) */
  shake(amount: number): void;
  /** rock the boat hard for a few seconds (e.g. a swell from a calving glacier) */
  rock(amount: number): void;
  /** 0–0.8: darken sun and sky light (e.g. under storm clouds); 0 = the phase's own light */
  dim(amount: number): void;
  flash(color: number, strength: number): void;
  /** a world sound at this distance from the boat (the game forwards it to the audio engine) */
  sound(id: WorldSound, distance: number): void;
}

/** Sounds a world asks for (see AudioEngine.worldSound). */
export type WorldSound = 'debris' | 'laser' | 'laser-hit'
  // Mauritius: thunder after a lightning bolt, the shark's jaws and splashes, a speedboat passing
  | 'thunder' | 'bite' | 'splash' | 'speedboat';

export interface WorldFrame {
  dt: number;
  time: number;
  boatZ: number;
  /** boat speed in world units/s */
  speed: number;
  env: Environment;
  story: StoryState;
  /** 0 = the threat is on top of you, 1 = far away */
  threat: number;
  /** 0–1 overall light level */
  light: number;
  /** colour of the haze at the horizon */
  horizon: THREE.Color;
  sunDir: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  /** drawing-buffer height in pixels */
  pixelHeight: number;
  /** +1 = camera looks ahead, −1 = it looks back at the boat */
  viewDir: number;
}

export interface WorldClass {
  new (host: WorldHost, quality: QualityLevel): LevelWorld;
  /** Start loading the world's assets early (setup screen). */
  preload(): Promise<unknown>;
}

/** The level worlds, loaded only when a level is chosen (each is its own chunk). */
export type WorldId = 'iceland' | 'tokyo' | 'mauritius';
export const WORLDS: Record<WorldId, () => Promise<WorldClass>> = {
  iceland: () => import('./IcelandWorld').then((m) => m.IcelandWorld),
  tokyo: () => import('./tokyo/TokyoWorld').then((m) => m.TokyoWorld),
  mauritius: () => import('./mauritius/MauritiusWorld').then((m) => m.MauritiusWorld),
};
