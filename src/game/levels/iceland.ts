import type { Level } from './level';

export type { Environment, Level, LevelPhase } from './level';

export const ICELAND: Level = {
  id: 'iceland-volcano-run',
  title: 'Iceland Volcano Run',
  tagline: 'Row through quiet fjords, past glaciers and a rumbling volcano.',
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
      // happy end: the volcano falls asleep, the ash settles, the air clears and the fjord goes still
      settled: { lava: 0, smoke: 0, wave: 0, swell: 0.06, sky: 0xf5bd88, fog: 0xf8d3ae, fogNear: 200, fogFar: 1000, sunIntensity: 2.1 },
    },
  },
  // Every story moment of the level, laid onto the training curve by the story engine (src/story/story.ts).
  // Which of them happen in which mode is decided in `modes` below.
  beats: [
    { id: 'calm', name: 'Calm morning', anchor: { at: 'phase-start', phase: 'idyll', offset: 3 }, effect: 'calm', caption: 'A calm morning on the fjord. Find your rhythm.' },
    { id: 'birds', name: 'Puffins', anchor: { at: 'phase-fraction', phase: 'idyll', fraction: 0.5 }, effect: 'birds', caption: 'Puffins circle above the waterfalls.' },
    { id: 'tremor', name: 'First tremor', anchor: { at: 'phase-start', phase: 'omens', offset: 0 }, effect: 'tremor', caption: 'The ground trembles…' },
    { id: 'calving', name: 'Calving glacier', anchor: { at: 'phase-fraction', phase: 'omens', fraction: 0.25 }, effect: 'calving', caption: 'The tremor breaks the glacier – ice crashes into the river!' },
    { id: 'ash', name: 'Ash rain', anchor: { at: 'phase-fraction', phase: 'omens', fraction: 0.5 }, effect: 'ash', caption: 'Ash drifts down from the volcano.' },
    { id: 'eruption', name: 'Eruption', anchor: { at: 'first-section', kind: 'hard', offset: 0 }, effect: 'eruption', caption: 'ERUPTION! Row for your life!' },
    { id: 'wave', name: 'Tidal wave', anchor: { at: 'phase-start', phase: 'finale', offset: 0 }, effect: 'wave', caption: 'A tidal wave! Give it everything!' },
    { id: 'escape', name: 'Escape', anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, effect: 'escape', caption: 'You outran the wave. Safe waters ahead.' },
    { id: 'sunset', name: 'Sunset', anchor: { at: 'phase-fraction', phase: 'winddown', fraction: 0.5 }, effect: 'sunset', caption: 'The volcano sleeps again, the air is clear. Glide into the sunset.' },
  ],
  /**
   * Which story elements each workout mode gets. `phases` places the scenery along the time
   * (shares of the workout); `beats` lists the moments that happen, optionally moved or reworded.
   */
  modes: {
    story: {
      summary: 'Follow the adventure as your workout unfolds.',
      beats: 'all',
    },
    steady: {
      summary: 'A quiet row past puffins and the glacier – the volcano sleeps.',
      phases: [{ phase: 'idyll', share: 0.85 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true,
        birds: { anchor: { at: 'phase-fraction', phase: 'idyll', fraction: 0.15 } },
        calving: { anchor: { at: 'fraction', fraction: 0.5 }, caption: 'With a crack the glacier calves – ice crashes into the fjord!' },
        sunset: { anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, caption: 'The sun sinks low over the fjord. Keep your rhythm.' },
      },
      // no eruption in this mode, so no smoke or lava glow at sunset either
      env: { winddown: { lava: 0, smoke: 0 } },
    },
    buildup: {
      summary: 'The volcano wakes slowly – outrun the tidal wave at the peak, then row out easy.',
      // winddown share = the cool-down after the peak (the last ~15 % of the steps)
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.22 }, { phase: 'escalation', share: 0.28 }, { phase: 'finale', share: 0.15 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, birds: true, tremor: true, calving: true, ash: true,
        eruption: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        wave: true, escape: true, sunset: true,
      },
    },
    pyramid: {
      summary: 'Eruption and tidal wave wait at the top – then glide home.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.08 }, { phase: 'finale', share: 0.12 }, { phase: 'winddown', share: 0.4 }],
      beats: {
        calm: true, birds: true, tremor: true, calving: true, ash: true,
        eruption: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        wave: true, escape: true, sunset: true,
      },
    },
    waves: {
      summary: 'The volcano erupts in bursts – push on every crest.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.45 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, birds: true, tremor: true, calving: true, ash: true,
        eruption: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        escape: { caption: 'The eruption dies down. Safe waters ahead.' },
        sunset: true,
      },
    },
  },
};
