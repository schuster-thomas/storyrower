import tokyoCard from '../../assets/ui/tokyo-card.webp';
import type { Level } from './level';

/**
 * Tokyo Super Row: cherry blossoms on a river through Tokyo – gardens and pagodas on the left,
 * high-rises and the lattice tower on the right, the snow-capped volcano far ahead. Tremors grow
 * into a great earthquake that breaks parts off the high-rises into the river; then a dragon rises
 * over the city and fires lasers at the rower. At the end it soars away and the blossoms return.
 */
export const TOKYO: Level = {
  id: 'tokyo-super-row',
  title: 'Tokyo Super Row',
  tagline: 'Cherry blossoms, an earthquake and a laser-breathing dragon over Tokyo.',
  art: tokyoCard,
  world: 'tokyo',
  gates: 'torii',
  loadingText: 'Loading Tokyo…',
  phases: {
    idyll: {
      id: 'idyll', name: 'Sakura Morning',
      env: { sky: 0x8ccff5, fog: 0xcfe7f7, fogNear: 170, fogFar: 900, sun: 0xfff2dc, sunIntensity: 2.2, ground: 0x6fae55, water: 0x2aa3c4, lava: 0, smoke: 0, wave: 0, swell: 0.08, sunHeight: 0.45 },
    },
    omens: {
      id: 'omens', name: 'Restless Ground',
      env: { sky: 0xa6c6dc, fog: 0xd3dbe0, fogNear: 140, fogFar: 760, sun: 0xffe8c4, sunIntensity: 2.0, ground: 0x6fa055, water: 0x2b93b4, lava: 0, smoke: 0, wave: 0, swell: 0.25, sunHeight: 0.4 },
    },
    escalation: {
      id: 'escalation', name: 'The Great Quake',
      chase: 'More power – get clear of the falling buildings!',
      env: { sky: 0xc9b193, fog: 0xcdb79c, fogNear: 90, fogFar: 560, sun: 0xffd6a0, sunIntensity: 1.8, ground: 0x6a8a50, water: 0x2d7593, lava: 0, smoke: 0, wave: 0, swell: 0.6, sunHeight: 0.32 },
    },
    finale: {
      id: 'finale', name: 'Dragon Attack',
      chase: 'More power – the dragon is taking aim!',
      env: { sky: 0x4d5a9c, fog: 0x7d7aa6, fogNear: 90, fogFar: 560, sun: 0xffb0c8, sunIntensity: 1.55, ground: 0x4f5a5a, water: 0x2a4c7c, lava: 0.2, smoke: 0, wave: 0, swell: 0.85, sunHeight: 0.18 },
    },
    winddown: {
      id: 'winddown', name: 'Blossom Calm',
      env: { sky: 0xf2a98a, fog: 0xf4c3a8, fogNear: 150, fogFar: 880, sun: 0xffc48a, sunIntensity: 1.9, ground: 0x6c8f52, water: 0x3a80ac, lava: 0, smoke: 0, wave: 0, swell: 0.2, sunHeight: 0.1 },
      // the dragon is gone, the water calms, golden evening light over the gardens
      settled: { swell: 0.06, sky: 0xf6bd90, fog: 0xf9d4b4, fogNear: 200, fogFar: 1000, sunIntensity: 2.1 },
    },
  },
  beats: [
    { id: 'calm', name: 'Cherry blossoms', anchor: { at: 'phase-start', phase: 'idyll', offset: 3 }, effect: 'blossom', caption: 'Cherry blossoms drift on the river. Find your rhythm.' },
    { id: 'gust', name: 'Petal storm', anchor: { at: 'phase-fraction', phase: 'idyll', fraction: 0.55 }, effect: 'blossom', caption: 'A gust of wind – a cloud of petals over the water.' },
    { id: 'tremor', name: 'First tremor', anchor: { at: 'phase-start', phase: 'omens', offset: 0 }, effect: 'tremor', caption: 'The ground trembles… the lanterns sway.' },
    { id: 'tremor2', name: 'Second tremor', anchor: { at: 'phase-fraction', phase: 'omens', fraction: 0.55 }, effect: 'tremor', caption: 'Another tremor – the towers sway against the sky.' },
    { id: 'quake', name: 'Great quake', anchor: { at: 'first-section', kind: 'hard', offset: 0 }, effect: 'quake', caption: 'EARTHQUAKE! The high-rises crumble into the river – row!' },
    { id: 'dragon', name: 'Dragon', anchor: { at: 'phase-start', phase: 'finale', offset: 0 }, effect: 'dragon', caption: 'A dragon rises over Tokyo! Outrow its lasers!' },
    { id: 'escape', name: 'Escape', anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, effect: 'escape', caption: 'The dragon soars away into the evening sky. You made it!' },
    { id: 'sunset', name: 'Golden evening', anchor: { at: 'phase-fraction', phase: 'winddown', fraction: 0.5 }, effect: 'sunset', caption: 'Peace returns. Glide home under the cherry trees.' },
  ],
  modes: {
    steady: {
      summary: 'A peaceful row under the cherry blossoms – the city stays calm.',
      phases: [{ phase: 'idyll', share: 0.85 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true,
        gust: { anchor: { at: 'fraction', fraction: 0.45 } },
        sunset: { anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, caption: 'Golden evening light over the gardens. Keep your rhythm.' },
      },
    },
    buildup: {
      summary: 'Tremors grow into a great quake – at the peak a dragon attacks, then row out easy.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.22 }, { phase: 'escalation', share: 0.28 }, { phase: 'finale', share: 0.15 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, gust: true, tremor: true, tremor2: true,
        quake: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        dragon: true, escape: true, sunset: true,
      },
    },
    pyramid: {
      summary: 'The quake and the dragon wait at the top – then glide home under the blossoms.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.08 }, { phase: 'finale', share: 0.12 }, { phase: 'winddown', share: 0.4 }],
      beats: {
        calm: true, gust: true, tremor: true, tremor2: true,
        quake: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        dragon: true, escape: true, sunset: true,
      },
    },
    waves: {
      summary: 'Aftershocks on every crest – and halfway through, the dragon joins in.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.45 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, gust: true, tremor: true, tremor2: true,
        quake: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        dragon: { anchor: { at: 'phase-fraction', phase: 'escalation', fraction: 0.5 } },
        escape: true, sunset: true,
      },
    },
  },
};
