import { trace, type TraceKind } from '../btTrace';
import { Emitter } from '../emitter';
import { UUID, nameOf, toHex } from '../ftms';
import type { PacketSource, PacketSourceEvents } from '../types';
import { isWebBluetoothAvailable } from './bluetooth';

let instances = 0;

/**
 * Heart-rate monitor via the standard Heart Rate service (0x180D).
 * Works with chest straps (Polar, Garmin, Wahoo …) and watches that broadcast
 * heart rate, e.g. the Fitbit Charge 6 ("Heart rate on equipment").
 */
export class HeartRateSource implements PacketSource {
  readonly info = { kind: 'bluetooth' as const, label: 'Heart-rate monitor' };
  private emitter = new Emitter<PacketSourceEvents>();
  private device: BluetoothDevice | null = null;
  private manualStop = false;
  private t0: number | null = null;

  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]) { return this.emitter.on(event, fn); }

  get deviceName() { return this.device?.name ?? null; }

  private readonly tag = `hr${++instances}`;
  private lastAt: number | null = null;
  private count = 0;
  private tr(msg: string, kind: TraceKind = 'event') { trace(this.tag, msg, kind); }
  private setState(s: Parameters<PacketSourceEvents['state']>[0], detail?: string) {
    this.tr(`state → ${s}${detail ? ` (${detail})` : ''}`);
    this.emitter.emit('state', s, detail);
  }

  async start(): Promise<void> {
    this.tr(`start · device ${this.device ? `"${this.device.name ?? ''}" (known)` : 'not chosen yet'}`);
    if (!isWebBluetoothAvailable()) throw new Error('Web Bluetooth is not available in this browser');
    this.manualStop = false;
    let step = 'requestDevice';
    const began = performance.now();
    const ms = () => `${Math.round(performance.now() - began)} ms`;
    try {
      if (!this.device) {
        this.setState('connecting', 'choose a heart-rate monitor…');
        this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.HEART_RATE] }], optionalServices: [UUID.BATTERY] });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
        this.tr(`device chosen after ${ms()}: "${this.device.name ?? '(unnamed)'}" id ${this.device.id}`);
      }
      step = 'gatt.connect';
      this.setState('connecting', `connecting to ${this.device.name ?? 'monitor'}…`);
      const server = await this.device.gatt!.connect();
      this.t0 ??= performance.now();
      this.tr(`GATT connected after ${ms()}`);
      step = 'getPrimaryService(Heart Rate)';
      const svc = await server.getPrimaryService(UUID.HEART_RATE);
      step = 'getCharacteristic(Heart Rate Measurement)';
      const ch = await svc.getCharacteristic(UUID.HEART_RATE_MEASUREMENT);
      ch.addEventListener('characteristicvaluechanged', (ev) => {
        // the event's own characteristic carries the new value (Bluefy on iOS doesn't update ours)
        const v = (ev.target as BluetoothRemoteGATTCharacteristic | null)?.value ?? ch.value;
        const at = performance.now();
        if (this.count++ === 0) this.tr('first heart-rate notification');
        else if (this.lastAt != null && at - this.lastAt > 5000) this.tr(`heart rate again after a gap of ${((at - this.lastAt) / 1000).toFixed(1)} s`);
        this.lastAt = at;
        this.tr(`notify #${this.count} [${v ? toHex(v) : 'no value'}]`, 'notify');
        if (!v) return;
        const copy = new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
        this.emitter.emit('packet', { t: performance.now() - this.t0!, uuid: UUID.HEART_RATE_MEASUREMENT, data: copy, kind: 'notify' });
      });
      step = 'startNotifications';
      await ch.startNotifications();
      this.tr(`subscribed after ${ms()}`);
      this.emitter.emit('log', `${nameOf(UUID.HEART_RATE_MEASUREMENT)} subscribed (${this.device.name ?? 'monitor'})`, 'info');
      this.setState('connected', this.device.name ?? undefined);
    } catch (e) {
      const err = e as Error;
      this.tr(`FAILED in ${step} after ${ms()}: ${err?.name}: ${err?.message ?? String(e)}`);
      this.setState('error', `${err.name}: ${err.message}`);
      if (err.name === 'NotFoundError') {
        this.emitter.emit('log', 'No heart-rate monitor selected. On a Fitbit, start a workout and enable "Heart rate on equipment" first.', 'warn');
      } else this.emitter.emit('log', `Heart-rate monitor: ${err.name}: ${err.message}`, 'error');
      throw e;
    }
  }

  stop() {
    this.tr('stop() – disconnect requested by the app');
    this.manualStop = true;
    this.device?.gatt?.disconnect();
  }

  private onDisconnected = () => {
    const last = this.lastAt == null ? 'never' : `${((performance.now() - this.lastAt) / 1000).toFixed(1)} s ago`;
    this.tr(`gattserverdisconnected · ${this.manualStop ? 'requested by the app' : 'UNEXPECTED'} · last heart rate ${last} · notifications: ${this.count}`);
    if (!this.manualStop) this.emitter.emit('log', 'Connection to the heart-rate monitor lost', 'warn');
    this.setState('disconnected', this.manualStop ? 'disconnected' : 'connection lost');
  };
}
