import { Emitter } from './emitter';
import {
  UUID, nameOf, parseControlPointResponse, parseFeature, parseHeartRate, parseMachineStatus,
  parseRowerData, parseTrainingStatus, paceFromPower, toHex, describeMachineStatus, type RowerData,
} from './ftms';
import { Recorder } from './recording';
import type { ConnectionState, PacketSource, RawPacket, RowerEvent, RowerSample } from './types';

export interface SessionOptions {
  /** Zeitfenster für geglättete Watt/Pace (ms). */
  smoothingWindowMs?: number;
  /** Ohne Schlag so lange → Pause, auch wenn das Gerät kein Pause-Event schickt (ms). */
  idleTimeoutMs?: number;
}

/**
 * Macht aus rohen FTMS-Paketen einer beliebigen Quelle die Events, die Spiel und
 * Diagnose-Ansicht brauchen. Zeichnet alle Pakete auf.
 */
export class RowerSession {
  readonly recorder: Recorder;
  private emitter = new Emitter<{ event: (e: RowerEvent) => void }>();
  private unsub: (() => void)[] = [];
  private lastRowerHex: string | null = null;
  private data: RowerData = { flags: 0 };
  private heartRateStrap: number | null = null;
  private lastStrokeT: number | null = null;
  private lastStrokeCount: number | null = null;
  private powerHistory: { t: number; power: number }[] = [];
  private rowing = false;
  private lastT = 0;
  private deviceInfo: Record<string, unknown> = {};
  private _state: ConnectionState = 'idle';
  private _sample: RowerSample | null = null;
  private readonly smoothingWindowMs: number;
  private readonly idleTimeoutMs: number;

  constructor(readonly source: PacketSource, opts: SessionOptions = {}) {
    this.smoothingWindowMs = opts.smoothingWindowMs ?? 6000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 4000;
    this.recorder = new Recorder(source.info.kind);
    this.unsub.push(
      source.on('packet', (p) => this.handlePacket(p)),
      source.on('state', (s, detail) => { this._state = s; this.emit({ type: 'state', state: s, detail }); }),
      source.on('log', (msg, level) => this.emit({ type: 'log', t: this.lastT, msg, level })),
    );
  }

  get state() { return this._state; }
  get sample() { return this._sample; }
  get isRowing() { return this.rowing; }
  get info() { return { ...this.deviceInfo }; }

  on(fn: (e: RowerEvent) => void): () => void { return this.emitter.on('event', fn); }

  start() { return this.source.start(); }

  stop() { this.source.stop(); }

  dispose() { this.stop(); this.unsub.forEach((u) => u()); this.unsub = []; }

  async sendControl(bytes: number[]) {
    if (!this.source.sendControl) throw new Error('Diese Quelle kann keine Befehle senden');
    await this.source.sendControl(bytes);
  }

  private emit(e: RowerEvent) { this.emitter.emit('event', e); }

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info') { this.emit({ type: 'log', t: this.lastT, msg, level }); }

  /** Öffentlich für Tests und Wiedergabe: ein einzelnes Paket verarbeiten. */
  handlePacket(p: RawPacket) {
    this.lastT = p.t;
    this.recorder.add(p);

    if (p.kind === 'read') return this.handleRead(p);
    if (p.kind === 'write') { this.emit({ type: 'raw', packet: p, decoded: 'gesendet', duplicate: false }); return; }

    switch (p.uuid) {
      case UUID.ROWER_DATA: return this.handleRowerData(p);
      case UUID.MACHINE_STATUS: {
        const s = parseMachineStatus(p.data);
        this.emit({ type: 'raw', packet: p, decoded: describeMachineStatus(s), duplicate: false });
        if (s.kind === 'stopped') this.setRowing(false, p.t);
        if (s.kind === 'resistance') this.emit({ type: 'resistance', t: p.t, level: s.level });
        return;
      }
      case UUID.TRAINING_STATUS: {
        const status = parseTrainingStatus(p.data);
        this.emit({ type: 'raw', packet: p, decoded: status, duplicate: false });
        this.emit({ type: 'trainingStatus', t: p.t, status });
        return;
      }
      case UUID.HEART_RATE_MEASUREMENT: {
        this.heartRateStrap = parseHeartRate(p.data);
        this.emit({ type: 'raw', packet: p, decoded: this.heartRateStrap, duplicate: false });
        return;
      }
      case UUID.CONTROL_POINT: {
        const r = parseControlPointResponse(p.data);
        this.emit({ type: 'raw', packet: p, decoded: r, duplicate: false });
        this.log(`Control Point: ${r}`);
        return;
      }
      default:
        this.emit({ type: 'raw', packet: p, decoded: null, duplicate: false });
    }
  }

  private handleRead(p: RawPacket) {
    let value: unknown = toHex(p.data);
    const bytes = new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength);
    if (p.uuid === UUID.FEATURE) value = parseFeature(p.data);
    else if (p.uuid === UUID.BATTERY_LEVEL) value = `${bytes[0]} %`;
    else if (bytes.length && bytes.every((c) => (c >= 32 && c < 127) || c === 10 || c === 13)) {
      value = new TextDecoder().decode(bytes).replace(/\r\n/g, ' | ');
    }
    this.deviceInfo[nameOf(p.uuid)] = value;
    this.emit({ type: 'raw', packet: p, decoded: value, duplicate: false });
    this.emit({ type: 'deviceInfo', info: this.info });
  }

  private handleRowerData(p: RawPacket) {
    const hex = toHex(p.data);
    const duplicate = hex === this.lastRowerHex;
    this.lastRowerHex = hex;
    if (duplicate) {
      this.emit({ type: 'raw', packet: p, decoded: null, duplicate: true });
      this.checkIdle(p.t);
      return;
    }

    const parsed = parseRowerData(p.data);
    this.emit({ type: 'raw', packet: p, decoded: parsed, duplicate: false });
    if (parsed.error) { this.log(parsed.error, 'error'); return; }
    if (parsed.warning) this.log(parsed.warning, 'warn');
    const { flags: _flags, error: _e, warning: _w, ...values } = parsed;
    Object.assign(this.data, values);

    // Schläge erkennen
    const count = this.data.strokeCount;
    if (count != null) {
      if (this.lastStrokeCount != null && count > this.lastStrokeCount) {
        const n = count - this.lastStrokeCount;
        for (let i = 1; i <= n; i++) {
          const interval = this.lastStrokeT != null ? p.t - this.lastStrokeT : null;
          this.emit({ type: 'stroke', t: p.t, count: this.lastStrokeCount + i, intervalMs: i === 1 ? interval : 0 });
        }
        this.lastStrokeT = p.t;
        this.setRowing(true, p.t);
      } else if (this.lastStrokeCount != null && count < this.lastStrokeCount) {
        this.log(`Schlagzähler zurückgesetzt (${this.lastStrokeCount} → ${count})`, 'warn');
        this.lastStrokeT = null;
      }
      this.lastStrokeCount = count;
    }

    this.pushPower(p.t, this.data.power ?? 0);
    this.checkIdle(p.t);
    this.emitSample(p.t);
  }

  private checkIdle(t: number) {
    if (!this.rowing) return;
    const since = this.lastStrokeT == null ? Infinity : t - this.lastStrokeT;
    if (since > this.idleTimeoutMs && (this.data.strokeRate ?? 0) === 0) {
      this.setRowing(false, t);
      this.emitSample(t);
    }
  }

  private setRowing(on: boolean, t: number) {
    if (on === this.rowing) return;
    this.rowing = on;
    this.emit({ type: on ? 'resumed' : 'paused', t });
  }

  private pushPower(t: number, power: number) {
    this.powerHistory.push({ t, power });
    const cutoff = t - this.smoothingWindowMs;
    // ein Element vor dem Fenster behalten – es gilt bis zum nächsten Messpunkt
    while (this.powerHistory.length > 2 && this.powerHistory[1].t <= cutoff) this.powerHistory.shift();
  }

  /** Zeitgewichtetes Mittel der (stückweise konstanten) Leistung im Fenster. */
  private smoothedPower(t: number): number {
    const h = this.powerHistory;
    if (h.length === 0) return 0;
    const start = Math.max(t - this.smoothingWindowMs, h[0].t);
    if (t <= start) return h[h.length - 1].power;
    let sum = 0;
    for (let i = 0; i < h.length; i++) {
      const a = Math.max(h[i].t, start);
      const b = i + 1 < h.length ? h[i + 1].t : t;
      if (b > a) sum += h[i].power * (b - a);
    }
    return sum / (t - start);
  }

  private emitSample(t: number) {
    const d = this.data;
    const powerSmoothed = this.rowing ? this.smoothedPower(t) : 0;
    const hr = this.heartRateStrap ?? (d.heartRate ? d.heartRate : null);
    const sample: RowerSample = {
      t,
      strokeRate: d.strokeRate ?? 0,
      strokeCount: d.strokeCount ?? 0,
      distance: d.totalDistance ?? 0,
      pace: d.pace ? d.pace : null,
      power: d.power ?? 0,
      powerSmoothed,
      paceSmoothed: powerSmoothed > 0 ? paceFromPower(powerSmoothed) : null,
      avgStrokeRate: d.avgStrokeRate ?? null,
      resistance: d.resistance ?? null,
      energy: d.totalEnergy ?? null,
      heartRate: hr,
      elapsedTime: d.elapsedTime ?? null,
      rowing: this.rowing,
    };
    this._sample = sample;
    this.emit({ type: 'sample', sample });
  }
}
