import { connection } from '../app/connection';
import { formatDuration } from '../rower/ftms';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { SimulatorSource } from '../rower/sources/simulator';
import { DEFAULT_SETTINGS, generateWorkout, phaseSpans, type WorkoutSettings } from '../workout/workout';
import { mountGame } from './GameView';
import { ICELAND } from './levels/iceland';

const STORAGE_KEY = 'storyrower.settings';
const PHASE_COLORS = { idyll: '#5fae6b', omens: '#b3a26a', escalation: '#e0874f', finale: '#c4443a', winddown: '#e9a86b' };

function loadSettings(): WorkoutSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: WorkoutSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** "#/play": workout settings, rower and heart-rate connection, then the game. */
export function mountPlay(root: HTMLElement): () => void {
  let cleanupGame: (() => void) | null = null;
  let cleanupSetup: (() => void) | null = null;
  let autopilot = true;

  const showSetup = () => {
    cleanupGame?.(); cleanupGame = null;
    cleanupSetup = mountSetup(root, (opts) => { autopilot = opts.autopilot; startGame(); });
  };
  const startGame = () => {
    cleanupSetup?.(); cleanupSetup = null;
    cleanupGame?.();
    const workout = generateWorkout(loadSettings());
    const dev = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const speed = Number(dev.get('speed')) || 1;
    const startAt = Number(dev.get('at')) || 0;
    cleanupGame = mountGame(root, { level: ICELAND, workout, autopilot, onExit: showSetup, onRestart: startGame, timeScale: speed, startAt });
  };
  showSetup();
  return () => { cleanupGame?.(); cleanupSetup?.(); };
}

function mountSetup(root: HTMLElement, onStart: (o: { autopilot: boolean }) => void): () => void {
  let settings = loadSettings();
  root.innerHTML = `
    <header class="topbar">
      <h1><a href="#/">StoryRower ‹</a> ${ICELAND.title}</h1>
      <span class="pill" data-id="state">no rower</span>
    </header>
    <main class="page">
      <div class="grid2">
        <section class="panel">
          <h2>Your workout</h2>
          <div class="form">
            <label>Easiest power<span><input type="number" data-k="minPower" min="20" max="500" step="5"> W</span></label>
            <label>Hardest power<span><input type="number" data-k="maxPower" min="20" max="600" step="5"> W</span></label>
            <label>Lowest stroke rate<span><input type="number" data-k="minSpm" min="12" max="40"> spm</span></label>
            <label>Highest stroke rate<span><input type="number" data-k="maxSpm" min="12" max="45"> spm</span></label>
            <label>Duration<span><input type="number" data-k="durationMin" min="10" max="90" step="5"> min</span></label>
            <label title="No target changes faster than this – higher values mean fewer, longer sections">Shortest section<span><input type="number" data-k="minSegmentSec" min="10" max="600" step="10"> s</span></label>
          </div>
          <div class="preview" data-id="preview"></div>
          <div class="legend" data-id="legend"></div>
        </section>
        <section class="panel">
          <h2>Rower</h2>
          <div class="notice" data-id="noBt" hidden>No Web Bluetooth in this browser – use Chrome or Edge, or try the simulator.</div>
          <div class="row">
            <button class="primary" data-id="btBtn">Connect rower</button>
            <button data-id="simAuto" title="The simulator follows the targets on its own">Simulator (autopilot)</button>
            <button data-id="simManual" title="Control the simulated power with ↑ ↓ and Space">Simulator (keyboard)</button>
          </div>
          <p class="muted" data-id="srcInfo"></p>
          <h2 style="margin-top:16px">Heart rate (optional)</h2>
          <div class="row">
            <button data-id="hrBtn">Connect heart-rate monitor</button>
            <span class="muted" data-id="hrState">Fitbit: start a workout and enable "Heart rate on equipment". Chest straps work too.</span>
          </div>
          <div class="row" style="margin-top:24px">
            <button class="primary big" data-id="startBtn" disabled>Start rowing ▸</button>
            <a href="#/diagnose" class="muted">Device &amp; diagnostics</a>
          </div>
        </section>
      </div>
    </main>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
  let autopilot = true;

  // ---------- settings ----------
  root.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((input) => {
    const k = input.dataset.k as keyof WorkoutSettings;
    input.value = String(settings[k]);
    input.oninput = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v <= 0) return;
      settings = { ...settings, [k]: v };
      saveSettings(settings);
      renderPreview();
    };
  });

  function renderPreview() {
    const w = generateWorkout(settings);
    const maxP = Math.max(...w.segments.map((s) => s.power.hi)) * 1.1;
    $('preview').innerHTML = w.segments.map((s) => {
      const width = ((s.end - s.start) / w.duration) * 100;
      const h = (((s.power.lo + s.power.hi) / 2) / maxP) * 100;
      return `<div class="pv-seg" style="width:${width}%" title="${ICELAND.phases[s.phase].name} · ${s.kind} · ${s.power.lo}–${s.power.hi} W · ${s.spm.lo}–${s.spm.hi} spm · ${formatDuration(s.end - s.start)}"><i style="height:${h}%;background:${PHASE_COLORS[s.phase]}"></i></div>`;
    }).join('');
    $('legend').innerHTML = phaseSpans(w).map((p) =>
      `<span><i style="background:${PHASE_COLORS[p.phase]}"></i>${ICELAND.phases[p.phase].name} ${formatDuration(p.end - p.start)}</span>`).join('');
  }
  renderPreview();

  // ---------- connection ----------
  function renderConnection() {
    const s = connection.session;
    const pill = $('state');
    const connected = s?.state === 'connected';
    pill.textContent = s ? `${s.source.info.label} · ${s.state}` : 'no rower';
    pill.className = `pill ${connected ? 'ok' : s ? 'warn' : ''}`;
    $<HTMLButtonElement>('startBtn').disabled = !connected;
    $('srcInfo').textContent = !s ? 'Turn on the rower and close e-Connected/Kinomap before connecting.'
      : s.source instanceof SimulatorSource ? (autopilot ? 'Simulator rows by itself and follows the targets.' : 'Simulator: ↑/↓ change power, Space pauses.')
      : connected ? 'Ready. The workout starts with your first stroke.' : `State: ${s.state}`;
    const hr = connection.heartRate;
    $('hrBtn').textContent = hr.state === 'connected' ? 'Disconnect heart-rate monitor' : 'Connect heart-rate monitor';
    $<HTMLButtonElement>('hrBtn').disabled = !isWebBluetoothAvailable() || hr.state === 'connecting';
    if (hr.state !== 'idle') $('hrState').textContent = `${hr.state}${hr.name ? ` · ${hr.name}` : ''}`;
  }
  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') renderConnection(); }) ?? null; renderConnection(); };
  const offConn = connection.onChange(follow);
  follow();

  if (!isWebBluetoothAvailable()) {
    $('noBt').hidden = false;
    $<HTMLButtonElement>('btBtn').disabled = true;
  }
  $('btBtn').onclick = () => { autopilot = false; connection.use(new BluetoothSource(false)); };
  $('simAuto').onclick = () => { autopilot = true; connection.use(new SimulatorSource({ power: 0, heartRate: true, seed: Date.now() })); };
  $('simManual').onclick = () => { autopilot = false; connection.use(new SimulatorSource({ power: 0, heartRate: true, seed: Date.now() })); };
  $('hrBtn').onclick = () => (connection.heartRate.state === 'connected' ? connection.disconnectHeartRate() : connection.connectHeartRate());
  $('startBtn').onclick = () => onStart({ autopilot: connection.session?.source instanceof SimulatorSource ? autopilot : false });

  return () => { offConn(); offSession?.(); };
}
