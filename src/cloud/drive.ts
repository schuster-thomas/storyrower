import { applySettingsSnapshot, onSettingsChanged, settingsSnapshot, type SettingsSnapshot } from '../app/settings';
import { parseTraining, type TrainingRecord } from '../history/history';
import { listTrainings, notifyHistoryChanged, putTraining, putTrainings, type StoredTraining } from '../history/store';
import { applyCustomFile, customFile, mergeCustomFiles, onCustomEdited, parseCustomFile, sameCustomFiles } from '../workout/customStore';
import { DRIVE_FOLDER, DRIVE_SCOPES, GOOGLE_CLIENT_ID, TOKEN_SERVICE } from './config';

/**
 * Google Drive sync: every training as one JSON file, the custom trainings together in
 * custom-trainings.json and the latest settings as settings.json in a
 * "StoryRower" folder of the user's Drive. An access token lasts about an hour.
 *
 * With the token service (TOKEN_SERVICE): the page goes to Google once (same tab), comes back with
 * a code, and the service swaps it for an access token plus a refresh token. The app then renews
 * the access token by itself – signed in for good, no window, which also suits Bluefy.
 *
 * Without it: Google Identity Services, token model – a Google window, or in Bluefy the page itself
 * goes to Google and back. There is no refresh token, so when the token has run out the icon asks
 * to sign in again (one tap, no consent screen the second time) and everything that waited is
 * uploaded then. Nothing is lost meanwhile – the history lives on this device first.
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
const REFRESH_KEY = 'storyrower.driveRefresh';
/** '1' = sign in by leaving for Google in this tab (set after a blocked window, or by hand to test) */
const REDIRECT_MODE_KEY = 'storyrower.driveRedirect';
/** the sign-in that left for Google: its state value and the page to come back to */
const PENDING_KEY = 'storyrower.driveRedirectPending';
const API = 'https://www.googleapis.com';

/**
 * Bluefy (the iPad browser with Web Bluetooth) opens Google's window as a separate tab that cannot
 * report back – the sign-in goes round in circles. There the sign-in leaves this tab for Google
 * and comes back with the token in the address instead. Bluefy often reports a desktop Mac user
 * agent: an Apple touch device with Web Bluetooth is Bluefy (or one like it – Safari has none).
 */
function useRedirect(): boolean {
  // with the token service the sign-in happens once per device – always in this tab
  if (TOKEN_SERVICE !== '' || localStorage.getItem(REDIRECT_MODE_KEY) === '1') return true;
  const ua = navigator.userAgent;
  if (/Bluefy/i.test(ua)) return true;
  const appleTouch = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return appleTouch && 'bluetooth' in navigator;
}

/** Must match an "Authorised redirect URI" of the OAuth client exactly (with the trailing slash). */
const redirectUri = () => location.origin + import.meta.env.BASE_URL;

class AuthError extends Error {}

// minimal typings of Google Identity Services (loaded at runtime)
interface TokenResponse { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string }
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
  /** keeps this device signed in (token service only) */
  private refresh: string | null = read<string>(REFRESH_KEY);
  private renewing: Promise<boolean> | null = null;
  /** why the last renewal failed when it was not the sign-in itself (offline) */
  private renewError: string | null = null;
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
  /** what the redirect sign-in brought back (taken from the address before the router ran) */
  private returned: { resp?: TokenResponse; code?: string; error?: string } | null = null;
  private _status: DriveStatus;

  constructor() {
    this._status = { state: 'signed-out', email: this.linked?.email ?? null, lastSync: this.linked?.lastSync ?? null, pending: 0, error: null };
    this._status.state = this.baseState();
    onSettingsChanged(() => this.settingsChanged());
    // custom trainings go up the same way (one file, a moment after the last edit)
    onCustomEdited(() => this.settingsChanged());
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
    return this.usable() ? 'synced' : 'needs-login';
  }

  private hasToken() { return this.token != null && this.token.exp > Date.now() + 60_000; }
  /** a valid access token, or one the app can get by itself */
  private usable() { return this.hasToken() || (TOKEN_SERVICE !== '' && this.refresh != null); }

  /** An access token for the next Drive call – renewed through the token service if it ran out. */
  private ensureToken(): Promise<boolean> {
    if (this.hasToken()) return Promise.resolve(true);
    if (!this.usable()) return Promise.resolve(false);
    this.renewing ??= this.renew().finally(() => { this.renewing = null; });
    return this.renewing;
  }

  private async renew(): Promise<boolean> {
    try {
      this.keep(await this.service('refresh', { refresh_token: this.refresh }));
      return true;
    } catch (e) {
      // revoked or run out at Google: sign in again; otherwise (offline) try again later
      if (e instanceof AuthError) { this.refresh = null; write(REFRESH_KEY, null); }
      else this.renewError = (e as Error).message;
      return false;
    }
  }

  private async service(path: 'token' | 'refresh', body: Record<string, unknown>): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await fetch(`${TOKEN_SERVICE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Error('Google Drive could not be reached (offline?) – it tries again later.'); }
    const r = (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.ok && r.access_token) return r;
    if (r.error === 'invalid_grant') throw new AuthError('The Google sign-in has run out – please sign in again.');
    throw new Error(`Google sign-in: ${r.error_description ?? r.error ?? res.status}`);
  }

  /** Remember a fresh access token (and a refresh token, when Google sent one). */
  private keep(resp: TokenResponse) {
    this.token = { value: resp.access_token!, exp: Date.now() + (resp.expires_in ?? 3600) * 1000 };
    write(TOKEN_KEY, this.token);
    if (resp.refresh_token) { this.refresh = resp.refresh_token; write(REFRESH_KEY, this.refresh); }
    this.renewError = null;
  }

  /**
   * Load Google's sign-in script and set up the token client early: the Google window may only be
   * opened right inside a tap, so by then everything has to be ready.
   */
  preload() {
    if (this.configured && !useRedirect()) loadGis().then((g) => this.initClient(g)).catch(() => {});
  }

  private initClient(gis: Gis) {
    this.client ??= gis.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPES, callback: () => {} });
    return this.client;
  }

  /** Start-up: count what waits, and sync if the last sign-in is still valid. */
  async init() {
    if (!this.configured) return;
    const back = this.returned;
    this.returned = null;
    if (back?.resp || back?.code) {
      this.set({ state: 'connecting', error: null });
      await this.refreshPending();
      try {
        // the code is worth something only once, and only together with the secret in the service
        const resp = back.resp ?? await this.service('token', { code: back.code, redirect_uri: redirectUri() });
        await this.signedInWith(resp);
      } catch (e) { this.set({ state: this.baseState(), error: (e as Error).message }); }
      return;
    }
    if (back?.error) this.set({ error: back.error });
    if (this.linked) this.preload();
    await this.refreshPending();
    if (this.linked && this.usable()) void this.sync();
    else this.set({ state: this.baseState() });
  }

  /**
   * From a tap ("Upload to Google Drive", "Sign in"): sign in or renew if needed, then sync.
   * The one call every button uses.
   */
  connect(): Promise<void> {
    if (!this.configured) return Promise.resolve();
    if (this.linked && this.usable()) return this.sync();
    return this.signIn();
  }

  /** A page wants fresh data (e.g. the history): sync now, or as soon as the sign-in is renewed. */
  requestSync() {
    if (!this.configured || !this.linked) return;
    if (this.usable()) void this.sync();
    else this.wantSync = true;
  }

  /** Something waits for Drive and the sign-in has run out: renew it on this tap (at most every 2 min). */
  private onTap = () => {
    // (not with the redirect sign-in: a tap on anything would leave the page for Google)
    if (!this.configured || !this.linked || this.hasToken() || this.signing || !this.client || useRedirect()) return;
    if (!(this._status.pending > 0 || this.settingsDirty || this.wantSync)) return;
    if (document.querySelector('.game-canvas')) return;   // never in the middle of a workout
    if (Date.now() - this.lastAuto < 120_000) return;
    this.lastAuto = Date.now();
    void this.signIn();
  };

  /** Must run from a tap (the browser only allows the Google window then). */
  signIn(): Promise<void> {
    if (!this.configured) return Promise.resolve();
    if (useRedirect()) { this.leaveForGoogle(); return Promise.resolve(); }
    this.signing ??= this.doSignIn().finally(() => { this.signing = null; });
    return this.signing;
  }

  /**
   * Redirect sign-in: this page goes to Google and comes back – with "?code=…" for the token
   * service, otherwise with "#access_token=…".
   */
  private leaveForGoogle() {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    write(PENDING_KEY, { state, hash: location.hash, at: Date.now() });
    const viaService = TOKEN_SERVICE !== '';
    const q = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: viaService ? 'code' : 'token',
      scope: DRIVE_SCOPES,
      include_granted_scopes: 'true',
      state,
    });
    if (this.linked?.email) q.set('login_hint', this.linked.email);
    // A refresh token comes only with the consent screen. Without the service, someone signed in
    // before gets no consent screen again – Google just confirms the account.
    if (viaService) { q.set('access_type', 'offline'); q.set('prompt', 'consent'); }
    else if (!this.linked) q.set('prompt', 'consent');
    this.set({ state: 'connecting', error: null });
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  /**
   * Back from Google (redirect sign-in): take the token out of the address and put the page that
   * was open back in its place. Runs before the router looks at the address.
   */
  takeRedirectResult() {
    // token: "#access_token=…&state=…"; code (token service): "?state=…&code=…" before the hash
    const inHash = /^#(.*&)?(access_token|error)=/.test(location.hash);
    const inQuery = /[?&](code|error)=/.test(location.search) && /[?&]state=/.test(location.search);
    if (!inHash && !inQuery) return;
    const p = new URLSearchParams(inHash ? location.hash.slice(1) : location.search);
    const pending = read<{ state: string; hash: string; at: number }>(PENDING_KEY);
    write(PENDING_KEY, null);
    history.replaceState(null, '', location.pathname + (inHash ? location.search : '') + (pending?.hash ?? (inHash ? '' : location.hash)));
    if (!pending || p.get('state') !== pending.state) { this.returned = { error: 'The Google sign-in could not be matched – please try again.' }; return; }
    const token = p.get('access_token');
    const code = p.get('code');
    if (token) this.returned = { resp: { access_token: token, expires_in: Number(p.get('expires_in')) || 3600 } };
    else if (code) this.returned = { code };
    else {
      const err = p.get('error');
      this.returned = { error: err === 'access_denied' ? 'The Google sign-in was cancelled.' : `Google sign-in: ${p.get('error_description') ?? err}` };
    }
  }
  private async doSignIn(): Promise<void> {
    this.set({ state: 'connecting', error: null });
    try {
      // signed in before: no consent screen again – Google just confirms the account, the window
      // closes by itself. requestAccessToken runs synchronously here when the client is ready.
      const ask = (client: TokenClient) => new Promise<TokenResponse>((resolve, reject) => {
        client.callback = (r) => (r.access_token ? resolve(r) : reject(new Error(r.error_description ?? r.error ?? 'sign-in failed')));
        client.error_callback = (e) => {
          // the window cannot open here: sign in within this tab from the next tap on
          if (e.type === 'popup_failed_to_open') localStorage.setItem(REDIRECT_MODE_KEY, '1');
          reject(new Error(
            e.type === 'popup_closed' ? 'The Google window was closed.'
              : e.type === 'popup_failed_to_open' ? 'The browser blocked the Google window – tap again, the sign-in then opens in this tab.'
                : e.message ?? e.type ?? 'sign-in failed'));
        };
        client.requestAccessToken(this.linked ? { prompt: '', login_hint: this.linked.email ?? undefined } : { prompt: 'consent' });
      });
      const resp = await (this.client ? ask(this.client) : loadGis().then((g) => ask(this.initClient(g))));
      await this.signedInWith(resp);
    } catch (e) {
      this.set({ state: this.baseState(), error: (e as Error).message });
    }
  }

  /** A token arrived (window or redirect): remember it and the account, then sync. */
  private async signedInWith(resp: TokenResponse) {
    this.keep(resp);
    const email = await this.fetchEmail().catch(() => this.linked?.email ?? null);
    this.linked = { email, folderId: this.linked?.folderId ?? null, lastSync: this.linked?.lastSync ?? null };
    write(LINK_KEY, this.linked);
    this.set({ email });
    await this.sync();
  }

  /** Forget the Google account on this device; the trainings stay here and in Drive. */
  signOut() {
    // revoking the refresh token ends the whole grant (this device's access tokens with it)
    const revoke = this.refresh ?? this.token?.value;
    if (revoke) {
      if (window.google && !this.refresh) window.google.accounts.oauth2.revoke(revoke);
      else void fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ token: revoke }) }).catch(() => {});
    }
    this.token = null; this.linked = null; this.refresh = null;
    write(TOKEN_KEY, null); write(LINK_KEY, null); write(REFRESH_KEY, null);
    this.set({ state: this.baseState(), email: null, lastSync: null, error: null });
  }

  /** A training was saved on this device: upload it now if possible. */
  async trainingSaved(): Promise<'uploaded' | 'waiting' | 'off'> {
    await this.refreshPending();
    if (!this.configured || !this.linked) return 'off';
    if (!this.usable()) { this.set({ state: 'needs-login' }); return 'waiting'; }
    await this.sync();
    return this._status.pending === 0 ? 'uploaded' : 'waiting';
  }

  /** Upload what is missing in Drive, download what is missing here, and settle the settings. */
  sync(): Promise<void> {
    this.running ??= this.doSync().finally(() => { this.running = null; });
    return this.running;
  }

  private async doSync(retried = false): Promise<void> {
    if (!this.configured || !this.linked) return;
    if (!(await this.ensureToken())) {
      // offline with a valid refresh token: not a sign-in problem, it just has to wait
      this.set(this.usable() ? { state: 'error', error: this.renewError } : { state: 'needs-login' });
      return;
    }
    this.set({ state: 'syncing', error: null });
    try {
      const folder = await this.folder();
      const files = await this.listFolder(folder);
      const remote = new Map<string, string>();   // training id → file id
      let settingsFile: { id: string } | null = null;
      let customFileRef: { id: string } | null = null;
      for (const f of files) {
        if (f.appProperties?.kind === 'training' && f.appProperties.trainingId) remote.set(f.appProperties.trainingId, f.id);
        if (f.appProperties?.kind === 'settings') settingsFile = f;
        if (f.appProperties?.kind === 'custom-trainings') customFileRef = f;
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
      await this.syncCustom(folder, customFileRef);
      const now = new Date().toISOString();
      this.linked = { ...this.linked!, lastSync: now };
      write(LINK_KEY, this.linked);
      await this.refreshPending();
      this.settingsDirty = false;
      this.wantSync = false;
      notifyHistoryChanged();
      this.set({ state: 'synced', lastSync: now });
    } catch (e) {
      if (e instanceof AuthError) {
        this.token = null; write(TOKEN_KEY, null);
        // Google turned the token down early: renew it once through the service and carry on
        if (!retried && this.usable()) return this.doSync(true);
        // even a fresh token is turned down: the next tap has to lead to a new sign-in
        this.refresh = null; write(REFRESH_KEY, null);
        this.set({ state: 'needs-login' });
        return;
      }
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

  /** All custom trainings in one file: merged training by training with the copy here (newer wins). */
  private async syncCustom(folder: string, file: { id: string } | null) {
    const local = customFile();
    if (!file) {
      if (local.trainings.length) await this.upload({ name: 'custom-trainings.json', parents: [folder], appProperties: { kind: 'custom-trainings' } }, local);
      return;
    }
    const remote = parseCustomFile(await (await this.api(`/drive/v3/files/${file.id}?alt=media`)).json()) ?? { v: 1, trainings: [] };
    const merged = mergeCustomFiles(local, remote);
    if (!sameCustomFiles(merged, local)) applyCustomFile(merged);
    if (!sameCustomFiles(merged, remote)) await this.overwrite(file.id, merged);
  }

  /** Settings changed on this device: upload them a moment later (typing in a field fires a lot). */
  private settingsChanged() {
    if (!this.configured || !this.linked) return;
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      if (this.usable()) void this.sync();
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
