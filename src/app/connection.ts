import { trace } from '../rower/btTrace';
import { Emitter } from '../rower/emitter';
import { RowerSession } from '../rower/session';
import { BluetoothSource } from '../rower/sources/bluetooth';
import { HeartRateSource } from '../rower/sources/heartRate';
import type { ConnectionState, PacketSource } from '../rower/types';

export interface HeartRateStatus { state: ConnectionState; detail?: string; name: string | null }

/**
 * App-wide connection: one rower session and an optional heart-rate monitor, shared by
 * the setup screen, the game and the diagnostics view. Connecting once is enough –
 * switching screens keeps the Bluetooth connection alive.
 */
class Connection {
  private emitter = new Emitter<{ change: () => void }>();
  private _session: RowerSession | null = null;
  private hr: HeartRateSource | null = null;
  private detachHr: (() => void) | null = null;
  private _hrStatus: HeartRateStatus = { state: 'idle', name: null };

  get session() { return this._session; }
  get heartRate() { return this._hrStatus; }

  /** Fires when the session is replaced or the heart-rate monitor changes state. */
  onChange(fn: () => void) { return this.emitter.on('change', fn); }

  /** Replace the rower source. The old session is closed, a connected HR monitor moves over. */
  async use(source: PacketSource): Promise<RowerSession> {
    trace('app', `use source: ${source.info.label}${this._session ? ` (replaces ${this._session.source.info.label}, state ${this._session.state})` : ''}`);
    this.detachHr?.();
    this.detachHr = null;
    this._session?.dispose();
    const session = new RowerSession(source);
    this._session = session;
    if (this.hr && this._hrStatus.state === 'connected') this.detachHr = session.attach(this.hr);
    this.emitter.emit('change');
    try { await session.start(); } catch { /* reported via session events */ }
    return session;
  }

  close() {
    this.detachHr?.();
    this.detachHr = null;
    this._session?.dispose();
    this._session = null;
    this.emitter.emit('change');
  }

  async connectHeartRate(): Promise<void> {
    if (!this.hr) {
      this.hr = new HeartRateSource();
      this.hr.on('state', (state, detail) => {
        this._hrStatus = { state, detail, name: this.hr?.deviceName ?? null };
        if (state === 'connected' && this._session && !this.detachHr) this.detachHr = this._session.attach(this.hr!);
        if (state === 'disconnected' || state === 'error') { this.detachHr?.(); this.detachHr = null; }
        this.emitter.emit('change');
      });
    }
    try { await this.hr.start(); } catch { /* reported via state */ }
  }

  disconnectHeartRate() { trace('app', 'disconnect heart-rate monitor (button)'); this.hr?.stop(); }

  /** A Bluetooth rower that is connected or still connecting – the Connect buttons turn into Disconnect. */
  get rowerLink(): 'connected' | 'connecting' | null {
    const s = this._session;
    if (!s || !(s.source instanceof BluetoothSource)) return null;
    return s.state === 'connected' ? 'connected' : s.state === 'connecting' ? 'connecting' : null;
  }

  /** Whatever rows right now – rower, simulator or a replay – while it is connected or connecting. */
  get active(): { label: string; state: 'connected' | 'connecting' } | null {
    const s = this._session;
    if (!s || (s.state !== 'connected' && s.state !== 'connecting')) return null;
    const label = s.source instanceof BluetoothSource ? 'rower' : s.source.info.kind === 'simulator' ? 'simulator' : 'replay';
    return { label, state: s.state };
  }

  /**
   * Disconnect the rower, stop the simulator or a replay (also cancels a connect that hangs). The
   * session and its recording stay, so the diagnostics download still has everything; the next
   * Connect starts a new one.
   */
  disconnect() { trace('app', `disconnect ${this.active?.label ?? 'source'} (button)`); this._session?.stop(); }
  disconnectRower() { this.disconnect(); }
}

export const connection = new Connection();
