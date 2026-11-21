import { ICELAND } from './iceland';
import { TOKYO } from './tokyo';
import type { Level } from './level';

/** Every playable level, in the order of the start page. */
export const LEVELS: Level[] = [ICELAND, TOKYO];

export function levelById(id: string | null | undefined): Level | null {
  return LEVELS.find((l) => l.id === id) ?? null;
}
