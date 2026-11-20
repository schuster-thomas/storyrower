import { trace } from './btTrace';
import { Emitter } from './emitter';
import {
  UUID, nameOf, parseControlPointResponse, parseFeature, parseHeartRate, parseMachineStatus,
  parseRowerData, parseTrainingStatus, paceFromPower, toHex, describeMachineStatus, type RowerData,
} from './ftms';
import { Recorder } from './recording';
import type { ConnectionState, PacketSource, RawPacket, RowerEvent, RowerSample } from './types';

export interface SessionOptions {
  /** Number of recent strokes the smoothed watts/pace are the median of. */
  smoothingStrokes?: number;
  /** No stroke for this long → paused, even if the device sends no pause event (ms). */
  idleTimeoutMs?: number;
}

/**
 * Turns raw FTMS packets from any source into the events the game and the
 * diagnostics view need. Records every packet.
 */
export class RowerSession {
  readonly recorder: Recorder;
  private emitter = new Emitter<{ event: (e: RowerEvent) => void }>();
  private unsub: (() => void)[] = [];
  private lastRowerHex: string | null = null;
  private dupStreak = 0;
  private data: RowerData = { flags: 0 };
  private heartRateMonitor: number | null = null;
  private lastStrokeT: number | null = null;
  private lastStrokeCount: number | null = null;
  /** Watts of the last few strokes, newest last (the console reports one value per stroke). */
  private strokePowers: number[] = [];
  private lastPower = 0;
  /** Whether the console reported new watts since the last stroke-counter step. */
  private powerReported = true;
  /** A stroke far above the current level, waiting for the next stroke to confirm it. */
  private pendingSpike: number | null = null;
  private rowing = false;
  private lastT = 0;
  private deviceInfo: Record<string, unknown> = {};
  private _state: ConnectionState = 'idle';
  private _sample: RowerSample | null = null;
  private readonly smoothingStrokes: number;
  private readonly idleTimeoutMs: number;

  constructor(readonly source: PacketSource, opts: SessionOptions = {}) {
    this.smoothingStrokes = Math.max(1, opts.smoothingStrokes ?? 3);
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

  /**
   * Attach a secondary source, e.g. a heart-rate monitor. Its packets are put on this
   * session's timeline (they get the time of the latest main packet) and recorded too.
   * Returns a function that detaches it again.
   */
  attach(source: PacketSource): () => void {
    const offs = [
      source.on('packet', (p) => this.handlePacket({ ...p, t: this.lastT })),
      source.on('log', (msg, level) => this.emit({ type: 'log', t: this.lastT, msg, level })),
    ];
    return () => {
      offs.forEach((o) => o());
      this.heartRateMonitor = null;
      if (this._sample) this.emitSample(this.lastT);
    };
  }

  /** Record an app/game event on the session timeline (ends up in the downloaded recording). */
  logEvent(type: string, data?: unknown) { this.recorder.addEvent(this.lastT, type, data); }

  async sendControl(bytes: number[]) {
    if (!this.source.sendControl) throw new Error('This source cannot send commands');
    await this.source.sendControl(bytes);
  }

  private emit(e: RowerEvent) { this.emitter.emit('event', e); }

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    trace('session', `t=${(this.lastT / 1000).toFixed(2)}s  ${level}: ${msg}`);
    this.emit({ type: 'log', t: this.lastT, msg, level });
  }

  /** Public for tests and replay: process a single packet. */
  handlePacket(p: RawPacket) {
    this.lastT = p.t;
    this.recorder.add(p);

    if (p.kind === 'read') return this.handleRead(p);
    if (p.kind === 'write') { this.emit({ type: 'raw', packet: p, decoded: 'sent', duplicate: false }); return; }

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
        this.heartRateMonitor = parseHeartRate(p.data);
        this.emit({ type: 'raw', packet: p, decoded: this.heartRateMonitor, duplicate: false });
        if (this._sample) this.emitSample(p.t);
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
    this.dupStreak = duplicate ? this.dupStreak + 1 : 0;
    // the device sends ~4 packets/s; 40 identical ones while the stroke rate isn't 0 means the values
    // are stuck somewhere on the way (seen with Bluefy on iOS) – say so in the log
    if (this.dupStreak === 40 && (this.data.strokeRate ?? 0) > 0) {
      this.log('The rower\'s values have not changed for ~10 s although the stroke rate is not 0 – the browser may be delivering stale data.', 'warn');
    }
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

    // Watts arrive ~1.5 s after the stroke counter steps, once per stroke
    const power = this.data.power ?? 0;
    if (power !== this.lastPower) {
      if (power > 0) this.pushStrokePower(power);
      this.lastPower = power;
      this.powerReported = true;
    }

    // Detect strokes
    const count = this.data.strokeCount;
    if (count != null) {
      if (this.lastStrokeCount != null && count > this.lastStrokeCount) {
        // No new watts since the previous stroke → that stroke had exactly the same value
        if (!this.powerReported && power > 0 && this.strokePowers.length) this.pushStrokePower(power);
        this.powerReported = false;
        const n = count - this.lastStrokeCount;
        for (let i = 1; i <= n; i++) {
          const interval = this.lastStrokeT != null ? p.t - this.lastStrokeT : null;
          this.emit({ type: 'stroke', t: p.t, count: this.lastStrokeCount + i, intervalMs: i === 1 ? interval : 0 });
        }
        this.lastStrokeT = p.t;
        this.setRowing(true, p.t);
      } else if (this.lastStrokeCount != null && count < this.lastStrokeCount) {
        this.log(`Stroke counter reset (${this.lastStrokeCount} → ${count})`, 'warn');
        this.lastStrokeT = null;
      }
      this.lastStrokeCount = count;
    }

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
    if (!on) { this.strokePowers = []; this.pendingSpike = null; }
    this.emit({ type: on ? 'resumed' : 'paused', t });
  }

  /**
   * The Woodrower reports a single stroke at about twice the real watts every 20–30 strokes
   * (sometimes two of them, one stroke apart). A stroke well above the current level is held
   * back and only counted if the next stroke is high as well – then it was a real sprint.
   */
  private pushStrokePower(power: number) {
    const ref = this.strokePowers.length ? this.smoothedPower() : 0;
    if (this.pendingSpike != null) {
      const confirmed = power > ref * 1.3;
      if (confirmed) this.addStrokePower(this.pendingSpike);
      this.pendingSpike = null;
      this.addStrokePower(power);
      return;
    }
    if (ref > 0 && power > ref * 1.4) { this.pendingSpike = power; return; }
    this.addStrokePower(power);
  }

  private addStrokePower(power: number) {
    this.strokePowers.push(power);
    if (this.strokePowers.length > this.smoothingStrokes) this.strokePowers.shift();
  }

  /** Median of the last few strokes: a real change of pace shows up after two strokes. */
  private smoothedPower(): number {
    const v = [...this.strokePowers].sort((a, b) => a - b);
    const n = v.length;
    if (n === 0) return 0;
    return n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }

  private emitSample(t: number) {
    const d = this.data;
    const powerSmoothed = this.rowing ? this.smoothedPower() : 0;
    // A separate monitor wins over a strap paired with the console
    const hr = this.heartRateMonitor ?? (d.heartRate ? d.heartRate : null);
    const heartRateSource = this.heartRateMonitor != null ? 'monitor' : d.heartRate ? 'console' : null;
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
      heartRateSource,
      elapsedTime: d.elapsedTime ?? null,
      rowing: this.rowing,
    };
    this._sample = sample;
    this.emit({ type: 'sample', sample });
  }
}
