import { Emitter } from '../emitter';
import { UUID, nameOf } from '../ftms';
import type { PacketSource, PacketSourceEvents } from '../types';
import { isWebBluetoothAvailable } from './bluetooth';

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

  async start(): Promise<void> {
    if (!isWebBluetoothAvailable()) throw new Error('Web Bluetooth is not available in this browser');
    this.manualStop = false;
    try {
      if (!this.device) {
        this.emitter.emit('state', 'connecting', 'choose a heart-rate monitor…');
        this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.HEART_RATE] }], optionalServices: [UUID.BATTERY] });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      }
      this.emitter.emit('state', 'connecting', `connecting to ${this.device.name ?? 'monitor'}…`);
      const server = await this.device.gatt!.connect();
      this.t0 ??= performance.now();
      const svc = await server.getPrimaryService(UUID.HEART_RATE);
      const ch = await svc.getCharacteristic(UUID.HEART_RATE_MEASUREMENT);
      ch.addEventListener('characteristicvaluechanged', () => {
        const v = ch.value;
        if (!v) return;
        const copy = new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
        this.emitter.emit('packet', { t: performance.now() - this.t0!, uuid: UUID.HEART_RATE_MEASUREMENT, data: copy, kind: 'notify' });
      });
      await ch.startNotifications();
      this.emitter.emit('log', `${nameOf(UUID.HEART_RATE_MEASUREMENT)} subscribed (${this.device.name ?? 'monitor'})`, 'info');
      this.emitter.emit('state', 'connected', this.device.name ?? undefined);
    } catch (e) {
      const err = e as Error;
      this.emitter.emit('state', 'error', `${err.name}: ${err.message}`);
      if (err.name === 'NotFoundError') {
        this.emitter.emit('log', 'No heart-rate monitor selected. On a Fitbit, start a workout and enable "Heart rate on equipment" first.', 'warn');
      } else this.emitter.emit('log', `Heart-rate monitor: ${err.name}: ${err.message}`, 'error');
      throw e;
    }
  }

  stop() {
    this.manualStop = true;
    this.device?.gatt?.disconnect();
  }

  private onDisconnected = () => {
    this.emitter.emit('state', 'disconnected', this.manualStop ? 'disconnected' : 'connection lost');
  };
}
