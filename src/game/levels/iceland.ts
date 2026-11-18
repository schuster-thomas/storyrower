import type { BeatDef } from '../../story/story';
import type { PhaseId } from '../../workout/workout';

/** Look of the world for one story phase (greybox palette, refined in milestone 4). */
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

export interface LevelPhase { id: PhaseId; name: string; env: Environment }

export interface Level { id: string; title: string; phases: Record<PhaseId, LevelPhase>; beats: BeatDef[] }

export const ICELAND: Level = {
  id: 'iceland-volcano-run',
  title: 'Iceland Volcano Run',
  phases: {
    idyll: {
      id: 'idyll', name: 'Fjord Morning',
      env: { sky: 0x9fd4ef, fog: 0xbfe2f2, fogNear: 160, fogFar: 900, sun: 0xfff3d6, sunIntensity: 2.2, ground: 0x5f9e4f, water: 0x1f8fb0, lava: 0, smoke: 0, wave: 0, swell: 0.1, sunHeight: 0.42 },
    },
    omens: {
      id: 'omens', name: 'Rumbling Earth',
      env: { sky: 0xb7c1c4, fog: 0xc4c4bb, fogNear: 120, fogFar: 700, sun: 0xffe2b0, sunIntensity: 1.7, ground: 0x6b8a4c, water: 0x2f7298, lava: 0.25, smoke: 0.35, wave: 0, swell: 0.3, sunHeight: 0.36 },
    },
    escalation: {
      id: 'escalation', name: 'Eruption',
      env: { sky: 0xd98a5f, fog: 0xb8775a, fogNear: 90, fogFar: 520, sun: 0xffb27a, sunIntensity: 1.6, ground: 0x5d6b45, water: 0x2b5f7e, lava: 0.8, smoke: 0.75, wave: 0.6, swell: 0.65, sunHeight: 0.28 },
    },
    finale: {
      id: 'finale', name: 'Wave Chase',
      env: { sky: 0x8e4a3a, fog: 0x7a4638, fogNear: 70, fogFar: 400, sun: 0xff8a5c, sunIntensity: 1.4, ground: 0x4c5040, water: 0x24506a, lava: 1, smoke: 1, wave: 1, swell: 1, sunHeight: 0.22 },
    },
    winddown: {
      id: 'winddown', name: 'Safe Waters',
      env: { sky: 0xf3b27f, fog: 0xf6c9a0, fogNear: 160, fogFar: 900, sun: 0xffc48a, sunIntensity: 1.9, ground: 0x6c8f52, water: 0x3a7fa8, lava: 0.15, smoke: 0.25, wave: 0, swell: 0.15, sunHeight: 0.1 },
    },
  },
  // The story, laid onto any training curve by the story engine (src/story/story.ts)
  beats: [
    { id: 'calm', anchor: { at: 'phase-start', phase: 'idyll', offset: 3 }, effect: 'calm', caption: 'A calm morning on the fjord. Find your rhythm.' },
    { id: 'birds', anchor: { at: 'phase-fraction', phase: 'idyll', fraction: 0.5 }, effect: 'birds', caption: 'Puffins circle above the waterfalls.' },
    { id: 'tremor', anchor: { at: 'phase-start', phase: 'omens', offset: 0 }, effect: 'tremor', caption: 'The ground trembles…' },
    { id: 'ash', anchor: { at: 'phase-fraction', phase: 'omens', fraction: 0.5 }, effect: 'ash', caption: 'Ash drifts down from the volcano.' },
    { id: 'eruption', anchor: { at: 'first-section', kind: 'hard', offset: 0 }, effect: 'eruption', caption: 'ERUPTION! Row for your life!' },
    { id: 'wave', anchor: { at: 'phase-start', phase: 'finale', offset: 0 }, effect: 'wave', caption: 'A tidal wave! Give it everything!' },
    { id: 'escape', anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, effect: 'escape', caption: 'You outran the wave. Safe waters ahead.' },
    { id: 'sunset', anchor: { at: 'phase-fraction', phase: 'winddown', fraction: 0.5 }, effect: 'sunset', caption: 'Ease off and let the boat glide into the sunset.' },
  ],
};
