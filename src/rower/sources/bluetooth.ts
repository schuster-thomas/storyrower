import { Emitter } from '../emitter';
import { OPTIONAL_SERVICES, UUID, nameOf, normUuid, toHex } from '../ftms';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

export interface CharacteristicDescription { uuid: string; name: string; properties: string[] }
export interface ServiceDescription { uuid: string; name: string; characteristics: CharacteristicDescription[] }

/** Characteristics that are subscribed automatically. */
const AUTO_SUBSCRIBE: string[] = [UUID.ROWER_DATA, UUID.MACHINE_STATUS, UUID.TRAINING_STATUS, UUID.CONTROL_POINT, UUID.HEART_RATE_MEASUREMENT];
/** Services whose readable values are read automatically. */
const AUTO_READ_SERVICES: string[] = [UUID.DEVICE_INFO, UUID.BATTERY];

/** Test switches for the diagnostics page (kept in localStorage, applied on the next connect). */
export interface BluetoothDebugOptions { onlyRowerData: boolean }
const DEBUG_KEY = 'storyrower.btdebug';
export function loadBtDebug(): BluetoothDebugOptions {
  try { return { onlyRowerData: false, ...JSON.parse(localStorage.getItem(DEBUG_KEY) ?? '{}') }; } catch { return { onlyRowerData: false }; }
}
export function saveBtDebug(o: BluetoothDebugOptions) { try { localStorage.setItem(DEBUG_KEY, JSON.stringify(o)); } catch { /* ignore */ } }

const hexOf = (v: DataView | null | undefined) => (v ? toHex(v) : '–');

export const isWebBluetoothAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/**
 * Rowing machine via Web Bluetooth (Chrome/Edge on Android, Windows, macOS, ChromeOS).
 * Timestamps run continuously from the first connection – including across reconnects.
 */
export class BluetoothSource implements PacketSource {
  readonly info = { kind: 'bluetooth' as const, label: 'Bluetooth' };
  private emitter = new Emitter<PacketSourceEvents>();
  private device: BluetoothDevice | null = null;
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null;
  private t0: number | null = null;
  private manualStop = false;
  services: ServiceDescription[] = [];
  /**
   * Low-level trace for the diagnostics page: every step of the connection and every raw
   * notification as the browser delivers it (which object fired, whether the value object is
   * reused, the bytes on the event's characteristic vs. on ours). Kept from the very start of the
   * connection, so nothing is lost before the page listens; the last 600 lines.
   */
  readonly trace: string[] = [];
  onTrace: ((line: string) => void) | null = null;
  private rowerChars: BluetoothRemoteGATTCharacteristic[] = [];

  private tr(msg: string) {
    const line = `${(this.now() / 1000).toFixed(2).padStart(8)}s  ${msg}`;
    this.trace.push(line);
    if (this.trace.length > 600) this.trace.shift();
    this.onTrace?.(line);
  }

  /** @param acceptAll true = offer all Bluetooth devices, not just FTMS */
  constructor(private acceptAll = false) {}

  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]) { return this.emitter.on(event, fn); }

  get deviceName() { return this.device?.name ?? null; }
  get canSendControl() { return this.controlPoint != null; }

  private now() { return this.t0 == null ? 0 : performance.now() - this.t0; }

  private emitPacket(uuid: string, data: DataView, kind: RawPacket['kind']) {
    // Copy the DataView: Chrome may reuse the buffer for the next notification
    const copy = new DataView(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    this.emitter.emit('packet', { t: this.now(), uuid, data: copy, kind });
  }

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info') { this.emitter.emit('log', msg, level); }

  /** Connects. The first time (or after forget()) Chrome opens the device picker. */
  async start(): Promise<void> {
    if (!isWebBluetoothAvailable()) throw new Error('Web Bluetooth is not available in this browser');
    this.manualStop = false;
    try {
      if (!this.device) {
        this.emitter.emit('state', 'connecting', 'choose a device…');
        this.device = await navigator.bluetooth.requestDevice(this.acceptAll
          ? { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES }
          : { filters: [{ services: [UUID.FTMS] }], optionalServices: OPTIONAL_SERVICES });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
        this.log(`Device selected: ${this.device.name ?? '(unnamed)'}`);
      }
      this.emitter.emit('state', 'connecting', `connecting to ${this.device.name ?? 'device'}…`);
      const server = await this.device.gatt!.connect();
      if (this.t0 == null) this.t0 = performance.now();
      this.log('GATT connected');
      this.tr(`GATT connected · device "${this.device.name ?? ''}" id ${this.device.id} · ${navigator.userAgent}`);
      await this.setup(server);
      this.emitter.emit('state', 'connected', this.device.name ?? undefined);
    } catch (e) {
      const err = e as Error;
      this.emitter.emit('state', 'error', `${err.name}: ${err.message}`);
      if (err.name === 'NotFoundError') {
        this.log('No device selected or none with FTMS found. Is e-Connected/Kinomap still running?', 'warn');
      } else this.log(`Connection error: ${err.name}: ${err.message}`, 'error');
      throw e;
    }
  }

  stop() {
    this.manualStop = true;
    this.device?.gatt?.disconnect();
  }

  /** Forget the device; the next start() shows the picker again. */
  forget() {
    this.stop();
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = null;
  }

  /** Test: stop and start the Rower Data notifications again. */
  async resubscribeRowerData() {
    const ch = this.rowerChars[0];
    if (!ch) { this.tr('re-subscribe: no Rower Data characteristic'); return; }
    try { await ch.stopNotifications(); this.tr('re-subscribe: stopped'); } catch (e) { this.tr(`re-subscribe: stop failed: ${(e as Error).message}`); }
    try { await ch.startNotifications(); this.tr('re-subscribe: started'); } catch (e) { this.tr(`re-subscribe: start failed: ${(e as Error).message}`); }
  }

  async sendControl(bytes: number[]) {
    if (!this.controlPoint) throw new Error('Device has no FTMS Control Point');
    const data = new Uint8Array(bytes);
    this.emitPacket(UUID.CONTROL_POINT, new DataView(data.buffer), 'write');
    await this.controlPoint.writeValueWithResponse(data);
  }

  private onDisconnected = () => {
    this.controlPoint = null;
    this.emitter.emit('state', 'disconnected', this.manualStop ? 'disconnected' : 'connection lost');
    if (!this.manualStop) this.log('Connection to the device lost', 'warn');
  };

  private async setup(server: BluetoothRemoteGATTServer) {
    const debug = loadBtDebug();
    if (debug.onlyRowerData) this.tr('test switch: subscribing to Rower Data only');
    const services = await server.getPrimaryServices();
    this.tr(`services: ${services.map((s) => s.uuid).join(', ')}`);
    // (normUuid: Bluefy on iOS reports short upper-case UUIDs – "1826", "2AD1")
    if (!services.some((s) => normUuid(s.uuid) === UUID.FTMS)) {
      this.log('No FTMS service found – the device probably uses a proprietary protocol.', 'error');
    }
    this.services = [];
    for (const svc of services) {
      const svcUuid = normUuid(svc.uuid);
      const desc: ServiceDescription = { uuid: svcUuid, name: nameOf(svcUuid), characteristics: [] };
      this.services.push(desc);
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try { chars = await svc.getCharacteristics(); } catch (e) { this.log(`Could not read characteristics of ${desc.name}: ${(e as Error).message}`, 'warn'); this.tr(`getCharacteristics(${svc.uuid}) failed: ${(e as Error).message}`); }
      for (const ch of chars) {
        const p = ch.properties;
        const chUuid = normUuid(ch.uuid);
        desc.characteristics.push({
          uuid: chUuid, name: nameOf(chUuid),
          properties: Object.entries({ read: p.read, write: p.write, writeNR: p.writeWithoutResponse, notify: p.notify, indicate: p.indicate })
            .filter(([, v]) => v).map(([k]) => k),
        });
        this.tr(`  char ${ch.uuid} (${nameOf(chUuid)}) in ${svc.uuid}: ${desc.characteristics[desc.characteristics.length - 1].properties.join(' ')}`);
        if (chUuid === UUID.CONTROL_POINT) this.controlPoint = ch;
        if (p.read && (AUTO_READ_SERVICES.includes(svcUuid) || chUuid === UUID.FEATURE)) {
          try { const v = await ch.readValue(); this.tr(`  read ${nameOf(chUuid)}: [${hexOf(v)}]`); this.emitPacket(chUuid, v, 'read'); }
          catch (e) { this.log(`Reading ${nameOf(chUuid)} failed: ${(e as Error).message}`, 'warn'); this.tr(`  read ${nameOf(chUuid)} failed: ${(e as Error).message}`); }
        }
        const wanted = debug.onlyRowerData ? [UUID.ROWER_DATA] : AUTO_SUBSCRIBE;
        if ((p.notify || p.indicate) && wanted.includes(chUuid)) {
          // read the value from the event's own characteristic: Bluefy (iOS) only updates that one –
          // the object we hold keeps its first value, so every packet looked the same
          let count = 0, lastView: DataView | null = null, lastT = 0;
          const onValue = (ev: Event) => {
            const target = ev.target as BluetoothRemoteGATTCharacteristic | null;
            const v = target?.value ?? ch.value;
            const t = this.now();
            this.tr(`notify ${nameOf(chUuid)} #${++count} +${Math.round(t - lastT)}ms · target ${target === ch ? 'ours' : target ? 'other object' : 'none'}` +
              ` · value object ${v === lastView ? 'SAME as before' : 'new'} · len ${v?.byteLength ?? '–'} off ${v?.byteOffset ?? '–'} buf ${v?.buffer.byteLength ?? '–'}` +
              ` · target [${hexOf(target?.value)}]${target !== ch ? ` · ours [${hexOf(ch.value)}]` : ''}`);
            lastView = v ?? null;
            lastT = t;
            if (v) this.emitPacket(chUuid, v, 'notify');
          };
          ch.addEventListener('characteristicvaluechanged', onValue);
          try {
            const returned = await ch.startNotifications();
            this.log(`subscribed: ${nameOf(chUuid)}`);
            this.tr(`  subscribed ${nameOf(chUuid)} · startNotifications() returned ${returned === ch ? 'the same object' : 'ANOTHER object'}`);
            // some browsers fire the events on the object startNotifications() returned – listen there too
            if (returned && returned !== ch) returned.addEventListener('characteristicvaluechanged', onValue);
            if (chUuid === UUID.ROWER_DATA) this.rowerChars = [ch, ...(returned && returned !== ch ? [returned] : [])];
          } catch (e) {
            this.log(`Subscribing to ${nameOf(chUuid)} failed: ${(e as Error).message}`, 'warn');
            this.tr(`  subscribing to ${nameOf(chUuid)} failed: ${(e as Error).name}: ${(e as Error).message}`);
          }
        }
      }
    }
  }
}
