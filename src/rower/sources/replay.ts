import { Emitter } from '../emitter';
import { parseRecording } from '../recording';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

/**
 * Spielt eine Aufzeichnung in (wählbar beschleunigter) Echtzeit ab.
 * Die Pakete behalten ihre Original-Zeitstempel – für die Session sieht das aus wie das echte Gerät.
 */
export class ReplaySource implements PacketSource {
  readonly info: { kind: 'replay'; label: string };
  private emitter = new Emitter<PacketSourceEvents>();
  private packets: RawPacket[];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _speed = 1;
  /** Wanduhr-Zeitpunkt, der dem Aufzeichnungs-Zeitpunkt `anchorT` entspricht */
  private anchorWall = 0;
  private anchorT = 0;

  constructor(json: unknown, label = 'Aufzeichnung') {
    const { device, packets } = parseRecording(json);
    this.packets = packets;
    this.info = { kind: 'replay', label: device ? `${label} (${device})` : label };
  }

  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]) { return this.emitter.on(event, fn); }

  get length() { return this.packets.length; }
  get durationMs() { return this.packets.length ? this.packets[this.packets.length - 1].t - this.packets[0].t : 0; }
  get positionMs() { return this.index < this.packets.length ? this.packets[this.index].t - (this.packets[0]?.t ?? 0) : this.durationMs; }
  get speed() { return this._speed; }

  set speed(v: number) {
    // Anker neu setzen, damit die Wiedergabe ohne Sprung schneller/langsamer wird
    if (this.timer != null) {
      const now = performance.now();
      this.anchorT += (now - this.anchorWall) * this._speed;
      this.anchorWall = now;
    }
    this._speed = v;
    if (this.timer != null) this.schedule();
  }

  async start() {
    if (this.index >= this.packets.length) this.index = 0;
    this.emitter.emit('log', `Wiedergabe: ${this.packets.length} Pakete, ${(this.durationMs / 60000).toFixed(1)} min`, 'info');
    this.emitter.emit('state', 'connected', this.info.label);
    this.anchorT = this.packets[this.index]?.t ?? 0;
    this.anchorWall = performance.now();
    this.schedule();
  }

  stop() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.emitter.emit('state', 'disconnected', 'Wiedergabe gestoppt');
  }

  private schedule() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    const next = this.packets[this.index];
    if (!next) {
      this.emitter.emit('log', 'Wiedergabe beendet', 'info');
      this.emitter.emit('state', 'disconnected', 'Wiedergabe beendet');
      return;
    }
    const due = this.anchorWall + (next.t - this.anchorT) / this._speed;
    this.timer = setTimeout(() => this.tick(), Math.max(0, due - performance.now()));
  }

  private tick() {
    const now = performance.now();
    // alle fälligen Pakete ausgeben (bei hoher Geschwindigkeit mehrere pro Timer)
    while (this.index < this.packets.length && this.anchorWall + (this.packets[this.index].t - this.anchorT) / this._speed <= now + 1) {
      this.emitter.emit('packet', this.packets[this.index++]);
    }
    this.schedule();
  }
}
