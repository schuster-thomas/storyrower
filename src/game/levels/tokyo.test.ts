import { describe, expect, it } from 'vitest';
import { scheduleBeats, storyStateAt } from '../../story/story';
import { DEFAULT_SETTINGS, MODES, phaseSpans } from '../../workout/workout';
import { ICELAND } from './iceland';
import { levelForMode, levelModes, levelWorkout } from './level';
import { TOKYO } from './tokyo';

describe('Tokyo Super Row', () => {
  it('offers the same modes as Iceland', () => {
    expect(levelModes(TOKYO)).toEqual(levelModes(ICELAND));
  });

  for (const mode of MODES) {
    for (const durationMin of [10, 20, 60]) {
      it(`${mode} (${durationMin} min): beats land inside the workout, in level order`, () => {
        const lv = levelForMode(TOKYO, mode);
        const w = levelWorkout(TOKYO, { ...DEFAULT_SETTINGS, mode, durationMin });
        const beats = scheduleBeats(lv, w);
        const ids = beats.map((b) => b.id);
        expect(ids).toEqual(TOKYO.beats.map((b) => b.id).filter((id) => ids.includes(id)));
        for (const b of beats) expect(b.t).toBeLessThan(w.duration);
        if (mode === 'steady') { expect(ids).not.toContain('quake'); expect(ids).not.toContain('dragon'); }
        // short workouts can drop whole phases (as in Iceland); a long one has the whole story
        else if (durationMin === 60) { expect(ids).toContain('quake'); expect(ids).toContain('dragon'); }
      });
    }
  }

  it('build-up: the quake shakes until the escape, the dragon attacks in the finale and leaves at the end', () => {
    const lv = levelForMode(TOKYO, 'buildup');
    const w = levelWorkout(TOKYO, { ...DEFAULT_SETTINGS, mode: 'buildup', durationMin: 20 });
    const beats = scheduleBeats(lv, w);
    const at = (id: string) => beats.find((b) => b.id === id)!.t;
    const finale = phaseSpans(w).find((s) => s.phase === 'finale')!;
    expect(storyStateAt(beats, w, at('quake') - 5)).toMatchObject({ quake: 0, dragon: 0, attack: 0 });
    expect(storyStateAt(beats, w, at('quake') + 5).quake).toBeGreaterThan(0);
    const fight = storyStateAt(beats, w, (finale.start + finale.end) / 2);
    expect(fight.dragon).toBe(1);
    expect(fight.attack).toBeGreaterThan(0);
    const end = storyStateAt(beats, w, w.duration - 1);
    expect(end).toMatchObject({ quake: 0, dragon: 0, attack: 0 });
  });

  it('Iceland never sees the Tokyo story', () => {
    const lv = levelForMode(ICELAND, 'buildup');
    const w = levelWorkout(ICELAND, { ...DEFAULT_SETTINGS, mode: 'buildup', durationMin: 20 });
    const beats = scheduleBeats(lv, w);
    for (let t = 0; t < w.duration; t += 30) expect(storyStateAt(beats, w, t)).toMatchObject({ quake: 0, dragon: 0, attack: 0, quakeAge: -1, dragonAge: -1 });
  });
});
