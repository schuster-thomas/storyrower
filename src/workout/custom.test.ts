import { describe, expect, it } from 'vitest';
import { formatPace, paceFromPower, powerFromPace } from '../rower/ftms';
import { mergeCustomFiles, sameCustomFiles, type CustomFile } from './customStore';
import { customDuration, customPhasePlan, DEFAULT_SETTINGS, generateWorkout, intensityScale, phaseSpans, type CustomSection } from './workout';

const intervals: CustomSection[] = [
  { sec: 300, slower: 30, fewer: 4 },
  { sec: 60, slower: 5, fewer: 1 }, { sec: 60, slower: 30, fewer: 4 },
  { sec: 60, slower: 5, fewer: 1 }, { sec: 60, slower: 30, fewer: 4 },
  { sec: 120, slower: 0, fewer: 0 },
  { sec: 240, slower: 40, fewer: 6 },
];
const custom = (sections: CustomSection[]) =>
  generateWorkout({ ...DEFAULT_SETTINGS, mode: 'custom', customMaxPower: powerFromPace(120), customMaxSpm: 30, custom: { id: 'x', name: 'Test', sections } });

describe('custom trainings', () => {
  it('lasts exactly as long as its sections', () => {
    const w = custom(intervals);
    expect(w.duration).toBe(customDuration(intervals));
    expect(w.settings.mode).toBe('custom');
  });

  it('sets split and stroke rate against the max', () => {
    const w = custom(intervals);
    const peak = w.segments.find((s) => s.start === 540)!;
    expect(formatPace(peak.pace.target)).toBe('2:00');
    expect(peak.spm.target).toBe(30);
    // straight from an easy section to the max: an interval ("hard"), not a step-by-step peak
    expect(peak.kind).toBe('hard');
    // +30 s at a 2:00 max: 2:30; 4 strokes under 30: 26
    expect(formatPace(w.segments[0].pace.target)).toBe('2:30');
    expect(w.segments[0].spm.target).toBe(26);
    expect(paceFromPower(w.segments[0].power.target)).toBeCloseTo(150, 0);
  });

  it('has its own max split and stroke rate, apart from the peak of the other modes', () => {
    const run = (maxPower: number, maxSpm: number) => generateWorkout({ ...DEFAULT_SETTINGS, mode: 'custom', maxPower, maxSpm,
      customMaxPower: powerFromPace(155), customMaxSpm: 28, custom: { id: 'x', name: 'Test', sections: intervals } });
    const a = run(80, 20), b = run(250, 36);
    expect(a.segments).toEqual(b.segments);
    const peak = a.segments.find((s) => s.start === 540)!;
    expect(formatPace(peak.pace.target)).toBe('2:35');
    expect(peak.spm.target).toBe(28);
    // +30 s and 4 strokes under: 3:05 at 24 spm
    expect(formatPace(a.segments[0].pace.target)).toBe('3:05');
    expect(a.segments[0].spm.target).toBe(24);
  });

  it('colours within the training: green to red with 3+ levels, all amber with fewer', () => {
    const scale = intensityScale(intervals);
    expect(scale({ slower: 40 })).toBe(0);   // the easiest section of this training
    expect(scale({ slower: 0 })).toBe(1);    // the hardest
    expect(scale({ slower: 20 })).toBe(0.5);
    const two = intensityScale([{ slower: 0 }, { slower: 30 }]);
    expect(two({ slower: 0 })).toBe(0.5);
    expect(two({ slower: 30 })).toBe(0.5);
    expect(intensityScale([{ slower: 0 }])({ slower: 0 })).toBe(0.5);
  });

  it('puts the finale on the hardest stretch', () => {
    const plan = customPhasePlan(intervals)!;
    expect(plan.map((p) => p.phase)).toEqual(['idyll', 'omens', 'escalation', 'finale', 'winddown']);
    const spans = phaseSpans(custom(intervals));
    expect(spans.find((s) => s.phase === 'finale')).toMatchObject({ start: 540, end: 660 });
    expect(spans.find((s) => s.phase === 'winddown')).toMatchObject({ start: 660, end: 900 });
  });

  it('cuts sections at phase changes only with the same targets on both sides', () => {
    const w = custom(intervals);
    for (let i = 1; i < w.segments.length; i++) {
      const a = w.segments[i - 1], b = w.segments[i];
      expect(a.end).toBe(b.start);
      if (a.phase !== b.phase && intervals.some((_, k) => customDuration(intervals.slice(0, k)) === b.start) === false) {
        expect(b.pace.target).toBe(a.pace.target);
        expect(b.spm.target).toBe(a.spm.target);
      }
    }
  });

  it('uses the level plan when the peak comes first', () => {
    expect(customPhasePlan([{ sec: 600, slower: 0, fewer: 0 }, { sec: 600, slower: 30, fewer: 5 }])).toBeNull();
    const w = custom([{ sec: 600, slower: 0, fewer: 0 }, { sec: 600, slower: 30, fewer: 5 }]);
    expect(w.duration).toBe(1200);
    expect(phaseSpans(w).length).toBeGreaterThan(1);
  });

  it('rows a build-up when the training has no sections', () => {
    expect(custom([]).settings.mode).toBe('buildup');
  });
});

describe('custom trainings in Drive', () => {
  const t = (id: string, updatedAt: string, name = id) => ({ id, name, sections: [{ sec: 60, slower: 20, fewer: 2 }], updatedAt });
  it('merges training by training, the newer one wins', () => {
    const local: CustomFile = { v: 1, trainings: [t('a', '2026-11-20', 'A new'), t('b', '2026-11-01')] };
    const remote: CustomFile = { v: 1, trainings: [t('a', '2026-11-10', 'A old'), t('c', '2026-11-15')] };
    const m = mergeCustomFiles(local, remote);
    expect(m.trainings.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(m.trainings[0].name).toBe('A new');
  });

  it('a deletion wins over an older copy', () => {
    const local: CustomFile = { v: 1, trainings: [{ ...t('a', '2026-11-21'), sections: [], deleted: true }] };
    const remote: CustomFile = { v: 1, trainings: [t('a', '2026-11-10')] };
    expect(mergeCustomFiles(local, remote).trainings[0].deleted).toBe(true);
    expect(sameCustomFiles(mergeCustomFiles(local, remote), local)).toBe(true);
    expect(sameCustomFiles(mergeCustomFiles(local, remote), remote)).toBe(false);
  });
});
