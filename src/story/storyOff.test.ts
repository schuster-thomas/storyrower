import { describe, expect, it } from 'vitest';
import { LEVELS } from '../game/levels';
import { levelForMode, levelWorkout } from '../game/levels/level';
import { DEFAULT_SETTINGS, MODES, phaseSpans, type WorkoutMode } from '../workout/workout';
import { EFFECT_KIND, environmentAt, scheduleBeats, storyStateAt } from './story';

const CUSTOM = { id: 'x', name: 'Test', sections: [{ sec: 300, slower: 30, fewer: 5 }, { sec: 300, slower: 0, fewer: 0 }, { sec: 300, slower: 30, fewer: 5 }] };
const ALL: WorkoutMode[] = [...MODES, 'custom'];

describe('"Include story" off', () => {
  for (const level of LEVELS) {
    for (const mode of ALL) {
      it(`${level.title}, ${mode}: only scenery, a calm look, the same training`, () => {
        const settings = { ...DEFAULT_SETTINGS, mode, custom: CUSTOM, story: false };
        const lv = levelForMode(level, mode, false);
        const w = levelWorkout(level, settings);
        const beats = scheduleBeats(lv, w);
        // the friendly moments are still there, the threatening ones are not
        expect(beats.length).toBeGreaterThan(0);
        for (const b of beats) expect(EFFECT_KIND[b.effect]).toBe('scenery');
        expect(beats.some((b) => b.effect !== 'calm' && b.effect !== 'sunset')).toBe(true);
        // no volcano glow, smoke or tidal wave, no threat state at any time
        for (let t = 0; t < w.duration; t += 30) {
          const env = environmentAt(lv, w, t);
          expect(env.lava + env.smoke + env.wave).toBe(0);
          const st = storyStateAt(beats, w, t);
          expect(st.lavaBombs + st.ashfall + st.unrest + st.quake + st.dragon + st.attack + st.shark + st.storm).toBe(0);
        }
        expect(phaseSpans(w).map((p) => p.phase)).toEqual(['idyll', 'winddown']);
        // the training itself does not change
        const withStory = levelWorkout(level, { ...settings, story: true });
        expect(w.segments.map((s) => [s.section, s.pace.target, s.spm.target]).filter((x, i, a) => i === 0 || x[0] !== a[i - 1][0]))
          .toEqual(withStory.segments.map((s) => [s.section, s.pace.target, s.spm.target]).filter((x, i, a) => i === 0 || x[0] !== a[i - 1][0]));
        expect(w.duration).toBe(withStory.duration);
      });
    }
  }

  it('story on (the default) plays the whole adventure as before', () => {
    for (const level of LEVELS) {
      expect(levelForMode(level, 'buildup')).toEqual(levelForMode(level, 'buildup', true));
      const beats = scheduleBeats(levelForMode(level, 'buildup'), levelWorkout(level, { ...DEFAULT_SETTINGS, mode: 'buildup' }));
      expect(beats.some((b) => EFFECT_KIND[b.effect] === 'story')).toBe(true);
    }
  });

  it('every beat of every level has a kind', () => {
    for (const level of LEVELS) for (const b of level.beats) expect(['scenery', 'story']).toContain(EFFECT_KIND[b.effect]);
  });
});
