import { applySettingsSnapshot, onSettingsChanged, settingsSnapshot, type SettingsSnapshot } from '../app/settings';
import { parseTraining, type TrainingRecord } from '../history/history';
import { listTrainings, notifyHistoryChanged, putTraining, putTrainings, type StoredTraining } from '../history/store';
import { DRIVE_FOLDER, DRIVE_SCOPES, GOOGLE_CLIENT_ID } from './config';

/**
 * Google Drive sync: every training as one JSON file and the latest settings as settings.json in a
 * "StoryRower" folder of the user's Drive. Sign-in runs in the browser (Google Identity Services,
 * token model): an access token lasts about an hour and there is no refresh token, so when it has
 * run out the icon asks to sign in again (one tap, no consent screen the second time) and
 * everything that waited is uploaded then. Nothing is lost meanwhile – the history lives on this
 * device first.
 */

export type DriveState =
  | 'unconfigured'  // no client ID in the build
  | 'signed-out'
  | 'connecting'    // sign-in window open
  | 'syncing'
  | 'synced'
  | 'needs-login'   // signed in before, but the access token ran out
  | 'error';

export interface DriveStatus {
  state: DriveState;
  email: string | null;
  lastSync: string | null;
  /** trainings on this device that are not in Drive yet */
  pending: number;
  error: string | null;
}

interface Linked { email: string | null; folderId: string | null; lastSync: string | null }
interface Token { value: string; exp: number }

const LINK_KEY = 'storyrower.drive';
const TOKEN_KEY = 'storyrower.driveToken';
const API = 'https://www.googleapis.com';

class AuthError extends Error {}

// minimal typings of Google Identity Services (loaded at runtime)
interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void; requestAccessToken(o?: { prompt?: string; login_hint?: string }): void }
interface Gis { accounts: { oauth2: { initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void }): TokenClient; revoke(token: string, done?: () => void): void } } }
declare global { interface Window { google?: Gis } }

function read<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

let gisPromise: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(window.google); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in did not load')));
    s.onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not be loaded (offline?)')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

const fileName = (r: TrainingRecord) => {
  const d = new Date(r.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())} ${r.level.title}.json`;
};

class DriveSync {
  private linked: Linked | null = read<Linked>(LINK_KEY);
  private token: Token | null = read<Token>(TOKEN_KEY);
  private client: TokenClient | null = null;
  private listeners = new Set<(s: DriveStatus) => void>();
  private running: Promise<void> | null = null;
  private signing: Promise<void> | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  /** settings changed while the sign-in had run out – upload them with the next sync */
  private settingsDirty = false;
  /** a page asked for fresh data (the history: trainings from other devices) */
  private wantSync = false;
  private lastAuto = 0;
  private _status: DriveStatus;

  constructor() {
    this._status = { state: 'signed-out', email: this.linked?.email ?? null, lastSync: this.linked?.lastSync ?? null, pending: 0, error: null };
    this._status.state = this.baseState();
    onSettingsChanged(() => this.settingsChanged());
    // Renew a run-out sign-in on the next tap anywhere in the menus – browsers only allow the
    // Google window from a tap. Capture phase, so it runs before the tapped button's own handler.
    if (typeof document !== 'undefined') document.addEventListener('click', this.onTap, true);
  }

  get configured() { return GOOGLE_CLIENT_ID !== ''; }
  get status() { return this._status; }
  get signedIn() { return this.linked != null; }

  onChange(fn: (s: DriveStatus) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private set(p: Partial<DriveStatus>) {
    this._status = { ...this._status, ...p };
    this.listeners.forEach((fn) => fn(this._status));
  }

  private baseState(): DriveState {
    if (!this.configured) return 'unconfigured';
    if (!this.linked) return 'signed-out';
    return this.hasToken() ? 'synced' : 'needs-login';
  }

  private hasToken() { return this.token != null && this.token.exp > Date.now() + 60_000; }

  /**
   * Load Google's sign-in script and set up the token client early: the Google window may only be
   * opened right inside a tap, so by then everything has to be ready.
   */
  preload() {
    if (this.configured) loadGis().then((g) => this.initClient(g)).catch(() => {});
  }

  private initClient(gis: Gis) {
    this.client ??= gis.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPES, callback: () => {} });
    return this.client;
  }

  /** Start-up: count what waits, and sync if the last sign-in is still valid. */
  async init() {
    if (!this.configured) return;
    if (this.linked) this.preload();
    await this.refreshPending();
    if (this.linked && this.hasToken()) void this.sync();
    else this.set({ state: this.baseState() });
  }

  /**
   * From a tap ("Upload to Google Drive", "Sign in"): sign in or renew if needed, then sync.
   * The one call every button uses.
   */
  connect(): Promise<void> {
    if (!this.configured) return Promise.resolve();
    if (this.linked && this.hasToken()) return this.sync();
    return this.signIn();
  }

  /** A page wants fresh data (e.g. the history): sync now, or as soon as the sign-in is renewed. */
  requestSync() {
    if (!this.configured || !this.linked) return;
    if (this.hasToken()) void this.sync();
    else this.wantSync = true;
  }

  /** Something waits for Drive and the sign-in has run out: renew it on this tap (at most every 2 min). */
  private onTap = () => {
    if (!this.configured || !this.linked || this.hasToken() || this.signing || !this.client) return;
    if (!(this._status.pending > 0 || this.settingsDirty || this.wantSync)) return;
    if (document.querySelector('.game-canvas')) return;   // never in the middle of a workout
    if (Date.now() - this.lastAuto < 120_000) return;
    this.lastAuto = Date.now();
    void this.signIn();
  };

  /** Must run from a tap (the browser only allows the Google window then). */
  signIn(): Promise<void> {
    if (!this.configured) return Promise.resolve();
    this.signing ??= this.doSignIn().finally(() => { this.signing = null; });
    return this.signing;
  }

  private async doSignIn(): Promise<void> {
    this.set({ state: 'connecting', error: null });
    try {
      // signed in before: no consent screen again – Google just confirms the account, the window
      // closes by itself. requestAccessToken runs synchronously here when the client is ready.
      const ask = (client: TokenClient) => new Promise<TokenResponse>((resolve, reject) => {
        client.callback = (r) => (r.access_token ? resolve(r) : reject(new Error(r.error_description ?? r.error ?? 'sign-in failed')));
        client.error_callback = (e) => reject(new Error(
          e.type === 'popup_closed' ? 'The Google window was closed.'
            : e.type === 'popup_failed_to_open' ? 'The browser blocked the Google window – tap again.'
              : e.message ?? e.type ?? 'sign-in failed'));
        client.requestAccessToken(this.linked ? { prompt: '', login_hint: this.linked.email ?? undefined } : { prompt: 'consent' });
      });
      const resp = await (this.client ? ask(this.client) : loadGis().then((g) => ask(this.initClient(g))));
      this.token = { value: resp.access_token!, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 };
      write(TOKEN_KEY, this.token);
      const email = await this.fetchEmail().catch(() => this.linked?.email ?? null);
      this.linked = { email, folderId: this.linked?.folderId ?? null, lastSync: this.linked?.lastSync ?? null };
      write(LINK_KEY, this.linked);
      this.set({ email });
      await this.sync();
    } catch (e) {
      this.set({ state: this.baseState(), error: (e as Error).message });
    }
  }

  /** Forget the Google account on this device; the trainings stay here and in Drive. */
  signOut() {
    if (this.token) window.google?.accounts.oauth2.revoke(this.token.value);
    this.token = null; this.linked = null;
    write(TOKEN_KEY, null); write(LINK_KEY, null);
    this.set({ state: this.baseState(), email: null, lastSync: null, error: null });
  }

  /** A training was saved on this device: upload it now if possible. */
  async trainingSaved(): Promise<'uploaded' | 'waiting' | 'off'> {
    await this.refreshPending();
    if (!this.configured || !this.linked) return 'off';
    if (!this.hasToken()) { this.set({ state: 'needs-login' }); return 'waiting'; }
    await this.sync();
    return this._status.pending === 0 ? 'uploaded' : 'waiting';
  }

  /** Upload what is missing in Drive, download what is missing here, and settle the settings. */
  sync(): Promise<void> {
    this.running ??= this.doSync().finally(() => { this.running = null; });
    return this.running;
  }

  private async doSync() {
    if (!this.configured || !this.linked) return;
    if (!this.hasToken()) { this.set({ state: 'needs-login' }); return; }
    this.set({ state: 'syncing', error: null });
    try {
      const folder = await this.folder();
      const files = await this.listFolder(folder);
      const remote = new Map<string, string>();   // training id → file id
      let settingsFile: { id: string } | null = null;
      for (const f of files) {
        if (f.appProperties?.kind === 'training' && f.appProperties.trainingId) remote.set(f.appProperties.trainingId, f.id);
        if (f.appProperties?.kind === 'settings') settingsFile = f;
      }
      const local = await listTrainings();
      const localIds = new Set(local.map((r) => r.id));
      // up: trainings rowed here (or while signed out)
      for (const r of local) {
        const fileId = remote.get(r.id);
        if (fileId) { if (r.driveId !== fileId) await putTraining({ ...r, driveId: fileId }, false); continue; }
        const id = await this.upload({ name: fileName(r), parents: [folder], appProperties: { kind: 'training', trainingId: r.id } }, stripLocal(r));
        await putTraining({ ...r, driveId: id }, false);
      }
      // down: trainings from other devices
      const fetched: StoredTraining[] = [];
      for (const [tid, fid] of remote) {
        if (localIds.has(tid)) continue;
        const rec = parseTraining(await (await this.api(`/drive/v3/files/${fid}?alt=media`)).json());
        if (rec) fetched.push({ ...rec, driveId: fid });
      }
      await putTrainings(fetched);
      await this.syncSettings(folder, settingsFile);
      const now = new Date().toISOString();
      this.linked = { ...this.linked!, lastSync: now };
      write(LINK_KEY, this.linked);
      await this.refreshPending();
      this.settingsDirty = false;
      this.wantSync = false;
      notifyHistoryChanged();
      this.set({ state: 'synced', lastSync: now });
    } catch (e) {
      if (e instanceof AuthError) { this.token = null; write(TOKEN_KEY, null); this.set({ state: 'needs-login' }); return; }
      this.set({ state: 'error', error: (e as Error).message });
    }
  }

  private async syncSettings(folder: string, file: { id: string } | null) {
    const local = settingsSnapshot();
    if (!file) { await this.upload({ name: 'settings.json', parents: [folder], appProperties: { kind: 'settings' } }, local); return; }
    const remote = (await (await this.api(`/drive/v3/files/${file.id}?alt=media`)).json()) as SettingsSnapshot;
    if (remote?.updatedAt && remote.updatedAt > local.updatedAt) applySettingsSnapshot(remote);
    else if (!remote?.updatedAt || remote.updatedAt < local.updatedAt) await this.overwrite(file.id, local);
  }

  /** Settings changed on this device: upload them a moment later (typing in a field fires a lot). */
  private settingsChanged() {
    if (!this.configured || !this.linked) return;
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      if (this.hasToken()) void this.sync();
      else { this.settingsDirty = true; this.set({ state: 'needs-login' }); }
    }, 3000);
  }

  private async refreshPending() {
    const pending = (await listTrainings()).filter((r) => !r.driveId).length;
    if (pending !== this._status.pending) this.set({ pending });
  }

  // ---------- Drive REST ----------

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new AuthError('not signed in');
    const res = await fetch(path.startsWith('http') ? path : API + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token.value}` } });
    if (res.status === 401) throw new AuthError('token expired');
    if (!res.ok) throw new Error(`Google Drive: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return res;
  }

  private async fetchEmail(): Promise<string | null> {
    const r = await (await this.api('https://www.googleapis.com/oauth2/v3/userinfo')).json() as { email?: string };
    return r.email ?? null;
  }

  /** The StoryRower folder (only folders this app made are visible to it). */
  private async folder(): Promise<string> {
    const cached = this.linked?.folderId;
    if (cached) {
      const ok = await this.api(`/drive/v3/files/${cached}?fields=id,trashed`).then((r) => r.json()).then((f: { trashed?: boolean }) => !f.trashed).catch((e) => { if (e instanceof AuthError) throw e; return false; });
      if (ok) return cached;
    }
    const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = (await (await this.api(`/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()) as { files: { id: string }[] };
    let id = found.files[0]?.id;
    if (!id) {
      const res = await this.api('/drive/v3/files?fields=id', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      });
      id = ((await res.json()) as { id: string }).id;
    }
    this.linked = { ...this.linked!, folderId: id };
    write(LINK_KEY, this.linked);
    return id;
  }

  private async listFolder(folder: string) {
    const out: { id: string; appProperties?: Record<string, string> }[] = [];
    let page: string | undefined;
    do {
      const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
      const r = (await (await this.api(`/drive/v3/files?q=${q}&fields=nextPageToken,files(id,appProperties)&pageSize=1000${page ? `&pageToken=${page}` : ''}`)).json()) as { files: typeof out; nextPageToken?: string };
      out.push(...r.files);
      page = r.nextPageToken;
    } while (page);
    return out;
  }

  private async upload(meta: Record<string, unknown>, data: unknown): Promise<string> {
    const b = `storyrower${Math.random().toString(36).slice(2)}`;
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ mimeType: 'application/json', ...meta })}\r\n` +
      `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${b}--`;
    const res = await this.api('/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    return ((await res.json()) as { id: string }).id;
  }

  private async overwrite(fileId: string, data: unknown) {
    await this.api(`/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  }
}

/** The Drive copy has no device-local fields. */
function stripLocal(r: StoredTraining): TrainingRecord {
  const { driveId: _d, ...rest } = r;
  return rest;
}

export const drive = new DriveSync();
