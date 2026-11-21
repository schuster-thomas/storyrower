import { describe, expect, it } from 'vitest';
import { scheduleBeats, storyStateAt } from '../../story/story';
import { DEFAULT_SETTINGS, MODES, phaseSpans } from '../../workout/workout';
import { ICELAND } from './iceland';
import { levelForMode, levelModes, levelWorkout } from './level';
import { MAURITIUS } from './mauritius';
import { TOKYO } from './tokyo';

describe('Mauritius Shark Madness', () => {
  it('offers the same modes as Iceland', () => {
    expect(levelModes(MAURITIUS)).toEqual(levelModes(ICELAND));
  });

  for (const mode of MODES) {
    for (const durationMin of [10, 20, 60]) {
      it(`${mode} (${durationMin} min): beats land inside the workout, in level order`, () => {
        const lv = levelForMode(MAURITIUS, mode);
        const w = levelWorkout(MAURITIUS, { ...DEFAULT_SETTINGS, mode, durationMin });
        const beats = scheduleBeats(lv, w);
        const ids = beats.map((b) => b.id);
        expect(ids).toEqual(MAURITIUS.beats.map((b) => b.id).filter((id) => ids.includes(id)));
        for (const b of beats) expect(b.t).toBeLessThan(w.duration);
        if (mode === 'steady') {
          expect(ids).not.toContain('storm'); expect(ids).not.toContain('shark');
          // the weather holds: people on the water from start to finish
          for (let t = 0; t < w.duration; t += 30) expect(storyStateAt(beats, w, t)).toMatchObject({ visitors: 1, storm: 0, shark: 0 });
        } else if (durationMin === 60) { expect(ids).toContain('storm'); expect(ids).toContain('shark'); }
      });
    }
  }

  it('build-up: the fin circles closer through the storm, the shark attacks in the finale, and it all clears for the sunset', () => {
    const lv = levelForMode(MAURITIUS, 'buildup');
    const w = levelWorkout(MAURITIUS, { ...DEFAULT_SETTINGS, mode: 'buildup', durationMin: 20 });
    const beats = scheduleBeats(lv, w);
    const at = (id: string) => beats.find((b) => b.id === id)!.t;
    const state = (t: number) => storyStateAt(beats, w, t);
    expect(state(at('clouds') - 5)).toMatchObject({ visitors: 1, storm: 0, shark: 0, sharkAge: -1, attack: 0 });
    expect(state(at('clouds') + 60).visitors).toBe(0);
    expect(state(at('clouds') + 60).storm).toBeCloseTo(0.4, 1);
    expect(state(at('fin') + 1).shark).toBe(1);
    // closer and closer
    const nearAfterFin = state(at('fin') + 5).sharkNear, nearInStorm = state(at('storm') + 30).sharkNear;
    expect(nearAfterFin).toBeLessThan(0.35);
    expect(nearInStorm).toBeGreaterThan(nearAfterFin);
    expect(state(at('storm') + 20).storm).toBe(1);
    const finale = phaseSpans(w).find((s) => s.phase === 'finale')!;
    const fight = state((finale.start + finale.end) / 2);
    expect(fight).toMatchObject({ shark: 1, sharkNear: 1 });
    expect(fight.attack).toBeGreaterThan(0);
    expect(state(w.duration - 1)).toMatchObject({ storm: 0, shark: 0, attack: 0, visitors: 1 });
  });

  it('Iceland and Tokyo never see the Mauritius story', () => {
    for (const level of [ICELAND, TOKYO]) {
      const lv = levelForMode(level, 'buildup');
      const w = levelWorkout(level, { ...DEFAULT_SETTINGS, mode: 'buildup', durationMin: 20 });
      const beats = scheduleBeats(lv, w);
      for (let t = 0; t < w.duration; t += 30) expect(storyStateAt(beats, w, t)).toMatchObject({ storm: 0, shark: 0, sharkAge: -1, sharkNear: 0 });
    }
  });
});
