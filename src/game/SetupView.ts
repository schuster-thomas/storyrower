import { connection } from '../app/connection';
import { AudioEngine, loadAudioSettings, saveAudioSettings } from '../audio/AudioEngine';
import { loadGraphics, saveGraphics, type QualitySetting } from './scene/quality';
import { formatDuration } from '../rower/ftms';
import { scheduleBeats } from '../story/story';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { SimulatorSource } from '../rower/sources/simulator';
import { DEFAULT_SETTINGS, phaseSpans, segmentAt, type WorkoutMode, type WorkoutSettings } from '../workout/workout';
import { mountGame } from './GameView';
import { RiverScene } from './scene/RiverScene';
import { levelForMode, levelModes, levelWorkout, pickMode, type Level } from './levels/level';
import { PHASE_COLORS } from './phaseColors';
import { bindFullscreenButton, FS_BUTTON } from '../ui/fullscreen';
import { BEAT_ICONS, ICON_ARROW, ICON_BACK, ICON_BT, ICON_CHECK, ICON_HEART, ICON_ROWER, LOGO, MODE_HINTS, MODE_ICONS, MODE_LABELS } from '../ui/icons';
import icelandCard from '../assets/ui/iceland-card.webp';

const STORAGE_KEY = 'storyrower.settings';

function loadSettings(): WorkoutSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: WorkoutSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** "#/play/<level>": workout settings, rower and heart-rate connection, then the game. */
export function mountPlay(root: HTMLElement, level: Level): () => void {
  let cleanupGame: (() => void) | null = null;
  let cleanupSetup: (() => void) | null = null;
  let autopilot = true;
  /** story moment chosen on the setup screen to start at (kept for "Row again") */
  let jump: string | null = null;
  let audio: AudioEngine | null = null;

  const showSetup = () => {
    // load the 3D world while the settings are on screen, so the game starts in its final look
    void RiverScene.preload();
    cleanupGame?.(); cleanupGame = null;
    audio?.ctx.suspend().catch(() => {});
    cleanupSetup = mountSetup(root, level, jump, (opts) => { autopilot = opts.autopilot; jump = opts.jump; startGame(); });
  };
  const startGame = () => {
    cleanupSetup?.(); cleanupSetup = null;
    cleanupGame?.();
    const settings = loadSettings();
    const workout = levelWorkout(level, settings);
    // the level as it plays in this mode: only the mode's story beats, the mode's look
    const played = levelForMode(level, workout.settings.mode);
    const dev = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const speed = Number(dev.get('speed')) || 1;
    // a story moment chosen on the setup screen (or ?beat=eruption) starts 5 s before that beat
    const beatId = dev.get('beat') ?? jump;
    const beat = beatId ? scheduleBeats(played, workout).find((b) => b.id === beatId) : null;
    const startAt = beat ? Math.max(0, beat.t - 5) : Number(dev.get('at')) || 0;
    // Runs inside the Start / Row again click, so the browser allows sound
    try { audio ??= new AudioEngine(); audio.setSettings(loadAudioSettings()); audio.resume().catch(() => {}); } catch { audio = null; }
    cleanupGame = mountGame(root, { level: played, workout, autopilot, onExit: showSetup, onRestart: startGame, timeScale: speed, startAt, audio });
  };
  showSetup();
  return () => { cleanupGame?.(); cleanupSetup?.(); audio?.dispose(); audio = null; };
}

function mountSetup(root: HTMLElement, level: Level, initialJump: string | null, onStart: (o: { autopilot: boolean; jump: string | null }) => void): () => void {
  let settings = loadSettings();
  settings.mode = pickMode(level, settings.mode);
  const num = (k: keyof WorkoutSettings, unit: string, attrs: string, wide = false) =>
    `<label class="num${wide ? ' wide' : ''}"><input type="number" inputmode="numeric" data-k="${k}" ${attrs}><small>${unit}</small></label>`;

  root.innerHTML = `
    <div class="menu">
      <header class="set-bar">
        <a class="back-pill" href="#/">${ICON_BACK}Home</a>
        ${LOGO}
        <div class="bar-right"><span class="state-pill" data-id="state">${ICON_BT}<span>Not connected</span></span>${FS_BUTTON}</div>
      </header>
      <div class="set-banner">
        <img src="${icelandCard}" alt="">
        <div><h1>${level.title}</h1><p>Workout settings</p></div>
      </div>
      <div class="set-grid">
        <div class="set-card">
          <section>
            <h2>Choose your mode</h2>
            <div class="modes" role="radiogroup" aria-label="Workout mode">
              ${levelModes(level).map((m) => `<button type="button" class="mode" role="radio" data-mode="${m}" title="${MODE_HINTS[m]}">
                <span class="tick">${ICON_CHECK}</span>${MODE_ICONS[m]}<span>${MODE_LABELS[m]}</span></button>`).join('')}
            </div>
            <p class="muted-line" data-id="modeText"></p>
          </section>
          <section>
            <h2>Your workout</h2>
            <div class="fields">
              <div class="field"><span>Duration</span>${num('durationMin', 'min', 'min="10" max="90" step="5"', true)}</div>
              <div class="field no-steady" title="No target changes faster than this – higher values mean fewer, longer sections"><span>Shortest section</span>${num('minSegmentSec', 's', 'min="10" max="600" step="10"', true)}</div>
              <div class="field no-steady"><span>Power range</span><div class="pair">${num('minPower', 'W', 'min="20" max="500" step="5"')}to${num('maxPower', 'W', 'min="20" max="600" step="5"')}</div></div>
              <div class="field no-steady"><span>Stroke rate</span><div class="pair">${num('minSpm', 'spm', 'min="12" max="40"')}to${num('maxSpm', 'spm', 'min="12" max="45"')}</div></div>
              <div class="field only-steady"><span>Power</span>${num('steadyPower', 'W', 'min="20" max="600" step="5"', true)}</div>
              <div class="field only-steady"><span>Stroke rate</span>${num('steadySpm', 'spm', 'min="12" max="45"', true)}</div>
            </div>
          </section>
          <section>
            <div class="pv-head"><h2>Workout preview</h2><b data-id="pvTotal"></b></div>
            <div class="pv" data-id="preview"></div>
            <div class="pv-axis"><span>0 min</span><span data-id="pvEnd"></span></div>
            <div class="pv-legend" data-id="legend"></div>
          </section>
        </div>

        <div class="set-card">
          <h2>Your rower</h2>
          <div class="notice-light" data-id="noBt" hidden>No Web Bluetooth in this browser – use Chrome or Edge, or try the simulator.</div>
          <div class="rower">
            <b data-id="rowerHead">Ready to connect</b><p data-id="rowerText">Pair your rowing machine to use live data in the adventure.</p>
          </div>
          <div class="stack">
            <button class="btn-big navy" data-id="btBtn">${ICON_ROWER}<span>Connect rower</span></button>
            <button class="btn-big navy" data-id="hrBtn">${ICON_HEART}<span>Connect heart-rate monitor</span></button>
            <p class="hr-note" data-id="hrState" title="Optional. Fitbit: start a workout and enable &quot;Heart rate on equipment&quot;. Chest straps work too.">Optional · Fitbit: turn on "Heart rate on equipment"</p>
            <button class="btn-big outline" data-id="simBtn" title="A simulated rower that follows the targets on its own"><span>Use simulator</span></button>
          </div>
          <hr class="rule">
          <div class="sd-head">
            <h2>Sound &amp; display</h2>
            <label class="check"><input type="checkbox" data-a="muted"> Mute</label>
            <label class="check" title="Show the frame rate during the game"><input type="checkbox" data-a="showFps"> Frame rate</label>
          </div>
          <div class="opt-row"><span>Music</span><input type="range" min="0" max="100" step="5" data-a="music" aria-label="Music volume"></div>
          <div class="opt-row"><span>Effects</span><input type="range" min="0" max="100" step="5" data-a="effects" aria-label="Effects volume"></div>
          <div class="opt-row"><span>Graphics</span>
            <select data-a="quality" aria-label="Graphics quality">
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <hr class="rule">
          <div class="opt-row"><span>Start at</span><select data-id="jump" aria-label="Start at"></select></div>
          <p class="opt-hint">Jump to a story moment.</p>
          <button class="btn-start" data-id="startBtn" disabled>Start rowing ${ICON_ARROW}</button>
          <p class="start-hint" data-id="startHint">Connect a rower or use the simulator.</p>
        </div>
      </div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
  const $a = <T extends HTMLElement = HTMLInputElement>(id: string) => root.querySelector<T>(`[data-a="${id}"]`)!;

  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);

  // ---------- sound ----------
  const snd = loadAudioSettings();
  const music = $a<HTMLInputElement>('music');
  const effects = $a<HTMLInputElement>('effects');
  const muted = $a<HTMLInputElement>('muted');
  music.value = String(Math.round(snd.music * 100));
  effects.value = String(Math.round(snd.effects * 100));
  muted.checked = snd.muted;
  const saveSound = () => saveAudioSettings({ music: Number(music.value) / 100, effects: Number(effects.value) / 100, muted: muted.checked });
  music.oninput = effects.oninput = muted.onchange = saveSound;

  // ---------- graphics ----------
  const gfx = loadGraphics();
  const qualitySel = $a<HTMLSelectElement>('quality');
  const showFps = $a<HTMLInputElement>('showFps');
  qualitySel.value = gfx.quality;
  showFps.checked = gfx.showFps;
  const saveGfx = () => saveGraphics({ quality: qualitySel.value as QualitySetting, showFps: showFps.checked });
  qualitySel.onchange = showFps.onchange = saveGfx;

  // ---------- mode ----------
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>('.mode')];
  const renderMode = () => {
    modeBtns.forEach((b) => {
      const on = b.dataset.mode === settings.mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('modeText').textContent = level.modes[settings.mode]?.summary ?? MODE_HINTS[settings.mode];
    // steady has one target and no sections: hide the range and "shortest section" fields
    root.querySelectorAll<HTMLElement>('.no-steady').forEach((el) => { el.hidden = settings.mode === 'steady'; });
    root.querySelectorAll<HTMLElement>('.only-steady').forEach((el) => { el.hidden = settings.mode !== 'steady'; });
  };
  const setMode = (m: WorkoutMode) => { settings = { ...settings, mode: m }; saveSettings(settings); renderMode(); renderPreview(); };
  modeBtns.forEach((b, i) => {
    b.onclick = () => setMode(b.dataset.mode as WorkoutMode);
    b.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = modeBtns[(i + d + modeBtns.length) % modeBtns.length];
      next.focus();
      setMode(next.dataset.mode as WorkoutMode);
    };
  });

  // ---------- workout numbers ----------
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

  let jump = initialJump;
  const jumpSel = $<HTMLSelectElement>('jump');
  jumpSel.onchange = () => { jump = jumpSel.value || null; renderPreview(); };

  function renderPreview() {
    const w = levelWorkout(level, settings);
    const played = levelForMode(level, w.settings.mode);
    const beats = scheduleBeats(played, w);
    if (jump && !beats.some((b) => b.id === jump)) jump = null;   // not in this mode or this (shorter) workout
    jumpSel.innerHTML = `<option value="">Beginning</option>` + beats.map((b) =>
      `<option value="${b.id}">${b.name} · ${formatDuration(b.t)}</option>`).join('');
    jumpSel.value = jump ?? '';

    const mins = Math.round(w.duration / 60);
    $('pvTotal').textContent = `${mins} min`;
    $('pvEnd').textContent = `${mins} min`;
    const maxP = Math.max(...w.segments.map((s) => s.power.hi));
    const minP = Math.min(...w.segments.map((s) => s.power.lo));
    // bars from 25 % (easiest) to 100 % (hardest) of the chart height, so the shape reads clearly
    const height = (s: { power: { lo: number; hi: number } }) => {
      const mid = (s.power.lo + s.power.hi) / 2;
      return 0.25 + 0.75 * (maxP > minP ? (mid - minP) / (maxP - minP) : 0.5);
    };
    const pv = $('preview');
    // geometry matches .pv / .pv-bars / .pv-beat in menu.css; markers that would overlap go to a second row
    const BARS_TOP = 80, PV_H = 196, MARK = 28, ROWS = [8, 44];
    const plotW = Math.max(200, pv.clientWidth - 8);
    const rowEnd = ROWS.map(() => -Infinity);
    pv.innerHTML = `<div class="pv-bars">${w.segments.map((s) =>
      `<i style="flex:${s.end - s.start} 1 0;height:${(height(s) * 100).toFixed(1)}%;background:${PHASE_COLORS[s.phase]}" title="${played.phases[s.phase].name} · ${s.power.lo}–${s.power.hi} W · ${s.spm.lo}–${s.spm.hi} spm · ${formatDuration(s.end - s.start)}"></i>`).join('')}</div>` +
      beats.map((b) => {
        const seg = segmentAt(w, b.t);
        const x = (b.t / w.duration) * plotW;
        let row = rowEnd.findIndex((end) => x - end >= MARK + 2);
        if (row < 0) row = rowEnd.indexOf(Math.min(...rowEnd));
        rowEnd[row] = x;
        const top = ROWS[row];
        const barTop = BARS_TOP + (PV_H - BARS_TOP) * (1 - height(seg));
        return `<button type="button" class="pv-beat${b.id === jump ? ' on' : ''}" data-beat="${b.id}" style="top:${top}px;left:calc(4px + (100% - 8px) * ${(b.t / w.duration).toFixed(4)});background:${PHASE_COLORS[seg.phase]};--stem:${Math.max(0, barTop - top - MARK).toFixed(0)}px"
          title="Start at: ${b.name} (${formatDuration(b.t)})" aria-label="Start at ${b.name}"><svg viewBox="0 0 16 16">${BEAT_ICONS[b.effect]}</svg></button>`;
      }).join('');
    pv.querySelectorAll<HTMLButtonElement>('.pv-beat').forEach((btn) => {
      btn.onclick = () => { jump = btn.dataset.beat === jump ? null : btn.dataset.beat ?? null; renderPreview(); };
    });
    $('legend').innerHTML = phaseSpans(w).map((p) =>
      `<span><i style="background:${PHASE_COLORS[p.phase]}"></i><b>${played.phases[p.phase].name}</b> · ${formatDuration(p.end - p.start)}</span>`).join('');
  }
  renderMode();
  renderPreview();
  // marker rows depend on the chart width
  const ro = new ResizeObserver(() => renderPreview());
  ro.observe($('preview'));

  // ---------- connection ----------
  function renderConnection() {
    const s = connection.session;
    const connected = s?.state === 'connected';
    const sim = s?.source instanceof SimulatorSource;
    const pill = $('state');
    pill.querySelector('span')!.textContent = !s ? 'Not connected' : sim ? `Simulator${connected ? '' : ` · ${s.state}`}` : `${s.source.info.label} · ${s.state}`;
    pill.className = `state-pill ${connected ? 'ok' : s ? 'warn' : ''}`;
    $<HTMLButtonElement>('startBtn').disabled = !connected;
    $('startHint').textContent = !connected ? 'Connect a rower or use the simulator.'
      : sim ? 'The simulator rows by itself and follows the targets.' : 'Ready – the workout starts with your first stroke.';
    $('rowerHead').textContent = !s ? 'Ready to connect' : connected ? (sim ? 'Simulator running' : 'Rower connected') : s.state === 'connecting' ? 'Connecting…' : 'Not connected';
    $('rowerText').textContent = !s ? 'Pair your rowing machine to use live data in the adventure. Close other rowing apps first.'
      : sim ? 'A simulated rower that follows the targets on its own.'
      : connected ? `${s.source.info.label} – live data drives the adventure.` : 'Turn on the rower and try again.';
    const bt = $<HTMLButtonElement>('btBtn');
    bt.classList.toggle('ok', connected && !sim);
    bt.querySelector('span')!.textContent = connected && !sim ? 'Rower connected' : 'Connect rower';
    $('simBtn').classList.toggle('ok', !!sim && connected);
    const hr = connection.heartRate;
    const hrBtn = $<HTMLButtonElement>('hrBtn');
    hrBtn.querySelector('span')!.textContent = hr.state === 'connected' ? 'Disconnect heart-rate monitor' : 'Connect heart-rate monitor';
    hrBtn.disabled = !isWebBluetoothAvailable() || hr.state === 'connecting';
    if (hr.state !== 'idle') $('hrState').textContent = `Heart rate: ${hr.state}${hr.name ? ` · ${hr.name}` : ''}`;
  }
  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') renderConnection(); }) ?? null; renderConnection(); };
  const offConn = connection.onChange(follow);
  follow();

  if (!isWebBluetoothAvailable()) {
    $('noBt').hidden = false;
    $<HTMLButtonElement>('btBtn').disabled = true;
  }
  $('btBtn').onclick = () => connection.use(new BluetoothSource(false));
  $('simBtn').onclick = () => connection.use(new SimulatorSource({ power: 0, heartRate: true, seed: Date.now() }));
  $('hrBtn').onclick = () => (connection.heartRate.state === 'connected' ? connection.disconnectHeartRate() : connection.connectHeartRate());
  $('startBtn').onclick = () => onStart({ autopilot: connection.session?.source instanceof SimulatorSource, jump });

  return () => { offConn(); offSession?.(); ro.disconnect(); offFs(); };
}
