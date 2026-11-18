import { describe, expect, it } from 'vitest';
import { UUID, nameOf, normUuid } from './ftms';

describe('Bluetooth UUIDs', () => {
  it('turns the short upper-case form (Bluefy on iOS) into the full form (Chrome)', () => {
    expect(normUuid('1826')).toBe(UUID.FTMS);
    expect(normUuid('2AD1')).toBe(UUID.ROWER_DATA);
    expect(normUuid('0x180A')).toBe(UUID.DEVICE_INFO);
    expect(normUuid('00002AD1')).toBe(UUID.ROWER_DATA);
    expect(normUuid(UUID.ROWER_DATA.toUpperCase())).toBe(UUID.ROWER_DATA);
  });

  it('leaves full and vendor UUIDs as they are (lower case)', () => {
    expect(normUuid(UUID.FTMS)).toBe(UUID.FTMS);
    expect(normUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBe('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
  });

  it('names characteristics in either form', () => {
    expect(nameOf('2AD1')).toBe(nameOf(UUID.ROWER_DATA));
  });
});
