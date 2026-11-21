import { describe, expect, it } from 'vitest';
import { pickVariant } from './SampleBank';

describe('pickVariant', () => {
  it('always returns 0 for a single variant', () => {
    expect(pickVariant(1, 0, 0.9)).toBe(0);
    expect(pickVariant(0, -1, 0.5)).toBe(0);
  });

  it('never repeats the last variant and covers all others', () => {
    for (let last = 0; last < 4; last++) {
      const seen = new Set<number>();
      for (let r = 0; r < 1; r += 0.01) {
        const i = pickVariant(4, last, r);
        expect(i).not.toBe(last);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(4);
        seen.add(i);
      }
      expect(seen.size).toBe(3);
    }
  });

  it('can pick any variant when nothing was played yet', () => {
    const seen = new Set<number>();
    for (let r = 0; r < 1; r += 0.01) seen.add(pickVariant(3, -1, r));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});
