import { CONTROL, formatDuration, formatPace, nameOf } from '../rower/ftms';
import { RowerSession } from '../rower/session';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { ReplaySource } from '../rower/sources/replay';
import { SimulatorSource } from '../rower/sources/simulator';
import type { RowerEvent, RowerSample } from '../rower/types';
import { PowerChart } from './PowerChart';
import tenMinUrl from '../../poc/ble/recordings/woodrower-2026-11-16-19-13-47-10min.json?url';
import shortUrl from '../../poc/ble/recordings/woodrower-2026-11-16-18-56-39.json?url';

const BUILTIN_RECORDINGS = [
  { label: 'Woodrower 10 min Intervalle (16.11.)', url: tenMinUrl },
  { label: 'Woodrower Kurztest (16.11.)', url: shortUrl },
];

const html = String.raw;

/**
 * „Gerät & Diagnose“: Quelle wählen, Live-Werte, Rohdaten, Aufzeichnung.
 * Hängt am selben RowerSession-Datenweg wie das Spiel.
 */
export function mountDiagnostics(root: HTMLElement): () => void {
  root.innerHTML = html`
    <header class="topbar">
      <h1><a href="#/">StoryRower ‹</a> Gerät &amp; Diagnose</h1>
      <span class="pill" data-id="state">keine Quelle</span>
    </header>
    <main class="page">
      <div class="notice" data-id="noBt" hidden>
        Dieser Browser kann kein Web Bluetooth. Bitte <b>Chrome</b> oder Edge verwenden (Android, Windows, macOS).
        Auf dem iPad geht es erst mit der späteren App. Simulator und Aufzeichnungen funktionieren trotzdem.
      </div>

      <section class="panel">
        <h2>Quelle</h2>
        <div class="row">
          <button class="primary" data-id="btBtn">Rudergerät verbinden</button>
          <button data-id="btAllBtn" title="Alle Bluetooth-Geräte anzeigen, nicht nur FTMS">Alle Geräte…</button>
          <button data-id="simBtn">Simulator</button>
          <select data-id="recSelect" aria-label="Aufzeichnung abspielen">
            <option value="">Aufzeichnung abspielen…</option>
            ${BUILTIN_RECORDINGS.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}
            <option value="file">Datei vom Gerät laden…</option>
          </select>
          <input type="file" data-id="file" accept="application/json,.json">
          <button data-id="stopBtn" disabled>Stoppen</button>
          <button data-id="reconnectBtn" hidden>Neu verbinden</button>
        </div>
        <div class="row" data-id="simControls" hidden style="margin-top:12px">
          <span class="muted">Zielleistung</span>
          <button data-id="simMinus">−10</button>
          <input type="range" min="0" max="250" step="5" data-id="simRange">
          <button data-id="simPlus">+10</button>
          <b data-id="simValue" style="min-width:70px"></b>
          <button data-id="simPause">Pause</button>
          <span class="muted">Tastatur: <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Leertaste</kbd></span>
        </div>
        <div class="row" data-id="replayControls" hidden style="margin-top:12px">
          <span class="muted">Tempo</span>
          ${[1, 4, 16, 64].map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}
          <span class="muted" data-id="replayPos"></span>
        </div>
      </section>

      <div class="tiles">
        <div class="tile" data-tile="spm"><div class="label">Schlagfrequenz</div><span class="value">–</span><span class="unit">spm</span><div class="sub"></div></div>
        <div class="tile" data-tile="power"><div class="label">Leistung</div><span class="value">–</span><span class="unit">W</span><div class="sub"></div></div>
        <div class="tile" data-tile="pace"><div class="label">Pace</div><span class="value">–</span><span class="unit">/500 m</span><div class="sub"></div></div>
        <div class="tile" data-tile="dist"><div class="label">Distanz</div><span class="value">–</span><span class="unit">m</span><div class="sub"></div></div>
        <div class="tile" data-tile="strokes"><div class="label">Schläge</div><span class="value">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="time"><div class="label">Zeit (Gerät)</div><span class="value">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="hr"><div class="label">Puls</div><span class="value">–</span><span class="unit">bpm</span><div class="sub"></div></div>
        <div class="tile" data-tile="status"><div class="label">Status</div><span class="value" style="font-size:28px">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="rate"><div class="label">Datenrate</div><span class="value">–</span><span class="unit">Hz</span><div class="sub"></div></div>
      </div>

      <section class="panel">
        <h2>Leistung – letzte 2 Minuten</h2>
        <canvas class="chart" data-id="chart"></canvas>
        <div class="legend">
          <span><i style="background:var(--raw)"></i>Rohwert</span>
          <span><i style="background:var(--accent)"></i>geglättet (wie im Spiel)</span>
          <span><i style="background:var(--muted);width:2px;height:10px"></i>Schlag</span>
        </div>
      </section>

      <div class="grid2">
        <section class="panel">
          <h2>Aufzeichnung</h2>
          <p class="muted" style="margin:0 0 10px">Läuft automatisch mit, solange eine Quelle aktiv ist: <b data-id="recCount">0</b> Pakete.</p>
          <div class="row">
            <button data-id="downloadBtn">Herunterladen</button>
            <button data-id="clearBtn">Protokoll leeren</button>
          </div>
          <h2 style="margin-top:16px">Gerätesteuerung (FTMS Control Point)</h2>
          <div class="row">
            <button data-id="cpRequest" disabled>Control anfordern</button>
            <button data-id="cpStart" disabled>Start</button>
            <button data-id="cpStop" disabled>Stop</button>
          </div>
          <h2 style="margin-top:16px">Gerät</h2>
          <pre class="kv" data-id="info">–</pre>
        </section>
        <section class="panel">
          <h2>Services &amp; Characteristics</h2>
          <div data-id="services" class="muted">Nur bei Bluetooth-Verbindung.</div>
        </section>
      </div>

      <section class="panel">
        <h2>Protokoll</h2>
        <div class="row" style="margin-bottom:8px">
          <label class="muted"><input type="checkbox" data-id="showDup"> doppelte Pakete anzeigen</label>
        </div>
        <div class="log" data-id="log"></div>
      </section>
    </main>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
  const tile = (name: string) => root.querySelector<HTMLElement>(`[data-tile="${name}"]`)!;
  const setTile = (name: string, value: string | number | null | undefined, sub?: string) => {
    const t = tile(name);
    t.querySelector('.value')!.textContent = value == null || value === '' ? '–' : String(value);
    if (sub !== undefined) t.querySelector('.sub')!.textContent = sub;
  };

  if (!isWebBluetoothAvailable()) {
    $('noBt').hidden = false;
    ($('btBtn') as HTMLButtonElement).disabled = true;
    ($('btAllBtn') as HTMLButtonElement).disabled = true;
  }

  const chart = new PowerChart($<HTMLCanvasElement>('chart'));
  let session: RowerSession | null = null;
  let unsubscribe: (() => void) | null = null;
  let packetTimes: number[] = [];
  let changeTimes: number[] = [];
  let wakeLock: WakeLockSentinel | null = null;
  let replayTimer: ReturnType<typeof setInterval> | null = null;
  const logEl = $('log');

  // ---------- Protokoll ----------
  function log(t: number, msg: string, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `${(t / 1000).toFixed(2).padStart(8)}s  ${msg}`;
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
    logEl.appendChild(line);
    while (logEl.childElementCount > 600) logEl.firstChild!.remove();
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------- Quelle wechseln ----------
  async function useSource(s: RowerSession['source']) {
    endSession();
    chart.clear();
    packetTimes = []; changeTimes = [];
    session = new RowerSession(s);
    unsubscribe = session.on(onEvent);
    $('simControls').hidden = !(s instanceof SimulatorSource);
    $('replayControls').hidden = !(s instanceof ReplaySource);
    if (s instanceof SimulatorSource) syncSimUi();
    if (s instanceof ReplaySource) {
      setSpeed(1);
      replayTimer = setInterval(() => {
        $('replayPos').textContent = `${formatDuration(s.positionMs / 1000)} / ${formatDuration(s.durationMs / 1000)}`;
      }, 500);
    }
    ($('stopBtn') as HTMLButtonElement).disabled = false;
    try { await session.start(); } catch { /* Fehler stehen schon im Protokoll */ }
  }

  function endSession() {
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
    unsubscribe?.();
    session?.dispose();
    session = null;
  }

  // ---------- Events der Session ----------
  function onEvent(e: RowerEvent) {
    switch (e.type) {
      case 'state': {
        const pill = $('state');
        const labels = { idle: 'bereit', connecting: 'verbinde…', connected: 'verbunden', disconnected: 'getrennt', error: 'Fehler' };
        pill.textContent = `${labels[e.state]}${e.detail ? ` · ${e.detail}` : ''}`;
        pill.className = `pill ${e.state === 'connected' ? 'ok' : e.state === 'error' || e.state === 'disconnected' ? 'err' : 'warn'}`;
        const isBt = session?.source instanceof BluetoothSource;
        $('reconnectBtn').hidden = !(isBt && e.state === 'disconnected');
        ($('stopBtn') as HTMLButtonElement).disabled = e.state !== 'connected';
        const canCp = e.state === 'connected' && isBt && (session!.source as BluetoothSource).canSendControl;
        for (const id of ['cpRequest', 'cpStart', 'cpStop']) ($(id) as HTMLButtonElement).disabled = !canCp;
        if (e.state === 'connected') { requestWakeLock(); if (isBt) renderServices(session!.source as BluetoothSource); }
        log(session?.sample?.t ?? 0, `Status: ${pill.textContent}`, e.state === 'error' ? 'error' : '');
        break;
      }
      case 'raw': {
        // Datenrate in Gerätezeit messen – stimmt so auch bei schneller Wiedergabe
        if (e.packet.uuid.startsWith('00002ad1')) {
          packetTimes.push(e.packet.t);
          if (!e.duplicate) changeTimes.push(e.packet.t);
        }
        $('recCount').textContent = String(session?.recorder.count ?? 0);
        const showDup = $<HTMLInputElement>('showDup').checked;
        if (e.duplicate && !showDup) break;
        const hex = Array.from(new Uint8Array(e.packet.data.buffer, e.packet.data.byteOffset, e.packet.data.byteLength), (b) => b.toString(16).padStart(2, '0')).join(' ');
        const decoded = e.decoded == null ? '' : typeof e.decoded === 'string' ? `  → ${e.decoded}` : `  → ${JSON.stringify(stripFlags(e.decoded))}`;
        const kind = e.packet.kind === 'notify' ? '' : ` (${e.packet.kind})`;
        log(e.packet.t, `${nameOf(e.packet.uuid)}${kind}${e.duplicate ? ' (doppelt)' : ''}  [${hex}]${decoded}`, e.duplicate ? 'dup' : 'data');
        break;
      }
      case 'sample': renderSample(e.sample); chart.push(e.sample); break;
      case 'stroke': {
        chart.stroke(e.t);
        const t = tile('strokes');
        t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
        setTile('strokes', e.count, e.intervalMs ? `${(e.intervalMs / 1000).toFixed(2)} s seit letztem` : '');
        break;
      }
      case 'paused': log(e.t, '⏸ Pause erkannt', 'warn'); break;
      case 'resumed': log(e.t, '▶ Rudern erkannt'); break;
      case 'resistance': log(e.t, `Widerstand am Gerät: ${e.level}`); break;
      case 'trainingStatus': break;
      case 'deviceInfo': $('info').textContent = JSON.stringify({ Gerät: deviceName(), ...e.info }, null, 2); break;
      case 'log': log(e.t, e.msg, e.level === 'info' ? '' : e.level); break;
    }
  }

  const stripFlags = (d: unknown) => { if (d && typeof d === 'object' && 'flags' in d) { const { flags: _f, ...rest } = d as Record<string, unknown>; return rest; } return d; };
  const deviceName = () => (session?.source instanceof BluetoothSource ? session.source.deviceName : session?.source.info.label) ?? null;

  function renderSample(s: RowerSample) {
    setTile('spm', s.strokeRate ? s.strokeRate.toFixed(1) : '0', s.avgStrokeRate != null ? `Ø ${s.avgStrokeRate.toFixed(1)}` : '');
    setTile('power', s.power, `geglättet ${Math.round(s.powerSmoothed)} W`);
    setTile('pace', formatPace(s.pace), `geglättet ${formatPace(s.paceSmoothed)}`);
    setTile('dist', s.distance, s.energy != null ? `${s.energy} kcal` : '');
    setTile('time', formatDuration(s.elapsedTime), `Session ${formatDuration(s.t / 1000)}`);
    setTile('hr', s.heartRate, s.heartRate == null ? 'kein Gurt' : '');
    setTile('status', s.rowing ? 'rudert' : 'Pause', s.resistance != null ? `Widerstand ${s.resistance}` : '');
    tile('status').querySelector<HTMLElement>('.value')!.style.color = s.rowing ? 'var(--ok)' : 'var(--warn)';
  }

  // Datenrate getrennt von Events aktualisieren (auch wenn nichts mehr kommt)
  const rateTimer = setInterval(() => {
    const last = packetTimes[packetTimes.length - 1] ?? 0;
    packetTimes = packetTimes.filter((t) => last - t < 5000);
    changeTimes = changeTimes.filter((t) => last - t < 5000);
    if (!session || session.state !== 'connected' || packetTimes.length < 2) { setTile('rate', null, ''); return; }
    setTile('rate', (packetTimes.length / 5).toFixed(1), `davon neu: ${(changeTimes.length / 5).toFixed(1)} Hz`);
  }, 1000);

  function renderServices(src: BluetoothSource) {
    const box = $('services');
    box.className = '';
    box.innerHTML = src.services.length ? '' : '<span class="muted">Keine Services sichtbar.</span>';
    for (const s of src.services) {
      const el = document.createElement('div');
      el.className = 'svc';
      el.innerHTML = `<b>${s.name}</b><br><code style="font-size:11px;color:var(--muted)">${s.uuid}</code>` +
        s.characteristics.map((c) => `<div style="padding-left:12px"><code>${c.name}</code>${c.properties.map((p) => `<span class="tag">${p}</span>`).join('')}</div>`).join('');
      box.appendChild(el);
    }
  }

  // ---------- Simulator ----------
  const sim = () => (session?.source instanceof SimulatorSource ? session.source : null);
  let simLastPower = 80;
  function syncSimUi() {
    const s = sim(); if (!s) return;
    $<HTMLInputElement>('simRange').value = String(s.targetPower);
    $('simValue').textContent = s.targetPower > 0 ? `${s.targetPower} W` : 'Pause';
    $('simPause').textContent = s.targetPower > 0 ? 'Pause' : 'Weiter';
  }
  function simSet(w: number) { const s = sim(); if (!s) return; s.targetPower = Math.max(0, Math.min(250, w)); if (s.targetPower > 0) simLastPower = s.targetPower; syncSimUi(); }
  function simTogglePause() { const s = sim(); if (!s) return; simSet(s.targetPower > 0 ? 0 : simLastPower); }

  const onKey = (ev: KeyboardEvent) => {
    if (!sim() || ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
    if (ev.key === 'ArrowUp') { simSet(sim()!.targetPower + 10); ev.preventDefault(); }
    else if (ev.key === 'ArrowDown') { simSet(sim()!.targetPower - 10); ev.preventDefault(); }
    else if (ev.key === ' ') { simTogglePause(); ev.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // ---------- Wiedergabe ----------
  function setSpeed(v: number) {
    if (session?.source instanceof ReplaySource) session.source.speed = v;
    root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === v));
  }
  async function playJson(json: unknown, label: string) {
    try { await useSource(new ReplaySource(json, label)); }
    catch (err) { log(0, `Aufzeichnung nicht lesbar: ${(err as Error).message}`, 'error'); }
  }

  // ---------- Wake Lock ----------
  async function requestWakeLock() {
    try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen') ?? null; } catch { /* nicht verfügbar */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible' && session?.state === 'connected') requestWakeLock(); };
  document.addEventListener('visibilitychange', onVisible);

  // ---------- Buttons ----------
  $('btBtn').onclick = () => useSource(new BluetoothSource(false));
  $('btAllBtn').onclick = () => useSource(new BluetoothSource(true));
  $('reconnectBtn').onclick = () => session?.start().catch(() => {});
  $('simBtn').onclick = () => useSource(new SimulatorSource({ power: 80, seed: Date.now() }));
  $('stopBtn').onclick = () => session?.stop();
  $<HTMLSelectElement>('recSelect').onchange = async (ev) => {
    const sel = ev.target as HTMLSelectElement;
    const v = sel.value; sel.value = '';
    if (v === 'file') { $('file').click(); return; }
    if (v === '') return;
    const r = BUILTIN_RECORDINGS[Number(v)];
    try { await playJson(await (await fetch(r.url)).json(), r.label); }
    catch (err) { log(0, `Laden fehlgeschlagen: ${(err as Error).message}`, 'error'); }
  };
  $<HTMLInputElement>('file').onchange = async (ev) => {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    try { await playJson(JSON.parse(await f.text()), f.name); }
    catch (err) { log(0, `Datei nicht lesbar: ${(err as Error).message}`, 'error'); }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => { b.onclick = () => setSpeed(Number(b.dataset.speed)); });
  $('simMinus').onclick = () => simSet((sim()?.targetPower ?? 0) - 10);
  $('simPlus').onclick = () => simSet((sim()?.targetPower ?? 0) + 10);
  $<HTMLInputElement>('simRange').oninput = (ev) => simSet(Number((ev.target as HTMLInputElement).value));
  $('simPause').onclick = simTogglePause;
  $('downloadBtn').onclick = () => {
    if (!session) return;
    session.recorder.setDevice(deviceName());
    const blob = new Blob([JSON.stringify(session.recorder.toJSON(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = session.recorder.fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('clearBtn').onclick = () => { logEl.innerHTML = ''; };
  const cp = (bytes: number[], label: string) => session?.sendControl(bytes).then(() => log(session!.sample?.t ?? 0, `gesendet: ${label}`)).catch((err) => log(0, `${label} fehlgeschlagen: ${err.message}`, 'error'));
  $('cpRequest').onclick = () => cp([...CONTROL.REQUEST_CONTROL], 'Control anfordern');
  $('cpStart').onclick = () => cp([...CONTROL.START], 'Start');
  $('cpStop').onclick = () => cp([...CONTROL.STOP], 'Stop');

  log(0, isWebBluetoothAvailable()
    ? 'Bereit. Rudergerät einschalten, e-Connected/Kinomap schließen und „Rudergerät verbinden“ tippen – oder Simulator/Aufzeichnung wählen.'
    : 'Kein Web Bluetooth – Simulator oder Aufzeichnung wählen.');

  return () => {
    endSession();
    clearInterval(rateTimer);
    chart.dispose();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    wakeLock?.release().catch(() => {});
  };
}
