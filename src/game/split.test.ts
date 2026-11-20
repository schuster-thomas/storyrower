import { describe, expect, it } from 'vitest';
import { parseSplit } from './SetupView';

describe('split input', () => {
  it('reads m:ss in the ways a tablet keypad allows', () => {
    expect(parseSplit('2:45')).toBe(165);
    expect(parseSplit('2.45')).toBe(165);
    expect(parseSplit('2,45')).toBe(165);
    expect(parseSplit('245')).toBe(165);
    expect(parseSplit(' 2:05 ')).toBe(125);
    expect(parseSplit('2.5')).toBe(170);
    expect(parseSplit('2')).toBe(120);
  });
  it('ignores what is not (yet) a sensible split', () => {
    for (const s of ['', '2:', '2:75', '275', '24', '0:30', '6:00', 'abc']) expect(parseSplit(s)).toBeNull();
  });
});
