import { describe, expect, it } from 'vitest';
import { Water, waterHeight } from './Water';

describe('water surface for the boat', () => {
  const water = new Water([96, 180]);

  it('matches the waves exactly at the grid points', () => {
    // grid: x from -160 every 520/96 m, z every 1000/180 m
    const x = -160 + 30 * (520 / 96), z = -40 * (1000 / 180);
    expect(water.surfaceAt(x, z, 3.2, 1)).toBeCloseTo(waterHeight(x, z, 3.2, 1), 6);
  });

  it('stays between the neighbouring grid points in between', () => {
    for (const swell of [0.1, 0.6, 1]) {
      for (let z = -200; z < -150; z += 0.7) {
        const h = water.surfaceAt(0.3, z, 7.5, swell);
        const amp = 0.06 + swell * 0.45;
        expect(Math.abs(h)).toBeLessThanOrEqual(1.78 * amp + 1e-9);
      }
    }
  });
});
