import manifest from './sounds.json';

/** slot → file names in public/audio/ (written by scripts/audio/process.mjs) */
export type SoundManifest = Record<string, string[]>;

/**
 * Random variant without repeating the last one (repeats sound mechanical).
 * Returns an index in [0, n).
 */
export function pickVariant(n: number, last: number, rnd = Math.random()): number {
  if (n <= 1) return 0;
  if (last < 0 || last >= n) return Math.floor(rnd * n);
  const i = Math.floor(rnd * (n - 1));
  return i >= last ? i + 1 : i;
}

/**
 * Recorded sounds. Everything loads in the background; until a slot is decoded
 * `pick` returns null and the engine falls back to its synthesised sound.
 */
export class SampleBank {
  private buffers = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  readonly ready: Promise<void>;

  constructor(
    private ctx: BaseAudioContext,
    private files: SoundManifest = manifest as SoundManifest,
    private base = `${import.meta.env.BASE_URL}audio/`,
  ) {
    this.ready = this.load();
  }

  /** Slots load in manifest order (stroke and water first), files of a slot in parallel. */
  private async load() {
    for (const [slot, names] of Object.entries(this.files)) {
      const decoded = await Promise.all(names.map((n) => this.decode(n)));
      const ok = decoded.filter((b): b is AudioBuffer => b != null);
      if (ok.length) this.buffers.set(slot, ok);
    }
  }

  private async decode(name: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(this.base + name);
      if (!res.ok) throw new Error(`${res.status}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn(`sound ${name} not loaded`, e);
      return null;
    }
  }

  has(slot: string) { return this.buffers.has(slot); }

  pick(slot: string): AudioBuffer | null {
    const list = this.buffers.get(slot);
    if (!list) return null;
    const i = pickVariant(list.length, this.last.get(slot) ?? -1);
    this.last.set(slot, i);
    return list[i];
  }
}
