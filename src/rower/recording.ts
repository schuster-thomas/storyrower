import { fromHex, toHex } from './ftms';
import type { RawPacket } from './types';

export interface RecordedPacket {
  t: number;
  uuid: string;
  kind: RawPacket['kind'];
  hex: string;
}

/** Something the app did, on the same timeline as the packets (e.g. a game section change). */
export interface RecordedEvent {
  t: number;
  /** wall-clock time (ISO) – helps matching with what you remember from the session */
  at: string;
  type: string;
  data?: unknown;
}

export interface Recording {
  app: 'storyrower';
  version: 2;
  recordedAt: string;
  device: string | null;
  source: string;
  userAgent: string;
  packets: RecordedPacket[];
  /** App/game events (optional, added in v2.1) */
  events?: RecordedEvent[];
}

export class Recorder {
  private packets: RecordedPacket[] = [];
  private events: RecordedEvent[] = [];
  private startedAt = new Date();
  private device: string | null = null;

  constructor(private source: string) {}

  setDevice(name: string | null) { this.device = name; }

  add(p: RawPacket) {
    this.packets.push({ t: Math.round(p.t), uuid: p.uuid, kind: p.kind, hex: toHex(p.data) });
  }

  addEvent(t: number, type: string, data?: unknown) {
    this.events.push({ t: Math.round(t), at: new Date().toISOString(), type, data });
  }

  get count() { return this.packets.length; }
  get eventCount() { return this.events.length; }

  clear() { this.packets = []; this.events = []; this.startedAt = new Date(); }

  toJSON(): Recording {
    return {
      app: 'storyrower', version: 2, recordedAt: this.startedAt.toISOString(), device: this.device,
      source: this.source, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node', packets: this.packets, events: this.events,
    };
  }

  fileName(): string {
    return `storyrower-${this.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  }
}

interface PocPacket { t: number; uuid?: string; hex?: string; parsed?: { read?: unknown; sent?: unknown } | null; event?: string }

/**
 * Reads recordings in the current format (v2) and in the PoC test page format (v1).
 * v1 files may contain timestamps that jump back (reconnect) – these are stitched
 * into one continuous timeline.
 */
export function parseRecording(json: unknown): { device: string | null; packets: RawPacket[] } {
  const d = json as { version?: number; device?: string | null; packets?: unknown[] };
  if (!d || !Array.isArray(d.packets)) throw new Error('Not a valid recording (packets missing)');

  const packets: RawPacket[] = [];
  let offset = 0, last = -Infinity;
  for (const raw of d.packets as (RecordedPacket & PocPacket)[]) {
    if (!raw.uuid || raw.hex == null) continue; // v1 event lines (e.g. "connected")
    let t = raw.t + offset;
    if (t < last) { offset += last - t + 1000; t = raw.t + offset; }
    last = t;
    const kind: RawPacket['kind'] = raw.kind ?? (raw.parsed?.read !== undefined ? 'read' : raw.parsed?.sent !== undefined ? 'write' : 'notify');
    packets.push({ t, uuid: raw.uuid, kind, data: fromHex(raw.hex) });
  }
  return { device: d.device ?? null, packets };
}
