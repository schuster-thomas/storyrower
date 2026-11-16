import { Emitter } from '../emitter';
import { parseRecording } from '../recording';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

/**
 * Plays a recording back in (optionally accelerated) real time.
 * Packets keep their original timestamps – to the session it looks like the real device.
 */
export class ReplaySource implements PacketSource {
  readonly info: { kind: 'replay'; label: string };
  private emitter = new Emitter<PacketSourceEvents>();
  private packets: RawPacket[];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _speed = 1;
  /** Wall-clock time that corresponds to recording time `anchorT` */
  private anchorWall = 0;
  private anchorT = 0;

  constructor(json: unknown, label = 'Recording') {
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
    // Re-anchor so playback changes speed without jumping
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
    this.emitter.emit('log', `Replay: ${this.packets.length} packets, ${(this.durationMs / 60000).toFixed(1)} min`, 'info');
    this.emitter.emit('state', 'connected', this.info.label);
    this.anchorT = this.packets[this.index]?.t ?? 0;
    this.anchorWall = performance.now();
    this.schedule();
  }

  stop() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.emitter.emit('state', 'disconnected', 'replay stopped');
  }

  private schedule() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    const next = this.packets[this.index];
    if (!next) {
      this.emitter.emit('log', 'Replay finished', 'info');
      this.emitter.emit('state', 'disconnected', 'replay finished');
      return;
    }
    const due = this.anchorWall + (next.t - this.anchorT) / this._speed;
    this.timer = setTimeout(() => this.tick(), Math.max(0, due - performance.now()));
  }

  private tick() {
    const now = performance.now();
    // emit all due packets (several per timer at high speed)
    while (this.index < this.packets.length && this.anchorWall + (this.packets[this.index].t - this.anchorT) / this._speed <= now + 1) {
      this.emitter.emit('packet', this.packets[this.index++]);
    }
    this.schedule();
  }
}
