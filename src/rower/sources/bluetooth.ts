import { Emitter } from '../emitter';
import { OPTIONAL_SERVICES, UUID, nameOf } from '../ftms';
import type { PacketSource, PacketSourceEvents, RawPacket } from '../types';

export interface CharacteristicDescription { uuid: string; name: string; properties: string[] }
export interface ServiceDescription { uuid: string; name: string; characteristics: CharacteristicDescription[] }

/** Characteristics, die automatisch abonniert werden. */
const AUTO_SUBSCRIBE: string[] = [UUID.ROWER_DATA, UUID.MACHINE_STATUS, UUID.TRAINING_STATUS, UUID.CONTROL_POINT, UUID.HEART_RATE_MEASUREMENT];
/** Services, deren lesbare Werte automatisch gelesen werden. */
const AUTO_READ_SERVICES: string[] = [UUID.DEVICE_INFO, UUID.BATTERY];

export const isWebBluetoothAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/**
 * Rudergerät über Web Bluetooth (Chrome/Edge auf Android, Windows, macOS, ChromeOS).
 * Zeitstempel laufen ab dem ersten Verbinden durch – auch über Neuverbindungen hinweg.
 */
export class BluetoothSource implements PacketSource {
  readonly info = { kind: 'bluetooth' as const, label: 'Bluetooth' };
  private emitter = new Emitter<PacketSourceEvents>();
  private device: BluetoothDevice | null = null;
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null;
  private t0: number | null = null;
  private manualStop = false;
  services: ServiceDescription[] = [];

  /** @param acceptAll true = alle Bluetooth-Geräte anbieten, nicht nur FTMS */
  constructor(private acceptAll = false) {}

  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]) { return this.emitter.on(event, fn); }

  get deviceName() { return this.device?.name ?? null; }
  get canSendControl() { return this.controlPoint != null; }

  private now() { return this.t0 == null ? 0 : performance.now() - this.t0; }

  private emitPacket(uuid: string, data: DataView, kind: RawPacket['kind']) {
    // DataView kopieren: Chrome kann den Puffer bei der nächsten Notification wiederverwenden
    const copy = new DataView(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    this.emitter.emit('packet', { t: this.now(), uuid, data: copy, kind });
  }

  private log(msg: string, level: 'info' | 'warn' | 'error' = 'info') { this.emitter.emit('log', msg, level); }

  /** Verbindet. Beim ersten Mal (oder nach forget()) öffnet Chrome die Geräteauswahl. */
  async start(): Promise<void> {
    if (!isWebBluetoothAvailable()) throw new Error('Web Bluetooth ist in diesem Browser nicht verfügbar');
    this.manualStop = false;
    try {
      if (!this.device) {
        this.emitter.emit('state', 'connecting', 'Gerät wählen…');
        this.device = await navigator.bluetooth.requestDevice(this.acceptAll
          ? { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES }
          : { filters: [{ services: [UUID.FTMS] }], optionalServices: OPTIONAL_SERVICES });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
        this.log(`Gerät gewählt: ${this.device.name ?? '(ohne Namen)'}`);
      }
      this.emitter.emit('state', 'connecting', `verbinde mit ${this.device.name ?? 'Gerät'}…`);
      const server = await this.device.gatt!.connect();
      if (this.t0 == null) this.t0 = performance.now();
      this.log('GATT verbunden');
      await this.setup(server);
      this.emitter.emit('state', 'connected', this.device.name ?? undefined);
    } catch (e) {
      const err = e as Error;
      this.emitter.emit('state', 'error', `${err.name}: ${err.message}`);
      if (err.name === 'NotFoundError') {
        this.log('Kein Gerät gewählt oder keins mit FTMS gefunden. Läuft noch e-Connected/Kinomap?', 'warn');
      } else this.log(`Verbindungsfehler: ${err.name}: ${err.message}`, 'error');
      throw e;
    }
  }

  stop() {
    this.manualStop = true;
    this.device?.gatt?.disconnect();
  }

  /** Gerät vergessen, beim nächsten start() erscheint wieder die Auswahl. */
  forget() {
    this.stop();
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = null;
  }

  async sendControl(bytes: number[]) {
    if (!this.controlPoint) throw new Error('Gerät hat keinen FTMS Control Point');
    const data = new Uint8Array(bytes);
    this.emitPacket(UUID.CONTROL_POINT, new DataView(data.buffer), 'write');
    await this.controlPoint.writeValueWithResponse(data);
  }

  private onDisconnected = () => {
    this.controlPoint = null;
    this.emitter.emit('state', 'disconnected', this.manualStop ? 'getrennt' : 'Verbindung verloren');
    if (!this.manualStop) this.log('Verbindung zum Gerät verloren', 'warn');
  };

  private async setup(server: BluetoothRemoteGATTServer) {
    const services = await server.getPrimaryServices();
    if (!services.some((s) => s.uuid === UUID.FTMS)) {
      this.log('Kein FTMS-Service gefunden – das Gerät nutzt vermutlich ein eigenes Protokoll.', 'error');
    }
    this.services = [];
    for (const svc of services) {
      const desc: ServiceDescription = { uuid: svc.uuid, name: nameOf(svc.uuid), characteristics: [] };
      this.services.push(desc);
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try { chars = await svc.getCharacteristics(); } catch (e) { this.log(`Characteristics von ${desc.name} nicht lesbar: ${(e as Error).message}`, 'warn'); }
      for (const ch of chars) {
        const p = ch.properties;
        desc.characteristics.push({
          uuid: ch.uuid, name: nameOf(ch.uuid),
          properties: Object.entries({ read: p.read, write: p.write, writeNR: p.writeWithoutResponse, notify: p.notify, indicate: p.indicate })
            .filter(([, v]) => v).map(([k]) => k),
        });
        if (ch.uuid === UUID.CONTROL_POINT) this.controlPoint = ch;
        if (p.read && (AUTO_READ_SERVICES.includes(svc.uuid) || ch.uuid === UUID.FEATURE)) {
          try { this.emitPacket(ch.uuid, await ch.readValue(), 'read'); }
          catch (e) { this.log(`Lesen von ${nameOf(ch.uuid)} fehlgeschlagen: ${(e as Error).message}`, 'warn'); }
        }
        if ((p.notify || p.indicate) && AUTO_SUBSCRIBE.includes(ch.uuid)) {
          ch.addEventListener('characteristicvaluechanged', () => { if (ch.value) this.emitPacket(ch.uuid, ch.value, 'notify'); });
          try { await ch.startNotifications(); this.log(`abonniert: ${nameOf(ch.uuid)}`); }
          catch (e) { this.log(`Abonnieren von ${nameOf(ch.uuid)} fehlgeschlagen: ${(e as Error).message}`, 'warn'); }
        }
      }
    }
  }
}
