import { describe, expect, it } from 'vitest';
import { ICELAND } from '../game/levels/iceland';
import { levelForMode, levelModes, levelWorkout, pickMode } from '../game/levels/level';
import { scheduleBeats } from '../story/story';
import { DEFAULT_SETTINGS, MODES, generateWorkout, phaseSpans, type WorkoutMode } from './workout';

describe('workout modes', () => {
  it('pyramid peaks in the middle and starts and ends easy', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'pyramid', durationMin: 20 });
    const peak = w.segments.filter((s) => s.slower === 0);
    const mid = (peak[0].start + peak[peak.length - 1].end) / 2;
    expect(Math.abs(mid / w.duration - 0.5)).toBeLessThan(0.07);
    expect(w.segments[0].intensity).toBeLessThan(0.2);
    expect(w.segments[w.segments.length - 1].intensity).toBeLessThan(0.3);
  });

  it('waves go up and down several times', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'waves', durationMin: 30 });
    const kinds = w.segments.filter((s, i) => i === 0 || s.section !== w.segments[i - 1].section).map((s) => s.kind);
    expect(kinds.filter((k) => k === 'hard').length).toBeGreaterThanOrEqual(3);
    expect(w.segments[0].intensity).toBeLessThan(0.2);
  });

  it('steady keeps the same targets the whole way', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'steady', durationMin: 30 });
    expect(new Set(w.segments.map((s) => s.pace.target)).size).toBe(1);
    expect(new Set(w.segments.map((s) => s.spm.target)).size).toBe(1);
  });

  it('falls back to build-up for an unknown mode', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'nonsense' as WorkoutMode });
    expect(w.settings.mode).toBe('buildup');
    expect(phaseSpans(w)).toHaveLength(5);
  });
});

describe('level mode config', () => {
  it('Iceland offers the four default modes', () => {
    expect(levelModes(ICELAND)).toEqual(['steady', 'buildup', 'pyramid', 'waves']);
    expect(pickMode(ICELAND, 'custom')).toBe('custom');
  });

  it('only plays the beats a mode lists', () => {
    const steady = levelForMode(ICELAND, 'steady');
    expect(steady.beats.map((b) => b.id)).toEqual(['calm', 'birds', 'calving', 'sunset']);
    expect(steady.phases.winddown.env.smoke).toBe(0);
    expect(levelForMode(ICELAND, 'custom').beats).toEqual(levelForMode(ICELAND, 'buildup').beats);
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
