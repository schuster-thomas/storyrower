import { describe, expect, it } from 'vitest';
import { ICELAND } from '../game/levels/iceland';
import { DEFAULT_SETTINGS, generateWorkout, phaseSpans, segmentAt } from '../workout/workout';
import { environmentAt, scheduleBeats, storyStateAt } from './story';

const ORDER = ['calm', 'birds', 'tremor', 'calving', 'ash', 'eruption', 'wave', 'escape', 'sunset'];

describe('story engine', () => {
  for (const durationMin of [10, 20, 30, 45, 60, 90]) {
    for (const minSegmentSec of [30, 60, 120]) {
      it(`places every Iceland beat in order (${durationMin} min, sections ≥ ${minSegmentSec} s)`, () => {
        const w = generateWorkout({ ...DEFAULT_SETTINGS, durationMin, minSegmentSec });
        const beats = scheduleBeats(ICELAND, w);
        const ids = beats.map((b) => b.id);
        // every beat that has an anchor in this workout is placed, in story order
        expect(ids).toEqual(ORDER.filter((id) => ids.includes(id)));
        for (const b of beats) {
          expect(b.t).toBeGreaterThanOrEqual(0);
          expect(b.t).toBeLessThan(w.duration);
        }
        if (phaseSpans(w).some((p) => p.phase === 'escalation')) {
          const eruption = beats.find((b) => b.id === 'eruption')!;
          expect(segmentAt(w, eruption.t).kind).toBe('hard');
        }
      });
    }
  }

  it('places the key beats at the right phase starts for the default workout', () => {
    const w = generateWorkout(DEFAULT_SETTINGS);
    const beats = scheduleBeats(ICELAND, w);
    const at = (id: string) => beats.find((b) => b.id === id)!.t;
    const spans = phaseSpans(w);
    const start = (p: string) => spans.find((s) => s.phase === p)!.start;
    expect(beats).toHaveLength(ORDER.length);
    expect(at('tremor')).toBe(start('omens'));
    expect(at('eruption')).toBe(start('escalation'));
    expect(at('wave')).toBe(start('finale'));
    expect(at('escape')).toBe(start('winddown'));
  });

  it('derives ongoing effects from the time only (robust to jumping around)', () => {
    const w = generateWorkout(DEFAULT_SETTINGS);
    const beats = scheduleBeats(ICELAND, w);
    const at = (id: string) => beats.find((b) => b.id === id)!.t;
    expect(storyStateAt(beats, w, 10)).toMatchObject({ birds: 1, lavaBombs: 0, ashfall: 0 });
    expect(storyStateAt(beats, w, at('eruption') + 5).lavaBombs).toBeGreaterThan(0.5);
    expect(storyStateAt(beats, w, at('wave') + 5).lavaBombs).toBe(1);
    expect(storyStateAt(beats, w, at('ash') + 60).ashfall).toBe(1);
    expect(storyStateAt(beats, w, at('escape') + 5).lavaBombs).toBe(0);
    expect(storyStateAt(beats, w, w.duration - 1).ashfall).toBeLessThan(0.5);
  });

  it('wakes the volcano, lets it erupt and cools it down again', () => {
    const w = generateWorkout(DEFAULT_SETTINGS);
    const beats = scheduleBeats(ICELAND, w);
    const at = (id: string) => beats.find((b) => b.id === id)!.t;
    const calm = storyStateAt(beats, w, 10);
    expect(calm).toMatchObject({ unrest: 0, eruptionAge: -1, cooling: 0 });
    // unrest builds from the tremor up to the eruption
    const mid = storyStateAt(beats, w, (at('tremor') + at('eruption')) / 2);
    expect(mid.unrest).toBeGreaterThan(0.3);
    expect(mid.unrest).toBeLessThan(0.7);
    expect(storyStateAt(beats, w, at('eruption') + 30).eruptionAge).toBeCloseTo(30);
    expect(storyStateAt(beats, w, at('wave')).cooling).toBe(0);
    expect(storyStateAt(beats, w, w.duration - 1).cooling).toBeGreaterThan(0.5);
    // the calving is announced to the scene ahead of time, so the ice tower can stand there already
    expect(storyStateAt(beats, w, at('calving') - 30).calvingIn).toBeCloseTo(30);
    expect(storyStateAt(beats, w, at('calving') + 1).calvingIn).toBe(-1);
  });

  for (const durationMin of [10, 30, 60]) {
    it(`ends happily: volcano asleep, air clear, wave gone (${durationMin} min)`, () => {
      const w = generateWorkout({ ...DEFAULT_SETTINGS, durationMin });
      const beats = scheduleBeats(ICELAND, w);
      const winddown = phaseSpans(w).find((p) => p.phase === 'winddown')!;
      // right after the escape it is still smoky…
      const escaped = environmentAt(ICELAND, w, winddown.start + 1);
      expect(escaped.smoke).toBeGreaterThan(0.1);
      // …from the middle of the wind-down on everything has settled
      for (const t of [(winddown.start + winddown.end) / 2, w.duration - 1]) {
        const env = environmentAt(ICELAND, w, t);
        expect(env).toMatchObject({ lava: 0, smoke: 0, wave: 0 });
        expect(storyStateAt(beats, w, t)).toMatchObject({ unrest: 0, ashfall: 0, lavaBombs: 0, cooling: 1 });
      }
    });
  }

  it('blends the environment smoothly instead of jumping at phase borders', () => {
    const w = generateWorkout(DEFAULT_SETTINGS);
    const omens = phaseSpans(w).find((p) => p.phase === 'omens')!;
    const before = environmentAt(ICELAND, w, omens.start - 1);
    const after = environmentAt(ICELAND, w, omens.start + 1);
    const idyll = environmentAt(ICELAND, w, 10);
    // already partly on the way before the border, and the jump at the border is smaller than the full step
    expect(before.smoke).toBeGreaterThan(idyll.smoke);
    expect(Math.abs(after.smoke - before.smoke)).toBeLessThan(ICELAND.phases.omens.env.smoke - ICELAND.phases.idyll.env.smoke);
  });
});
