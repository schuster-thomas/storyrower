import { CONTROL, formatDuration, formatPace, nameOf } from '../rower/ftms';
import { connection } from '../app/connection';
import { downloadRecording } from '../app/download';
import type { RowerSession } from '../rower/session';
import { BluetoothSource, isWebBluetoothAvailable, loadBtDebug, saveBtDebug } from '../rower/sources/bluetooth';
import { ReplaySource } from '../rower/sources/replay';
import { SimulatorSource } from '../rower/sources/simulator';
import type { RowerEvent, RowerSample } from '../rower/types';
import { PowerChart } from './PowerChart';
import tenMinUrl from '../../poc/ble/recordings/woodrower-2026-11-16-19-13-47-10min.json?url';
import shortUrl from '../../poc/ble/recordings/woodrower-2026-11-16-18-56-39.json?url';

const BUILTIN_RECORDINGS = [
  { label: 'Woodrower 10 min intervals (2026-11-16)', url: tenMinUrl },
  { label: 'Woodrower short test (2026-11-16)', url: shortUrl },
];

const html = String.raw;

/**
 * "Device & diagnostics": pick a source, live values, raw data, recording.
 * Uses the same RowerSession data path as the game.
 */
export function mountDiagnostics(root: HTMLElement): () => void {
  root.innerHTML = html`
    <header class="topbar">
      <h1><a href="#/">StoryRower ‹</a> Device &amp; diagnostics</h1>
      <span class="pill" data-id="state">no source</span>
    </header>
    <main class="page">
      <div class="notice" data-id="noBt" hidden>
        This browser doesn't support Web Bluetooth. Please use <b>Chrome</b> or Edge (Android, Windows, macOS).
        iPad support comes later with the app. The simulator and recordings work anyway.
      </div>

      <section class="panel">
        <h2>Source</h2>
        <div class="row">
          <button class="primary" data-id="btBtn">Connect rower</button>
          <button data-id="btAllBtn" title="Show all Bluetooth devices, not just FTMS">All devices…</button>
          <button data-id="simBtn">Simulator</button>
          <select data-id="recSelect" aria-label="Play a recording">
            <option value="">Play a recording…</option>
            ${BUILTIN_RECORDINGS.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}
            <option value="file">Load file from this device…</option>
          </select>
          <input type="file" data-id="file" accept="application/json,.json">
          <button data-id="stopBtn" disabled>Stop</button>
          <button data-id="reconnectBtn" hidden>Reconnect</button>
        </div>
        <div class="row" style="margin-top:12px">
          <button data-id="hrBtn">Connect heart-rate monitor</button>
          <span class="muted" data-id="hrState">Fitbit: start a workout and enable "Heart rate on equipment" first. Chest straps work too.</span>
        </div>
        <div class="row" data-id="simControls" hidden style="margin-top:12px">
          <span class="muted">Target power</span>
          <button data-id="simMinus">−10</button>
          <input type="range" min="0" max="250" step="5" data-id="simRange">
          <button data-id="simPlus">+10</button>
          <b data-id="simValue" style="min-width:70px"></b>
          <button data-id="simPause">Pause</button>
          <span class="muted">Keyboard: <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Space</kbd></span>
        </div>
        <div class="row" data-id="replayControls" hidden style="margin-top:12px">
          <span class="muted">Speed</span>
          ${[1, 4, 16, 64].map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}
          <span class="muted" data-id="replayPos"></span>
        </div>
      </section>

      <div class="tiles">
        <div class="tile" data-tile="spm"><div class="label">Stroke rate</div><span class="value">–</span><span class="unit">spm</span><div class="sub"></div></div>
        <div class="tile" data-tile="power"><div class="label">Power</div><span class="value">–</span><span class="unit">W</span><div class="sub"></div></div>
        <div class="tile" data-tile="pace"><div class="label">Pace</div><span class="value">–</span><span class="unit">/500 m</span><div class="sub"></div></div>
        <div class="tile" data-tile="dist"><div class="label">Distance</div><span class="value">–</span><span class="unit">m</span><div class="sub"></div></div>
        <div class="tile" data-tile="strokes"><div class="label">Strokes</div><span class="value">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="time"><div class="label">Time (device)</div><span class="value">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="hr"><div class="label">Heart rate</div><span class="value">–</span><span class="unit">bpm</span><div class="sub"></div></div>
        <div class="tile" data-tile="status"><div class="label">Status</div><span class="value" style="font-size:28px">–</span><div class="sub"></div></div>
        <div class="tile" data-tile="rate"><div class="label">Data rate</div><span class="value">–</span><span class="unit">Hz</span><div class="sub"></div></div>
      </div>

      <section class="panel">
        <h2>Power – last 2 minutes</h2>
        <canvas class="chart" data-id="chart"></canvas>
        <div class="legend">
          <span><i style="background:var(--raw)"></i>raw</span>
          <span><i style="background:var(--accent)"></i>smoothed (as used in the game)</span>
          <span><i style="background:var(--muted);width:2px;height:10px"></i>stroke</span>
        </div>
      </section>

      <div class="grid2">
        <section class="panel">
          <h2>Recording</h2>
          <p class="muted" style="margin:0 0 10px">Records automatically while a source is active: <b data-id="recCount">0</b> packets.</p>
          <div class="row">
            <button data-id="downloadBtn" title="One file with everything on this page: all packets, tiles, device, services, Bluetooth details and the log (it can still be played back)">Download</button>
            <button data-id="reportBtn" title="The same as text, to paste into a message">Copy report</button>
          </div>
          <textarea data-id="reportBox" class="report-box" rows="8" readonly hidden></textarea>
          <h2 style="margin-top:16px">Device</h2>
          <pre class="kv" data-id="info">–</pre>
        </section>
        <section class="panel">
          <h2>Services &amp; Characteristics</h2>
          <div data-id="services" class="muted">Bluetooth connections only.</div>
        </section>
      </div>

      <section class="panel">
        <h2>Log</h2>
        <div class="row" style="margin-bottom:8px">
          <label class="muted"><input type="checkbox" data-id="showDup"> show duplicate packets</label>
          <label class="muted" title="Every raw Bluetooth event as the browser delivers it – which object fired, whether the value changed, the bytes"><input type="checkbox" data-id="btTrace"> Bluetooth details</label>
        </div>
        <details class="bt-tests">
          <summary class="muted">Bluetooth tests</summary>
          <div class="row" style="margin:8px 0">
            <label class="muted"><input type="checkbox" data-id="btOnlyRower"> subscribe to Rower Data only (applies on the next connect)</label>
            <button data-id="btResub">Re-subscribe Rower Data</button>
          </div>
          <div class="row" style="margin:0 0 8px" title="Commands to the rower's FTMS Control Point – not needed for rowing; a test in case a console only sends data after a start command">
            <span class="muted">Control point:</span>
            <button data-id="cpRequest" disabled>Request control</button>
            <button data-id="cpStart" disabled>Start</button>
            <button data-id="cpStop" disabled>Stop</button>
          </div>
        </details>
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

  // ---------- Log ----------
  function log(t: number, msg: string, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `${(t / 1000).toFixed(2).padStart(8)}s  ${msg}`;
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
    logEl.appendChild(line);
    while (logEl.childElementCount > 600) logEl.firstChild!.remove();
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  /** A line that already carries its own time (the Bluetooth trace). */
  function logLine(text: string, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
    logEl.appendChild(line);
    while (logEl.childElementCount > 600) logEl.firstChild!.remove();
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }
  const btSource = () => (session?.source instanceof BluetoothSource ? session.source : null);

  // ---------- Switching sources (shared app-wide connection) ----------
  async function useSource(s: RowerSession['source']) {
    await connection.use(s);
  }

  /** Follow the shared session: subscribe to its events and set up source-specific controls. */
  function bind(next: RowerSession | null) {
    if (next === session) return;
    unbind();
    session = next;
    chart.clear();
    packetTimes = []; changeTimes = [];
    if (!session) { $('state').textContent = 'no source'; $('state').className = 'pill'; return; }
    const s = session.source;
    unsubscribe = session.on(onEvent);
    if (s instanceof BluetoothSource) {
      s.onTrace = (line) => { if ($<HTMLInputElement>('btTrace').checked) logLine(line, 'bt'); };
      // everything before this page started listening (device picker, GATT, subscriptions)
      if ($<HTMLInputElement>('btTrace').checked) s.trace.forEach((l) => logLine(l, 'bt'));
    }
    onEvent({ type: 'state', state: session.state });
    if (session.sample) renderSample(session.sample);
    if (Object.keys(session.info).length) onEvent({ type: 'deviceInfo', info: session.info });
    $('simControls').hidden = !(s instanceof SimulatorSource);
    $('replayControls').hidden = !(s instanceof ReplaySource);
    if (s instanceof SimulatorSource) syncSimUi();
    if (s instanceof ReplaySource) {
      setSpeed(1);
      replayTimer = setInterval(() => {
        $('replayPos').textContent = `${formatDuration(s.positionMs / 1000)} / ${formatDuration(s.durationMs / 1000)}`;
      }, 500);
    }
  }

  /** Stop listening – the connection itself stays open for the game. */
  function unbind() {
    const bt = btSource();
    if (bt) bt.onTrace = null;
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  function renderHeartRate() {
    const hr = connection.heartRate;
    const btn = $<HTMLButtonElement>('hrBtn');
    btn.textContent = hr.state === 'connected' ? 'Disconnect heart-rate monitor' : 'Connect heart-rate monitor';
    btn.disabled = !isWebBluetoothAvailable() || hr.state === 'connecting';
    if (hr.state !== 'idle') $('hrState').textContent = `${hr.state}${hr.name ? ` · ${hr.name}` : ''}${hr.detail && hr.state !== 'connected' ? ` · ${hr.detail}` : ''}`;
  }
  const offConnection = connection.onChange(() => { bind(connection.session); renderHeartRate(); });

  // ---------- Session events ----------
  function onEvent(e: RowerEvent) {
    switch (e.type) {
      case 'state': {
        const pill = $('state');
        const labels = { idle: 'ready', connecting: 'connecting…', connected: 'connected', disconnected: 'disconnected', error: 'error' };
        pill.textContent = `${labels[e.state]}${e.detail ? ` · ${e.detail}` : ''}`;
        pill.className = `pill ${e.state === 'connected' ? 'ok' : e.state === 'error' || e.state === 'disconnected' ? 'err' : 'warn'}`;
        const isBt = session?.source instanceof BluetoothSource;
        $('reconnectBtn').hidden = !(isBt && e.state === 'disconnected');
        ($('stopBtn') as HTMLButtonElement).disabled = e.state !== 'connected';
        const canCp = e.state === 'connected' && isBt && (session!.source as BluetoothSource).canSendControl;
        for (const id of ['cpRequest', 'cpStart', 'cpStop']) ($(id) as HTMLButtonElement).disabled = !canCp;
        if (e.state === 'connected') { requestWakeLock(); if (isBt) renderServices(session!.source as BluetoothSource); }
        log(session?.sample?.t ?? 0, `State: ${pill.textContent}`, e.state === 'error' ? 'error' : '');
        break;
      }
      case 'raw': {
        // Measure data rate in device time – stays correct during fast replay
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
        log(e.packet.t, `${nameOf(e.packet.uuid)}${kind}${e.duplicate ? ' (duplicate)' : ''}  [${hex}]${decoded}`, e.duplicate ? 'dup' : 'data');
        break;
      }
      case 'sample': renderSample(e.sample); chart.push(e.sample); break;
      case 'stroke': {
        chart.stroke(e.t);
        const t = tile('strokes');
        t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
        setTile('strokes', e.count, e.intervalMs ? `${(e.intervalMs / 1000).toFixed(2)} s since last` : '');
        break;
      }
      case 'paused': log(e.t, '⏸ Pause detected', 'warn'); break;
      case 'resumed': log(e.t, '▶ Rowing detected'); break;
      case 'resistance': log(e.t, `Resistance on the device: ${e.level}`); break;
      case 'trainingStatus': break;
      case 'deviceInfo': $('info').textContent = JSON.stringify({ Device: deviceName(), ...e.info }, null, 2); break;
      case 'log': log(e.t, e.msg, e.level === 'info' ? '' : e.level); break;
    }
  }

  const stripFlags = (d: unknown) => { if (d && typeof d === 'object' && 'flags' in d) { const { flags: _f, ...rest } = d as Record<string, unknown>; return rest; } return d; };
  const deviceName = () => (session?.source instanceof BluetoothSource ? session.source.deviceName : session?.source.info.label) ?? null;

  function renderSample(s: RowerSample) {
    setTile('spm', s.strokeRate ? s.strokeRate.toFixed(1) : '0', s.avgStrokeRate != null ? `avg ${s.avgStrokeRate.toFixed(1)}` : '');
    setTile('power', s.power, `smoothed ${Math.round(s.powerSmoothed)} W`);
    setTile('pace', formatPace(s.pace), `smoothed ${formatPace(s.paceSmoothed)}`);
    setTile('dist', s.distance, s.energy != null ? `${s.energy} kcal` : '');
    setTile('time', formatDuration(s.elapsedTime), `session ${formatDuration(s.t / 1000)}`);
    setTile('hr', s.heartRate, s.heartRateSource === 'monitor' ? (connection.heartRate.name ?? 'monitor') : s.heartRateSource === 'console' ? 'via console' : 'no HR source');
    setTile('status', s.rowing ? 'rowing' : 'paused', s.resistance != null ? `resistance ${s.resistance}` : '');
    tile('status').querySelector<HTMLElement>('.value')!.style.color = s.rowing ? 'var(--ok)' : 'var(--warn)';
  }

  // Update the data rate on a timer (also when nothing arrives any more)
  const rateTimer = setInterval(() => {
    const last = packetTimes[packetTimes.length - 1] ?? 0;
    packetTimes = packetTimes.filter((t) => last - t < 5000);
    changeTimes = changeTimes.filter((t) => last - t < 5000);
    if (!session || session.state !== 'connected' || packetTimes.length < 2) { setTile('rate', null, ''); return; }
    setTile('rate', (packetTimes.length / 5).toFixed(1), `new values: ${(changeTimes.length / 5).toFixed(1)} Hz`);
  }, 1000);

  function renderServices(src: BluetoothSource) {
    const box = $('services');
    box.className = '';
    box.innerHTML = src.services.length ? '' : '<span class="muted">No services visible.</span>';
    for (const s of src.services) {
      const el = document.createElement('div');
      el.className = 'svc';
      el.innerHTML = `<b>${s.name}</b><br><code style="font-size:11px;color:var(--muted)">${s.uuid}</code>`;
      for (const c of s.characteristics) {
        // Explorer: read or subscribe to any characteristic – values show up in the log and the recording
        const row = document.createElement('div');
        row.className = 'chr';
        row.innerHTML = `<code>${c.name}</code>${c.properties.map((p) => `<span class="tag">${p}</span>`).join('')}`;
        if (c.properties.includes('read')) {
          const b = document.createElement('button');
          b.textContent = 'read';
          b.title = 'Read the value once (shown in the log and under Device)';
          b.onclick = async () => { b.disabled = true; await src.read(c); b.disabled = false; };
          row.appendChild(b);
        }
        if (c.properties.includes('notify') || c.properties.includes('indicate')) {
          const b = document.createElement('button');
          const sync = () => { b.textContent = c.subscribed ? 'subscribed' : 'subscribe'; b.disabled = c.subscribed; };
          b.title = 'Receive every new value (shown in the log, included in the recording)';
          b.onclick = async () => { b.disabled = true; await src.subscribe(c); sync(); };
          sync();
          row.appendChild(b);
        }
        el.appendChild(row);
      }
      box.appendChild(el);
    }
  }

  // ---------- Simulator ----------
  const sim = () => (session?.source instanceof SimulatorSource ? session.source : null);
  let simLastPower = 80;
  function syncSimUi() {
    const s = sim(); if (!s) return;
    $<HTMLInputElement>('simRange').value = String(s.targetPower);
    $('simValue').textContent = s.targetPower > 0 ? `${s.targetPower} W` : 'paused';
    $('simPause').textContent = s.targetPower > 0 ? 'Pause' : 'Resume';
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

  // ---------- Replay ----------
  function setSpeed(v: number) {
    if (session?.source instanceof ReplaySource) session.source.speed = v;
    root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === v));
  }
  async function playJson(json: unknown, label: string) {
    try { await useSource(new ReplaySource(json, label)); }
    catch (err) { log(0, `Could not read recording: ${(err as Error).message}`, 'error'); }
  }

  // ---------- Wake Lock ----------
  async function requestWakeLock() {
    try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen') ?? null; } catch { /* not available */ }
  }
  const onVisible = () => { if (document.visibilityState === 'visible' && session?.state === 'connected') requestWakeLock(); };
  document.addEventListener('visibilitychange', onVisible);

  // ---------- Bluetooth details, tests and the report ----------
  $<HTMLInputElement>('btTrace').onchange = (ev) => {
    if ((ev.target as HTMLInputElement).checked) btSource()?.trace.forEach((l) => logLine(l, 'bt'));
  };
  $<HTMLInputElement>('btOnlyRower').checked = loadBtDebug().onlyRowerData;
  $<HTMLInputElement>('btOnlyRower').onchange = (ev) => saveBtDebug({ onlyRowerData: (ev.target as HTMLInputElement).checked });
  $('btResub').onclick = () => { const bt = btSource(); if (bt) void bt.resubscribeRowerData(); else log(0, 'Re-subscribe: no Bluetooth rower connected', 'warn'); };
  /** Everything the page knows – for the download (as data) and the copied report (as text). */
  function buildReport() {
    const bt = btSource();
    return {
      time: new Date().toISOString(),
      browser: navigator.userAgent,
      screen: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      source: session?.source.info.label ?? 'none',
      state: session?.state ?? null,
      device: deviceName(),
      testSwitches: loadBtDebug(),
      tiles: Array.from(root.querySelectorAll<HTMLElement>('[data-tile]')).map((t) =>
        `${t.querySelector('.label')?.textContent ?? t.dataset.tile}: ${t.querySelector('.value')?.textContent ?? ''} ${t.querySelector('.unit')?.textContent ?? ''} ${t.querySelector('.sub')?.textContent ?? ''}`.replace(/\s+/g, ' ').trim()),
      deviceInfo: $('info').textContent ?? '',
      services: bt?.services ?? [],
      bluetoothTrace: bt?.trace.slice() ?? [],
      log: Array.from(logEl.children).map((c) => c.textContent ?? ''),
    };
  }
  $('downloadBtn').onclick = () => downloadRecording(session, buildReport());

  $('reportBtn').onclick = async () => {
    const r = buildReport();
    const report = [
      'StoryRower diagnostics report',
      `time: ${r.time}`, `browser: ${r.browser}`, `screen: ${r.screen}`,
      `source: ${r.source} · ${r.state ?? '–'} · ${r.device ?? ''}`,
      `test switches: ${JSON.stringify(r.testSwitches)}`,
      '--- tiles ---', ...r.tiles,
      '--- device ---', r.deviceInfo,
      '--- services ---', ...r.services.map((s) => `${s.uuid} ${s.name}: ${s.characteristics.map((c) => `${c.name} [${c.properties.join(' ')}]`).join(', ')}`),
      `--- Bluetooth trace (last ${Math.min(250, r.bluetoothTrace.length)} of ${r.bluetoothTrace.length}) ---`, ...(r.bluetoothTrace.length ? r.bluetoothTrace.slice(-250) : ['(no Bluetooth source)']),
      '--- log (last 150 lines) ---', ...r.log.slice(-150),
    ].join('\n');
    const box = $<HTMLTextAreaElement>('reportBox');
    box.value = report;
    box.hidden = false;
    let copied = false;
    try { await navigator.clipboard.writeText(report); copied = true; } catch { /* not allowed here – select it instead */ }
    if (!copied) { box.focus(); box.select(); }
    $('reportBtn').textContent = copied ? 'Copied ✓' : 'Select & copy the text below';
    setTimeout(() => { $('reportBtn').textContent = 'Copy report'; }, 3000);
  };

  // ---------- Buttons ----------
  $('btBtn').onclick = () => useSource(new BluetoothSource(false));
  $('btAllBtn').onclick = () => useSource(new BluetoothSource(true));
  $('reconnectBtn').onclick = () => session?.start().catch(() => {});
  $('simBtn').onclick = () => useSource(new SimulatorSource({ power: 80, seed: Date.now() }));
  $('stopBtn').onclick = () => session?.stop();
  $('hrBtn').onclick = () => (connection.heartRate.state === 'connected' ? connection.disconnectHeartRate() : connection.connectHeartRate());
  $<HTMLSelectElement>('recSelect').onchange = async (ev) => {
    const sel = ev.target as HTMLSelectElement;
    const v = sel.value; sel.value = '';
    if (v === 'file') { $('file').click(); return; }
    if (v === '') return;
    const r = BUILTIN_RECORDINGS[Number(v)];
    try { await playJson(await (await fetch(r.url)).json(), r.label); }
    catch (err) { log(0, `Loading failed: ${(err as Error).message}`, 'error'); }
  };
  $<HTMLInputElement>('file').onchange = async (ev) => {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    try { await playJson(JSON.parse(await f.text()), f.name); }
    catch (err) { log(0, `Could not read file: ${(err as Error).message}`, 'error'); }
  };
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => { b.onclick = () => setSpeed(Number(b.dataset.speed)); });
  $('simMinus').onclick = () => simSet((sim()?.targetPower ?? 0) - 10);
  $('simPlus').onclick = () => simSet((sim()?.targetPower ?? 0) + 10);
  $<HTMLInputElement>('simRange').oninput = (ev) => simSet(Number((ev.target as HTMLInputElement).value));
  $('simPause').onclick = simTogglePause;
  const cp = (bytes: number[], label: string) => session?.sendControl(bytes).then(() => log(session!.sample?.t ?? 0, `sent: ${label}`)).catch((err) => log(0, `${label} failed: ${err.message}`, 'error'));
  $('cpRequest').onclick = () => cp([...CONTROL.REQUEST_CONTROL], 'Request control');
  $('cpStart').onclick = () => cp([...CONTROL.START], 'Start');
  $('cpStop').onclick = () => cp([...CONTROL.STOP], 'Stop');

  log(0, isWebBluetoothAvailable()
    ? 'Ready. Turn on the rower, close e-Connected/Kinomap and tap "Connect rower" – or pick the simulator or a recording.'
    : 'No Web Bluetooth – pick the simulator or a recording.');

  bind(connection.session);
  renderHeartRate();

  return () => {
    unbind();
    offConnection();
    clearInterval(rateTimer);
    chart.dispose();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    wakeLock?.release().catch(() => {});
  };
}
