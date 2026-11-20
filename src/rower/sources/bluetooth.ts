import { trace, type TraceKind } from '../btTrace';
import { Emitter } from '../emitter';
import { OPTIONAL_SERVICES, UUID, nameOf, normUuid, toHex } from '../ftms';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

export interface CharacteristicDescription { uuid: string; name: string; properties: string[]; subscribed: boolean }
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

let instances = 0;
/** No Rower Data this long while connected → a line in the trace (the device sends ~4 per second). */
const GAP_MS = 3000;

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
  /** The live characteristic behind each entry in `services` (for the explorer on the diagnostics page). */
  private chars = new Map<CharacteristicDescription, BluetoothRemoteGATTCharacteristic>();
  /**
   * Low-level trace for the diagnostics download (see btTrace): every step of the connection,
   * every error and disconnect, and every raw notification as the browser delivers it (which
   * object fired, whether the value object is reused, the bytes on the event's characteristic vs.
   * on ours). Each line also carries `t`, the packet time, to match it with the recorded packets.
   */
  private readonly tag = `rower${++instances}`;
  private attempts = 0;
  private connectedAt: number | null = null;
  private notifyTotal = 0;
  private lastRowerAt: number | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private rowerChars: BluetoothRemoteGATTCharacteristic[] = [];

  private tr(msg: string, kind: TraceKind = 'event') {
    trace(this.tag, `t=${this.t0 == null ? '–' : `${(this.now() / 1000).toFixed(2)}s`}  ${msg}`, kind);
  }

  private setState(s: Parameters<PacketSourceEvents['state']>[0], detail?: string) {
    this.tr(`state → ${s}${detail ? ` (${detail})` : ''}`);
    this.emitter.emit('state', s, detail);
  }

  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

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

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (level !== 'info') this.tr(`${level}: ${msg}`);
    this.emitter.emit('log', msg, level);
  }

  /** Connects. The first time (or after forget()) Chrome opens the device picker. */
  async start(): Promise<void> {
    this.tr(`start · attempt ${++this.attempts} · ${this.acceptAll ? 'all devices' : 'FTMS filter'} · device ${this.device ? `"${this.device.name ?? ''}" (known)` : 'not chosen yet'}`);
    if (!isWebBluetoothAvailable()) { this.tr('navigator.bluetooth is missing'); throw new Error('Web Bluetooth is not available in this browser'); }
    this.manualStop = false;
    this.clearTimers();
    let step = 'requestDevice';
    const began = performance.now();
    const ms = () => `${Math.round(performance.now() - began)} ms`;
    try {
      if (!this.device) {
        this.setState('connecting', 'choose a device…');
        this.tr('requestDevice() – device picker open');
        this.device = await navigator.bluetooth.requestDevice(this.acceptAll
          ? { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES }
          : { filters: [{ services: [UUID.FTMS] }], optionalServices: OPTIONAL_SERVICES });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
        this.tr(`device chosen after ${ms()}: "${this.device.name ?? '(unnamed)'}" id ${this.device.id} · gatt ${this.device.gatt ? 'present' : 'MISSING'}`);
        this.log(`Device selected: ${this.device.name ?? '(unnamed)'}`);
      }
      step = 'gatt.connect';
      this.setState('connecting', `connecting to ${this.device.name ?? 'device'}…`);
      this.tr(`gatt.connect() · gatt.connected before: ${this.device.gatt?.connected ?? '–'}`);
      // a connect that never returns is a known failure mode – say so while it hangs
      for (const sec of [10, 30, 60]) this.timers.push(setTimeout(() => this.tr(`… still waiting in ${step} after ${sec} s`), sec * 1000));
      const server = await this.device.gatt!.connect();
      if (this.t0 == null) this.t0 = performance.now();
      this.connectedAt = performance.now();
      this.log('GATT connected');
      this.tr(`GATT connected after ${ms()} · server.connected ${server.connected}`);
      step = 'setup (services, characteristics, subscriptions)';
      await this.setup(server);
      this.clearTimers();
      const subscribed = this.services.flatMap((sv) => sv.characteristics).filter((c) => c.subscribed).map((c) => c.name);
      this.tr(`setup done after ${ms()} · subscribed: ${subscribed.join(', ') || 'NOTHING'}`);
      this.watchFirstData();
      this.setState('connected', this.device.name ?? undefined);
    } catch (e) {
      this.clearTimers();
      const err = e as Error;
      this.tr(`FAILED in ${step} after ${ms()}: ${err?.name ?? typeof e}: ${err?.message ?? String(e)} · gatt.connected ${this.device?.gatt?.connected ?? '–'}`);
      this.setState('error', `${err.name}: ${err.message}`);
      if (err.name === 'NotFoundError') {
        this.log('No device selected or none with FTMS found. Is e-Connected/Kinomap still running?', 'warn');
      } else this.log(`Connection error: ${err.name}: ${err.message}`, 'error');
      throw e;
    }
  }

  /** "Connected" but nothing arrives is the other typical failure – note it in the trace. */
  private watchFirstData() {
    const startedAt = performance.now();
    for (const sec of [5, 15]) {
      this.timers.push(setTimeout(() => {
        if ((this.lastRowerAt == null || this.lastRowerAt < startedAt) && this.device?.gatt?.connected) {
          this.tr(`no Rower Data ${sec} s after subscribing (notifications of any kind so far: ${this.notifyTotal}) – the rower may need a stroke, or the data is not reaching the browser`);
        }
      }, sec * 1000));
    }
  }

  stop() {
    this.tr('stop() – disconnect requested by the app');
    this.manualStop = true;
    this.clearTimers();
    this.device?.gatt?.disconnect();
  }

  /** Forget the device; the next start() shows the picker again. */
  forget() {
    this.tr('forget() – the next start shows the device picker');
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

  /** Explorer: read any characteristic once. The value arrives as a 'read' packet (log, device info, recording). */
  async read(c: CharacteristicDescription) {
    const ch = this.chars.get(c);
    if (ch) await this.readChar(ch, c.uuid);
  }

  /** Explorer: subscribe to any characteristic. Its values arrive as 'notify' packets (log, recording). */
  async subscribe(c: CharacteristicDescription) {
    const ch = this.chars.get(c);
    if (ch && !c.subscribed) await this.subscribeChar(ch, c);
  }

  async sendControl(bytes: number[]) {
    if (!this.controlPoint) throw new Error('Device has no FTMS Control Point');
    const data = new Uint8Array(bytes);
    this.emitPacket(UUID.CONTROL_POINT, new DataView(data.buffer), 'write');
    await this.controlPoint.writeValueWithResponse(data);
  }

  private onDisconnected = () => {
    this.clearTimers();
    const since = (at: number | null) => (at == null ? 'never' : `${((performance.now() - at) / 1000).toFixed(1)} s ago`);
    this.tr(`gattserverdisconnected · ${this.manualStop ? 'requested by the app' : 'UNEXPECTED'} · connected since ${since(this.connectedAt)}` +
      ` · last Rower Data ${since(this.lastRowerAt)} · notifications so far: ${this.notifyTotal}`);
    this.controlPoint = null;
    this.connectedAt = null;
    this.setState('disconnected', this.manualStop ? 'disconnected' : 'connection lost');
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
    this.chars.clear();
    for (const svc of services) {
      const svcUuid = normUuid(svc.uuid);
      const desc: ServiceDescription = { uuid: svcUuid, name: nameOf(svcUuid), characteristics: [] };
      this.services.push(desc);
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try { chars = await svc.getCharacteristics(); } catch (e) { this.log(`Could not read characteristics of ${desc.name}: ${(e as Error).message}`, 'warn'); this.tr(`getCharacteristics(${svc.uuid}) failed: ${(e as Error).message}`); }
      for (const ch of chars) {
        const p = ch.properties;
        const chUuid = normUuid(ch.uuid);
        const c: CharacteristicDescription = {
          uuid: chUuid, name: nameOf(chUuid), subscribed: false,
          properties: Object.entries({ read: p.read, write: p.write, writeNR: p.writeWithoutResponse, notify: p.notify, indicate: p.indicate })
            .filter(([, v]) => v).map(([k]) => k),
        };
        desc.characteristics.push(c);
        this.chars.set(c, ch);
        this.tr(`  char ${ch.uuid} (${nameOf(chUuid)}) in ${svc.uuid}: ${c.properties.join(' ')}`);
        if (chUuid === UUID.CONTROL_POINT) this.controlPoint = ch;
        if (p.read && (AUTO_READ_SERVICES.includes(svcUuid) || chUuid === UUID.FEATURE)) await this.readChar(ch, chUuid);
        const wanted = debug.onlyRowerData ? [UUID.ROWER_DATA] : AUTO_SUBSCRIBE;
        if ((p.notify || p.indicate) && wanted.includes(chUuid)) await this.subscribeChar(ch, c);
      }
    }
  }

  private async readChar(ch: BluetoothRemoteGATTCharacteristic, chUuid: string) {
    try { const v = await ch.readValue(); this.tr(`  read ${nameOf(chUuid)}: [${hexOf(v)}]`); this.emitPacket(chUuid, v, 'read'); }
    catch (e) { this.log(`Reading ${nameOf(chUuid)} failed: ${(e as Error).message}`, 'warn'); this.tr(`  read ${nameOf(chUuid)} failed: ${(e as Error).message}`); }
  }

  private async subscribeChar(ch: BluetoothRemoteGATTCharacteristic, c: CharacteristicDescription) {
    const chUuid = c.uuid;
    // read the value from the event's own characteristic: Bluefy (iOS) only updates that one –
    // the object we hold keeps its first value, so every packet looked the same
    let count = 0, lastView: DataView | null = null, lastT = 0;
    const onValue = (ev: Event) => {
      const target = ev.target as BluetoothRemoteGATTCharacteristic | null;
      const v = target?.value ?? ch.value;
      const t = this.now();
      this.notifyTotal++;
      if (count === 0) this.tr(`first notification of ${nameOf(chUuid)}`);
      if (chUuid === UUID.ROWER_DATA) {
        const at = performance.now();
        if (this.lastRowerAt != null && at - this.lastRowerAt > GAP_MS) this.tr(`Rower Data again after a gap of ${((at - this.lastRowerAt) / 1000).toFixed(1)} s`);
        this.lastRowerAt = at;
      }
      this.tr(`notify ${nameOf(chUuid)} #${++count} +${Math.round(t - lastT)}ms · target ${target === ch ? 'ours' : target ? 'other object' : 'none'}` +
        ` · value object ${v === lastView ? 'SAME as before' : 'new'} · len ${v?.byteLength ?? '–'} off ${v?.byteOffset ?? '–'} buf ${v?.buffer.byteLength ?? '–'}` +
        ` · target [${hexOf(target?.value)}]${target !== ch ? ` · ours [${hexOf(ch.value)}]` : ''}`, 'notify');
      lastView = v ?? null;
      lastT = t;
      if (v) this.emitPacket(chUuid, v, 'notify');
    };
    ch.addEventListener('characteristicvaluechanged', onValue);
    try {
      const returned = await ch.startNotifications();
      c.subscribed = true;
      this.log(`subscribed: ${nameOf(chUuid)}`);
      this.tr(`  subscribed ${nameOf(chUuid)} · startNotifications() returned ${returned === ch ? 'the same object' : 'ANOTHER object'}`);
      // some browsers fire the events on the object startNotifications() returned – listen there too
      if (returned && returned !== ch) returned.addEventListener('characteristicvaluechanged', onValue);
      if (chUuid === UUID.ROWER_DATA) this.rowerChars = [ch, ...(returned && returned !== ch ? [returned] : [])];
    } catch (e) {
      ch.removeEventListener('characteristicvaluechanged', onValue);
      this.log(`Subscribing to ${nameOf(chUuid)} failed: ${(e as Error).message}`, 'warn');
      this.tr(`  subscribing to ${nameOf(chUuid)} failed: ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
}
