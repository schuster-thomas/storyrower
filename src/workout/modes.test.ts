import { describe, expect, it } from 'vitest';
import { ICELAND } from '../game/levels/iceland';
import { levelForMode, levelModes, levelWorkout } from '../game/levels/level';
import { scheduleBeats } from '../story/story';
import { DEFAULT_SETTINGS, MODES, generateWorkout, phaseSpans, type WorkoutMode } from './workout';

const SHAPED: WorkoutMode[] = ['steady', 'buildup', 'pyramid', 'waves'];
const gaps = (w: ReturnType<typeof generateWorkout>) => w.segments.every((s, i) => i === 0 ? s.start === 0 : s.start === w.segments[i - 1].end);

describe('workout modes', () => {
  for (const mode of SHAPED) {
    for (const [durationMin, minSegmentSec] of [[10, 30], [20, 30], [20, 120], [45, 60], [90, 30], [10, 300]]) {
      it(`${mode}: ${durationMin} min, sections ≥ ${minSegmentSec} s – exact, gap-free, inside the range`, () => {
        const w = generateWorkout({ ...DEFAULT_SETTINGS, mode, durationMin, minSegmentSec });
        expect(w.duration).toBe(durationMin * 60);
        expect(gaps(w)).toBe(true);
        for (const s of w.segments) {
          expect(s.end - s.start).toBeGreaterThanOrEqual(minSegmentSec);
          expect(s.intensity).toBeGreaterThanOrEqual(0);
          expect(s.intensity).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  it('steady keeps the same targets the whole way', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'steady', durationMin: 30 });
    expect(new Set(w.segments.map((s) => s.intensity))).toEqual(new Set([0.5]));
  });

  it('steady uses its own single power and stroke-rate target', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'steady', steadyPower: 100, steadySpm: 24 });
    for (const s of w.segments) {
      expect((s.power.lo + s.power.hi) / 2).toBe(100);
      expect(s.spm).toEqual({ lo: 22, hi: 26 });
    }
  });

  it('build-up only ever gets harder and ends at the hardest target', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'buildup', durationMin: 20 });
    const i = w.segments.map((s) => s.intensity);
    for (let k = 1; k < i.length; k++) expect(i[k]).toBeGreaterThan(i[k - 1]);
    expect(i[0]).toBe(0);
    expect(i[i.length - 1]).toBe(1);
  });

  it('pyramid peaks in the middle and starts and ends easy', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'pyramid', durationMin: 20 });
    const peak = w.segments.find((s) => s.intensity === 1)!;
    const mid = (peak.start + peak.end) / 2;
    expect(Math.abs(mid / w.duration - 0.5)).toBeLessThan(0.05);
    expect(w.segments[0].intensity).toBe(0);
    expect(w.segments[w.segments.length - 1].intensity).toBe(0);
  });

  it('waves go up and down several times', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'waves', durationMin: 30 });
    const crests = w.segments.filter((s) => s.intensity === 1).length;
    expect(crests).toBeGreaterThanOrEqual(3);
    expect(w.segments[0].intensity).toBe(0);
  });

  it('falls back to story for an unknown mode', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'nonsense' as WorkoutMode });
    expect(phaseSpans(w)).toHaveLength(5);
  });
});

describe('level mode config', () => {
  it('Iceland offers every mode', () => {
    expect(levelModes(ICELAND)).toEqual(MODES);
  });

  it('only plays the beats a mode lists', () => {
    const steady = levelForMode(ICELAND, 'steady');
    expect(steady.beats.map((b) => b.id)).toEqual(['calm', 'birds', 'calving', 'sunset']);
    expect(steady.phases.winddown.env.smoke).toBe(0);
    expect(levelForMode(ICELAND, 'story').beats).toHaveLength(ICELAND.beats.length);
  });

  for (const mode of MODES) {
    for (const durationMin of [10, 20, 60]) {
      it(`${mode} (${durationMin} min): beats land inside the workout, in level order`, () => {
        const lv = levelForMode(ICELAND, mode);
        const w = levelWorkout(ICELAND, { ...DEFAULT_SETTINGS, mode, durationMin });
        const beats = scheduleBeats(lv, w);
        const order = ICELAND.beats.map((b) => b.id);
        const ids = beats.map((b) => b.id);
        expect(ids).toEqual(order.filter((id) => ids.includes(id)));
        for (const b of beats) expect(b.t).toBeLessThan(w.duration);
        if (mode === 'steady') expect(ids).not.toContain('eruption');
        if (mode === 'pyramid' && durationMin >= 20) {
          // the tidal wave comes at the top of the pyramid
          const wave = beats.find((b) => b.id === 'wave')!;
          expect(Math.abs(wave.t / w.duration - 0.5)).toBeLessThan(0.1);
        }
      });
    }
  }
});
