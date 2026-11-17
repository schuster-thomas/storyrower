import { describe, expect, it } from 'vitest';
import { AutoQuality, FrameStats } from './quality';

const run = (q: AutoQuality, fps: number, seconds: number) => {
  const changes: string[] = [];
  for (let i = 0; i < fps * seconds; i++) { const c = q.frame(1 / fps); if (c) changes.push(c); }
  return changes;
};

describe('auto quality', () => {
  it('steps down when the frame rate is low', () => {
    const q = new AutoQuality('high');
    expect(run(q, 30, 5)).toEqual(['medium']);
    // cooldown, then further down
    expect(run(q, 30, 20)).toEqual(['low']);
    expect(run(q, 30, 20)).toEqual([]);
  });

  it('steps up only after a long stretch of headroom', () => {
    const q = new AutoQuality('low');
    expect(run(q, 60, 10)).toEqual([]);
    expect(run(q, 60, 10)).toEqual(['medium']);
  });

  it('stays put in the middle band', () => {
    const q = new AutoQuality('medium');
    expect(run(q, 52, 60)).toEqual([]);
  });
});

describe('frame stats', () => {
  it('reports fps and percentiles', () => {
    const s = new FrameStats();
    for (let i = 0; i < 100; i++) s.push(i < 95 ? 16 : 50, 4);
    expect(Math.round(s.fps)).toBe(56);
    expect(s.frameP95).toBe(50);
    expect(s.renderMs).toBe(4);
  });
});
