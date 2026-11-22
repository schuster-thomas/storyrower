import { describe, expect, it } from 'vitest';
import { defaults, parseOutfit } from './store';

const saved = { ...defaults, v: 1, updatedAt: '2026-11-22T12:00:00.000Z' };

describe('saved boat selection', () => {
  it('keeps existing outfits on the original boat', () => {
    const { boat: _boat, ...legacy } = saved;
    expect(parseOutfit(legacy)).toEqual(saved);
  });

  it.each(['default', 'wooden', 'inflatable', 'duck', 'banana', 'bathtub', 'pizza', 'snail', 'stadium'])('loads the %s boat without changing the outfit', boat => {
    expect(parseOutfit({ ...saved, boat, headwear: 'viking', chain: true }))
      .toEqual({ ...saved, boat, headwear: 'viking', chain: true });
  });

  it.each(['missing', 'toString', null, 4])('falls back for an unknown boat: %s', boat => {
    expect(parseOutfit({ ...saved, boat })?.boat).toBe('default');
  });
});
