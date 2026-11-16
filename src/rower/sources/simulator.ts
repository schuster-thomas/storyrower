import { Emitter } from '../emitter';
import { UUID, encodeMachineStatus, encodeWoodrowerData, paceFromPower, uuid16 } from '../ftms';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

/** Deterministischer Zufall (Mulberry32), damit Tests reproduzierbar sind. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulatorOptions {
  /** Start-Zielleistung in W (0 = Pause). */
  power?: number;
  /** Optional: Zielleistung über die Zeit (s → W). Überschreibt `power`, solange gesetzt. */
  profile?: ((seconds: number) => number) | null;
  resistance?: number;
  seed?: number;
  /** Paketabstand in ms (Woodrower: ~250). */
  packetIntervalMs?: number;
}

/**
 * Simuliert einen Woodrower und erzeugt Pakete im exakt gleichen Format (Flags 0x0BAE, ~4 Hz,
 * doppelte Pakete, Watt einmal pro Schlag, Pause-Event nach Ruderstopp).
 * Steuerung über `targetPower` (z. B. per Tastatur) oder ein Leistungsprofil.
 */
export class SimulatorSource implements PacketSource {
  readonly info = { kind: 'simulator' as const, label: 'Simulator' };
  private emitter = new Emitter<PacketSourceEvents>();
  private random: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly interval: number;

  targetPower: number;
  profile: ((seconds: number) => number) | null;
  resistance: number;

  // Simulationszustand
  private t = 0;
  private strokeCount = 0;
  private distance = 0;
  private energy = 0;
  private elapsedMs = 0;
  private strokeRate = 0;
  private avgStrokeSum = 0;
  private power = 0;
  private nextStrokeAt: number | null = null;
  private powerUpdateAt: number | null = null;
  private lastStrokeAt: number | null = null;
  private pauseSent = true;

  constructor(opts: SimulatorOptions = {}) {
    this.targetPower = opts.power ?? 0;
    this.profile = opts.profile ?? null;
    this.resistance = opts.resistance ?? 6;
    this.random = rng(opts.seed ?? 42);
    this.interval = opts.packetIntervalMs ?? 250;
  }

  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]) { return this.emitter.on(event, fn); }

  get currentTarget() { return Math.max(0, this.profile ? this.profile(this.t / 1000) : this.targetPower); }

  async start() {
    this.emitter.emit('state', 'connected', 'Simulator');
    this.emitter.emit('log', 'Simulator gestartet (↑/↓ = Leistung, Leertaste = Pause)', 'info');
    this.emitInitialReads();
    this.timer ??= setInterval(() => this.step(this.interval), this.interval);
  }

  stop() {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
    this.emitter.emit('state', 'disconnected', 'Simulator gestoppt');
  }

  async sendControl(bytes: number[]) {
    this.packet(UUID.CONTROL_POINT, new DataView(new Uint8Array(bytes).buffer), 'write');
    this.packet(UUID.CONTROL_POINT, new DataView(new Uint8Array([0x80, bytes[0], 0x01]).buffer), 'notify');
  }

  private packet(uuid: string, data: DataView, kind: RawPacket['kind']) {
    this.emitter.emit('packet', { t: this.t, uuid, data, kind });
  }

  private emitInitialReads() {
    const text = (s: string) => new DataView(new TextEncoder().encode(s).buffer);
    this.packet(UUID.FEATURE, new DataView(new Uint8Array([0xa6, 0x56, 0, 0, 0x04, 0, 0, 0]).buffer), 'read');
    this.packet(uuid16(0x2a29), text('SIMULATOR'), 'read');
    this.packet(uuid16(0x2a24), text('Woodrower-Sim'), 'read');
    this.packet(UUID.TRAINING_STATUS, new DataView(new Uint8Array([0x01, 0x01]).buffer), 'notify');
  }

  /** Simulation um dt ms weiterschalten und ein Rower-Data-Paket senden. Öffentlich für Tests. */
  step(dt: number) {
    this.t += dt;
    const target = this.currentTarget;
    const rowing = target > 0;

    if (rowing) {
      if (this.pauseSent) {
        this.pauseSent = false;
        this.packet(UUID.MACHINE_STATUS, encodeMachineStatus({ kind: 'started' }), 'notify');
        this.packet(UUID.TRAINING_STATUS, new DataView(new Uint8Array([0x01, 0x0d]).buffer), 'notify');
      }
      // Schlagfrequenz steigt mit der Leistung (grob wie am echten Gerät: 55 W ≈ 23 spm, 100 W ≈ 28 spm)
      const spmTarget = Math.min(36, 17 + target / 9);
      this.nextStrokeAt ??= this.t + 300;
      if (this.t >= this.nextStrokeAt) {
        const jitter = 1 + (this.random() - 0.5) * 0.12;
        const intervalMs = (60000 / spmTarget) * jitter;
        if (this.lastStrokeAt != null) this.strokeRate = Math.round((60000 / (this.t - this.lastStrokeAt)) * 2) / 2;
        this.lastStrokeAt = this.t;
        this.strokeCount++;
        this.avgStrokeSum += this.strokeRate;
        this.nextStrokeAt = this.t + intervalMs;
        this.powerUpdateAt = this.t + this.interval; // Watt kommen ein Paket nach dem Schlag
      }
      if (this.powerUpdateAt != null && this.t >= this.powerUpdateAt) {
        this.power = Math.max(5, Math.round(target * (1 + (this.random() - 0.5) * 0.3)));
        this.powerUpdateAt = null;
      }
      if (this.power > 0) {
        this.distance += (500 / paceFromPower(this.power)) * (dt / 1000);
        this.energy += ((4 * this.power * 0.8604 + 300) / 3600) * (dt / 1000);
      }
      this.elapsedMs += dt;
    } else {
      this.nextStrokeAt = null;
      this.powerUpdateAt = null;
      // nach dem letzten Schlag fallen die Werte auf 0, ~5 s später kommt das Pause-Event
      if (this.lastStrokeAt != null && this.t - this.lastStrokeAt > 2500) { this.strokeRate = 0; this.power = 0; }
      if (!this.pauseSent && this.lastStrokeAt != null && this.t - this.lastStrokeAt > 6000) {
        this.pauseSent = true;
        this.packet(UUID.MACHINE_STATUS, encodeMachineStatus({ kind: 'stopped', by: 'pause' }), 'notify');
        this.packet(UUID.TRAINING_STATUS, new DataView(new Uint8Array([0x01, 0x01]).buffer), 'notify');
      }
    }

    const pace = this.power > 0 ? Math.round(paceFromPower(this.power)) : 0;
    this.packet(UUID.ROWER_DATA, encodeWoodrowerData({
      strokeRate: this.strokeRate,
      strokeCount: this.strokeCount,
      avgStrokeRate: this.strokeCount ? this.avgStrokeSum / this.strokeCount : 0,
      totalDistance: this.distance,
      pace,
      power: this.power,
      resistance: Math.round(this.resistance),
      totalEnergy: Math.floor(this.energy),
      energyPerHour: this.power > 0 ? 4 * this.power * 0.8604 + 300 : 0,
      energyPerMinute: this.power > 0 ? (4 * this.power * 0.8604 + 300) / 60 : 0,
      heartRate: 0,
      elapsedTime: Math.floor(this.elapsedMs / 1000),
    }), 'notify');
  }
}
