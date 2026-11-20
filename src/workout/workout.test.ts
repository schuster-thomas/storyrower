import { describe, expect, it } from 'vitest';
import { formatPace, paceFromPower, powerFromPace } from '../rower/ftms';
import { accuracy, newScore, stars, updateScore, zoneOf } from './scoring';
import { DEFAULT_SETTINGS, PHASES, bandsFor, generateWorkout, phaseSpans, segmentAt } from './workout';

describe('workout generator', () => {
  for (const durationMin of [10, 15, 20, 30, 45, 60, 90]) {
    it(`builds a gap-free ${durationMin} min workout with all five phases`, () => {
      const w = generateWorkout({ ...DEFAULT_SETTINGS, durationMin });
      expect(w.duration).toBe(durationMin * 60);
      expect(w.segments[0].start).toBe(0);
      for (let i = 1; i < w.segments.length; i++) expect(w.segments[i].start).toBe(w.segments[i - 1].end);
      expect(phaseSpans(w).map((p) => p.phase)).toEqual(PHASES);
      // starts and ends easy, peaks in the finale
      expect(w.segments[0].intensity).toBeLessThan(0.2);
      expect(w.segments[w.segments.length - 1].intensity).toBe(0);
      const peak = w.segments.reduce((a, b) => (b.intensity > a.intensity ? b : a));
      expect(peak.phase).toBe('finale');
    });
  }

  it('alternates hard and easy intervals in the escalation phase', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, durationMin: 30 });
    const kinds = w.segments.filter((s) => s.phase === 'escalation').map((s) => s.kind);
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    kinds.forEach((k, i) => expect(k).toBe(i % 2 === 0 ? 'hard' : 'easy'));
  });

  for (const mode of ['story', 'buildup', 'pyramid', 'waves'] as const) {
    it(`${mode}: the minimum is the first target, the maximum the peak target`, () => {
      const s = { ...DEFAULT_SETTINGS, mode, minPower: 60, maxPower: 120, minSpm: 22, maxSpm: 30 };
      const w = generateWorkout(s);
      expect(w.segments[0].power.target).toBe(60);
      expect(w.segments[0].spm.target).toBe(22);
      expect(Math.max(...w.segments.map((g) => g.power.target))).toBe(120);
      expect(Math.max(...w.segments.map((g) => g.spm.target))).toBe(30);
      // the band is the tolerance around the target – it may reach past the configured range
      expect(w.segments[0].power.lo).toBeLessThan(60);
      expect(Math.max(...w.segments.map((g) => g.power.hi))).toBeGreaterThan(120);
      for (const g of w.segments) {
        expect(g.pace.target).toBeCloseTo(paceFromPower(g.power.target), 0);
        expect(g.power.target).toBeGreaterThanOrEqual(60);
        expect(g.power.target).toBeLessThanOrEqual(120);
      }
    });
  }

  it('keeps splits entered in the settings exact at the start and the peak', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, mode: 'pyramid', minPower: powerFromPace(170), maxPower: powerFromPace(140) });
    expect(formatPace(w.segments[0].pace.target)).toBe('2:50');
    expect(formatPace(Math.min(...w.segments.map((g) => g.pace.target)))).toBe('2:20');
  });

  it('derives consistent power, stroke rate and pace bands', () => {
    const b = bandsFor(DEFAULT_SETTINGS, 1);
    expect(b.power.lo).toBeLessThan(110);
    expect(b.power.hi).toBeGreaterThan(110);
    expect(b.spm).toEqual({ lo: 28, hi: 32, target: 30 });
    // faster split belongs to higher power
    expect(b.pace.lo).toBeCloseTo(paceFromPower(b.power.hi));
    expect(b.pace.lo).toBeLessThan(b.pace.hi);
  });

  for (const [durationMin, minSegmentSec] of [[20, 30], [20, 60], [30, 90], [45, 120], [10, 180], [60, 300]]) {
    it(`keeps every section ≥ ${minSegmentSec} s in a ${durationMin} min workout`, () => {
      const w = generateWorkout({ ...DEFAULT_SETTINGS, durationMin, minSegmentSec });
      expect(w.duration).toBe(durationMin * 60);
      for (const s of w.segments) expect(s.end - s.start).toBeGreaterThanOrEqual(minSegmentSec);
      for (let i = 1; i < w.segments.length; i++) expect(w.segments[i].start).toBe(w.segments[i - 1].end);
    });
  }

  it('uses longer intervals when the minimum section is longer', () => {
    const short = generateWorkout({ ...DEFAULT_SETTINGS, durationMin: 20, minSegmentSec: 30 });
    const long = generateWorkout({ ...DEFAULT_SETTINGS, durationMin: 20, minSegmentSec: 90 });
    expect(long.segments.length).toBeLessThan(short.segments.length);
  });

  it('swaps min/max if entered the wrong way round', () => {
    const w = generateWorkout({ ...DEFAULT_SETTINGS, minPower: 120, maxPower: 60 });
    expect(w.settings.minPower).toBe(60);
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
