import mauritiusCard from '../../assets/ui/mauritius-card.webp';
import type { Level } from './level';

/**
 * Mauritius Shark Madness: a turquoise lagoon off the south-west coast – the open sea on the left,
 * a palm beach and the great basalt monolith on the right. Paddle boarders, a windsurfer and a water-skier
 * enjoy the morning; then clouds gather and a fin appears far out. A thunderstorm breaks, the fin
 * circles closer and closer – and at the peak the shark attacks the boat. Once the rower has
 * escaped, the storm passes and the evening ends in a soft, low sunset over the sea.
 */
export const MAURITIUS: Level = {
  id: 'mauritius-shark-madness',
  title: 'Mauritius Shark Madness',
  tagline: 'A turquoise lagoon, a tropical thunderstorm – and a great white shark circling closer.',
  art: mauritiusCard,
  world: 'mauritius',
  loadingText: 'Loading the lagoon…',
  phases: {
    idyll: {
      id: 'idyll', name: 'Lagoon Paradise',
      env: { sky: 0x3f9fe8, fog: 0xb4e0f2, fogNear: 190, fogFar: 950, sun: 0xfff4dc, sunIntensity: 2.3, ground: 0x6fae55, water: 0x00a6c2, lava: 0, smoke: 0, wave: 0, swell: 0.1, sunHeight: 0.5 },
    },
    omens: {
      id: 'omens', name: 'Gathering Clouds',
      env: { sky: 0x7d98b0, fog: 0xa7b8c6, fogNear: 150, fogFar: 780, sun: 0xe9e4d6, sunIntensity: 1.85, ground: 0x689c55, water: 0x1f8ea8, lava: 0, smoke: 0, wave: 0, swell: 0.38, sunHeight: 0.42 },
    },
    escalation: {
      id: 'escalation', name: 'Thunderstorm',
      chase: 'More power – the fin is circling closer!',
      env: { sky: 0x3d4c68, fog: 0x5d6b82, fogNear: 90, fogFar: 540, sun: 0xb9c5dc, sunIntensity: 1.35, ground: 0x4f6e50, water: 0x1b6c80, lava: 0, smoke: 0, wave: 0, swell: 0.78, sunHeight: 0.36 },
    },
    finale: {
      id: 'finale', name: 'Shark Attack',
      chase: 'More power – the shark is snapping at you!',
      env: { sky: 0x2f3b56, fog: 0x4d5a72, fogNear: 75, fogFar: 480, sun: 0xaab8d6, sunIntensity: 1.2, ground: 0x445f48, water: 0x175e72, lava: 0, smoke: 0, wave: 0, swell: 0.98, sunHeight: 0.3 },
    },
    winddown: {
      id: 'winddown', name: 'Sunset Lagoon',
      // right after the escape the clouds break up in warm light …
      env: { sky: 0x8d86a8, fog: 0xd6a690, fogNear: 140, fogFar: 760, sun: 0xffb27a, sunIntensity: 1.7, ground: 0x5d7f4c, water: 0x2c7d9c, lava: 0, smoke: 0, wave: 0, swell: 0.4, sunHeight: 0.12 },
      // … then a romantic sunset: the sun low over the sea, soft golden light, still water
      settled: { sky: 0xee9a72, fog: 0xffc795, sun: 0xffa45c, sunIntensity: 1.95, water: 0x3a7ea6, swell: 0.07, fogNear: 220, fogFar: 1000, sunHeight: 0.05 },
    },
  },
  beats: [
    { id: 'calm', name: 'The lagoon', anchor: { at: 'phase-start', phase: 'idyll', offset: 3 }, effect: 'calm', caption: 'Turquoise water, white sand, palms. Find your rhythm.' },
    { id: 'visitors', name: 'Water-skier', anchor: { at: 'phase-fraction', phase: 'idyll', fraction: 0.45 }, effect: 'visitors', caption: 'Paddle boarders, a windsurfer, a water-skier – paradise is busy this morning.' },
    { id: 'clouds', name: 'Clouds gather', anchor: { at: 'phase-start', phase: 'omens', offset: 0 }, effect: 'clouds', caption: 'Dark clouds over the ocean… the swimmers head for the beach.' },
    { id: 'fin', name: 'A fin', anchor: { at: 'phase-fraction', phase: 'omens', fraction: 0.5 }, effect: 'fin', caption: 'A fin! Something is circling far out there…' },
    { id: 'storm', name: 'Thunderstorm', anchor: { at: 'first-section', kind: 'hard', offset: 0 }, effect: 'thunderstorm', caption: 'THUNDERSTORM! Lightning over the sea – and the fin is coming closer.' },
    { id: 'shark', name: 'Shark attack', anchor: { at: 'phase-start', phase: 'finale', offset: 0 }, effect: 'shark', caption: 'SHARK! It is going for the boat – row for your life!' },
    { id: 'escape', name: 'Escape', anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, effect: 'escape', caption: 'The shark gives up and dives into the deep. The storm passes. You made it!' },
    { id: 'sunset', name: 'Sunset', anchor: { at: 'phase-fraction', phase: 'winddown', fraction: 0.5 }, effect: 'sunset', caption: 'A romantic sunset over the lagoon. Glide home in the golden light.' },
  ],
  modes: {
    steady: {
      summary: 'A sunny row through the lagoon – the weather holds and the shark stays away.',
      phases: [{ phase: 'idyll', share: 0.85 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true,
        visitors: { anchor: { at: 'fraction', fraction: 0.3 } },
        sunset: { anchor: { at: 'phase-start', phase: 'winddown', offset: 0 }, caption: 'The sun sinks low over the sea. Keep your rhythm.' },
      },
    },
    buildup: {
      summary: 'Clouds gather, a fin circles closer in a thunderstorm – at the peak the shark attacks, then a sunset.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.22 }, { phase: 'escalation', share: 0.28 }, { phase: 'finale', share: 0.15 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, visitors: true, clouds: true, fin: true,
        storm: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        shark: true, escape: true, sunset: true,
      },
    },
    pyramid: {
      summary: 'The storm and the shark wait at the top – then a long glide into the sunset.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.08 }, { phase: 'finale', share: 0.12 }, { phase: 'winddown', share: 0.4 }],
      beats: {
        calm: true, visitors: true, clouds: true, fin: true,
        storm: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        shark: true, escape: true, sunset: true,
      },
    },
    waves: {
      summary: 'Squalls on every crest – and halfway through, the shark goes for the boat.',
      phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.45 }, { phase: 'winddown', share: 0.15 }],
      beats: {
        calm: true, visitors: true, clouds: true, fin: true,
        storm: { anchor: { at: 'phase-start', phase: 'escalation', offset: 0 } },
        shark: { anchor: { at: 'phase-fraction', phase: 'escalation', fraction: 0.5 } },
        escape: true, sunset: true,
      },
    },
  },
};
