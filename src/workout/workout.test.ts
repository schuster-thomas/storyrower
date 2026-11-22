import { describe, expect, it } from 'vitest';
import { formatPace, paceFromPower, powerFromPace } from '../rower/ftms';
import { accuracy, newScore, stars, updateScore, zoneOf } from './scoring';
import { DEFAULT_TRAININGS } from './defaultTrainings';
import { cleanSettings, customBands, DEFAULT_SETTINGS, generateWorkout, MODES, segmentAt } from './workout';

describe('workout generator (default trainings)', () => {
  for (const mode of MODES) {
    for (const durationMin of [10, 25, 45, 90]) {
      it(`${mode}: ${durationMin} min – exact, gap-free, sections as configured`, () => {
        const w = generateWorkout({ ...DEFAULT_SETTINGS, mode, durationMin });
        expect(w.duration).toBe(durationMin * 60);
        expect(w.segments[0].start).toBe(0);
        for (let i = 1; i < w.segments.length; i++) expect(w.segments[i].start).toBe(w.segments[i - 1].end);
        // one section per configured section, each about its share of the time (10 s steps)
        const conf = DEFAULT_TRAININGS[mode].sections;
        const sum = conf.reduce((a, s) => a + s.share, 0);
        expect(new Set(w.segments.map((s) => s.section)).size).toBe(conf.length);
        conf.forEach((c, i) => {
          const segs = w.segments.filter((s) => s.section === i);
          const len = segs[segs.length - 1].end - segs[0].start;
          expect(Math.abs(len - (c.share / sum) * w.duration)).toBeLessThanOrEqual(10);
          expect(segs[0].slower).toBe(c.slower);
          expect(segs[0].fewer).toBe(c.fewer);
        });
      });
    }
  }

  it('sets every section against the peak split and stroke rate', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'buildup', maxPower: powerFromPace(155), maxSpm: 28 });
    const peak = w.segments.find((s) => s.slower === 0)!;
    expect(formatPace(peak.pace.target)).toBe('2:35');
    expect(peak.spm.target).toBe(28);
    expect(peak.kind).toBe('peak');
    const first = DEFAULT_TRAININGS.buildup.sections[0];
    expect(w.segments[0].pace.target).toBeCloseTo(155 + first.slower, 5);
    expect(w.segments[0].spm.target).toBe(28 - first.fewer);
    for (const g of w.segments) expect(g.pace.target).toBeCloseTo(paceFromPower(g.power.target), 0);
  });

  it('build-up: the peak lands in the finale, then an easy cool-down', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'buildup' });
    const peak = w.segments.filter((s) => s.slower === 0);
    expect(new Set(peak.map((s) => s.phase))).toEqual(new Set(['finale']));
    expect(w.segments[w.segments.length - 1].phase).toBe('winddown');
    expect(w.segments[w.segments.length - 1].intensity).toBeLessThan(0.2);
  });

  it('a section cut by a story phase keeps its targets on both sides', () => {
    for (const mode of MODES) {
      const w = generateWorkout({ ...DEFAULT_SETTINGS, mode });
      for (let i = 1; i < w.segments.length; i++) {
        const a = w.segments[i - 1], b = w.segments[i];
        if (a.section === b.section) {
          expect(b.pace.target).toBe(a.pace.target);
          expect(b.spm.target).toBe(a.spm.target);
          expect(b.phase).not.toBe(a.phase);
        }
      }
    }
  });

  it('derives consistent power, stroke rate and pace bands', () => {
    const b = customBands(110, 30, { slower: 0, fewer: 0 });
    expect(b.power.lo).toBeLessThan(110);
    expect(b.power.hi).toBeGreaterThan(110);
    expect(b.spm).toEqual({ lo: 28, hi: 32, target: 30 });
    // faster split belongs to higher power
    expect(b.pace.lo).toBeCloseTo(paceFromPower(b.power.hi), 0);
    // ±5 s around the target split, the watts derived from it
    expect(b.pace.target - b.pace.lo).toBeCloseTo(5);
    expect(b.pace.hi - b.pace.target).toBeCloseTo(5);
    expect(b.power.lo).toBe(Math.round(powerFromPace(b.pace.target + 5)));
    expect(b.power.hi).toBe(Math.round(powerFromPace(b.pace.target - 5)));
    expect(b.pace.lo).toBeLessThan(b.pace.hi);
  });

  it('runs 25 min by default and keeps the duration within 10–90 min', () => {
    expect(generateWorkout(DEFAULT_SETTINGS).duration).toBe(25 * 60);
    expect(generateWorkout({ ...DEFAULT_SETTINGS, durationMin: 200 }).duration).toBe(90 * 60);
    expect(generateWorkout({ ...DEFAULT_SETTINGS, durationMin: 3 }).duration).toBe(10 * 60);
  });

  it('cleans settings from an older version', () => {
    const s = cleanSettings({ mode: 'story', minPower: 55, maxPower: 120, minSpm: 22, maxSpm: 29, durationMin: 20, minSegmentSec: 120, steadyPower: 80 });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, mode: 'buildup', maxPower: 120, maxSpm: 29, durationMin: 20 });
  });
});

describe('scoring', () => {
  const seg = generateWorkout(DEFAULT_SETTINGS).segments[0];

  it('classifies zones with a small "close" margin', () => {
    expect(zoneOf(100, { lo: 90, hi: 110 })).toBe('in');
    expect(zoneOf(87, { lo: 90, hi: 110 })).toBe('close-low');
    expect(zoneOf(70, { lo: 90, hi: 110 })).toBe('low');
    expect(zoneOf(114, { lo: 90, hi: 110 })).toBe('close-high');
    expect(zoneOf(150, { lo: 90, hi: 110 })).toBe('high');
  });

  it('rewards staying in band and lets the threat close in when too low', () => {
    const mid = (seg.power.lo + seg.power.hi) / 2;
    const spm = (seg.spm.lo + seg.spm.hi) / 2;
    const good = newScore();
    for (let i = 0; i < 600; i++) updateScore(good, 0.1, seg, mid, spm);
    expect(accuracy(good)).toBeCloseTo(1);
    expect(stars(good)).toBe(3);
    expect(good.threat).toBe(1);
    expect(good.coins).toBeGreaterThan(60);

    const lazy = newScore();
    for (let i = 0; i < 600; i++) updateScore(lazy, 0.1, seg, 10, spm);
    expect(lazy.threat).toBe(0);
    expect(stars(lazy)).toBe(0);
  });

  it('gives no reward for going too hard, but no penalty either', () => {
    const s = newScore();
    s.threat = 0.5;
    for (let i = 0; i < 100; i++) updateScore(s, 0.1, seg, 400, (seg.spm.lo + seg.spm.hi) / 2);
    expect(s.threat).toBe(0.5);
    expect(s.coins).toBe(0);
  });

  it('finds the segment for a given time', () => {
    const w = generateWorkout(DEFAULT_SETTINGS);
    expect(segmentAt(w, 0).phase).toBe('idyll');
    expect(segmentAt(w, w.duration - 1).phase).toBe('winddown');
    expect(segmentAt(w, w.duration + 100).phase).toBe('winddown');
  });
});
