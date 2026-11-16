import { fromHex, toHex } from './ftms';
import type { RawPacket } from './types';

export interface RecordedPacket {
  t: number;
  uuid: string;
  kind: RawPacket['kind'];
  hex: string;
}

export interface Recording {
  app: 'storyrower';
  version: 2;
  recordedAt: string;
  device: string | null;
  source: string;
  userAgent: string;
  packets: RecordedPacket[];
}

export class Recorder {
  private packets: RecordedPacket[] = [];
  private startedAt = new Date();
  private device: string | null = null;

  constructor(private source: string) {}

  setDevice(name: string | null) { this.device = name; }

  add(p: RawPacket) {
    this.packets.push({ t: Math.round(p.t), uuid: p.uuid, kind: p.kind, hex: toHex(p.data) });
  }

  get count() { return this.packets.length; }

  clear() { this.packets = []; this.startedAt = new Date(); }

  toJSON(): Recording {
    return {
      app: 'storyrower', version: 2, recordedAt: this.startedAt.toISOString(), device: this.device,
      source: this.source, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node', packets: this.packets,
    };
  }

  fileName(): string {
    return `storyrower-${this.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  }
}

interface PocPacket { t: number; uuid?: string; hex?: string; parsed?: { read?: unknown; sent?: unknown } | null; event?: string }

/**
 * Liest Aufzeichnungen im neuen Format (v2) und im Format der PoC-Testseite (v1).
 * v1-Dateien können zurückspringende Zeitstempel enthalten (Neuverbindung) – diese werden
 * zu einer fortlaufenden Zeitachse zusammengesetzt.
 */
export function parseRecording(json: unknown): { device: string | null; packets: RawPacket[] } {
  const d = json as { version?: number; device?: string | null; packets?: unknown[] };
  if (!d || !Array.isArray(d.packets)) throw new Error('Keine gültige Aufzeichnung (packets fehlt)');

  const packets: RawPacket[] = [];
  let offset = 0, last = -Infinity;
  for (const raw of d.packets as (RecordedPacket & PocPacket)[]) {
    if (!raw.uuid || raw.hex == null) continue; // v1-Ereigniszeilen (z. B. "connected")
    let t = raw.t + offset;
    if (t < last) { offset += last - t + 1000; t = raw.t + offset; }
    last = t;
    const kind: RawPacket['kind'] = raw.kind ?? (raw.parsed?.read !== undefined ? 'read' : raw.parsed?.sent !== undefined ? 'write' : 'notify');
    packets.push({ t, uuid: raw.uuid, kind, data: fromHex(raw.hex) });
  }
  return { device: d.device ?? null, packets };
}
