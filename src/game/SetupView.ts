import { connection } from '../app/connection';
import { loadSettings, markSettingsChanged, saveSettings } from '../app/settings';
import { AudioEngine, loadAudioSettings, saveAudioSettings } from '../audio/AudioEngine';
import { loadGraphics, saveGraphics, type QualitySetting } from './scene/quality';
import { formatDuration, formatPace, paceFromPower, powerFromPace } from '../rower/ftms';
import { scheduleBeats } from '../story/story';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { SimulatorSource } from '../rower/sources/simulator';
import { segmentAt, type WorkoutMode, type WorkoutSettings } from '../workout/workout';
import { mountGame } from './GameView';
import { RiverScene } from './scene/RiverScene';
import { levelForMode, levelModes, levelWorkout, pickMode, type Level } from './levels/level';
import { bindFullscreenButton, FS_BUTTON } from '../ui/fullscreen';
import { bindDisconnectPill } from '../ui/disconnect';
import { bindDriveButton, DRIVE_BUTTON } from '../ui/driveButton';
import { BEAT_ICONS, ICON_ARROW, ICON_BACK, ICON_BT, ICON_CHECK, ICON_HEART, ICON_ROWER, LOGO, MODE_HINTS, MODE_ICONS, MODE_LABELS } from '../ui/icons';
import icelandCard from '../assets/ui/iceland-card.webp';


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

/** Preview colour by difficulty only: easy green → amber → hard red. */
function difficultyColor(intensity: number): string {
  const stops: [number, [number, number, number]][] = [[0, [102, 187, 106]], [0.5, [236, 178, 58]], [1, [229, 83, 61]]];
  const x = Math.max(0, Math.min(1, intensity));
  const i = x <= 0.5 ? 0 : 1;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1];
  const k = (x - a) / (b - a);
  return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
}

type SplitKey = 'minPower' | 'maxPower' | 'steadyPower';

/**
 * A 500 m split as typed: "2:45", "2.45", "2,45" or just "245" (numeric keypads have no colon);
 * "2" alone means 2:00. Only 1:00–5:00 counts, anything else is null (still typing).
 */
export function parseSplit(text: string): number | null {
  const t = text.trim();
  let sec: number;
  const m = /^(\d{1,2})\s*[:.,]\s*(\d{1,2})$/.exec(t);
  if (m) {
    if (Number(m[2]) > 59) return null;
    sec = Number(m[1]) * 60 + Number(m[2].padEnd(2, '0'));
  } else if (/^\d{1,4}$/.test(t)) {
    sec = t.length <= 2 ? Number(t) * 60 : Number(t.slice(0, -2)) * 60 + Number(t.slice(-2));
    if (t.length > 2 && Number(t.slice(-2)) > 59) return null;
  } else return null;
  return sec >= 60 && sec <= 300 ? sec : null;
}

function mountSetup(root: HTMLElement, level: Level, initialJump: string | null, onStart: (o: { autopilot: boolean; jump: string | null }) => void): () => void {
  let settings = loadSettings();
  settings.mode = pickMode(level, settings.mode);
  const num = (k: keyof WorkoutSettings, unit: string, attrs: string, wide = false) =>
    `<label class="num${wide ? ' wide' : ''}"><input type="number" inputmode="numeric" data-k="${k}" ${attrs}><small>${unit}</small></label>`;
  // a 500 m split (m:ss); the workout keeps working in watts, shown small next to it
  const split = (k: SplitKey, wide = false) =>
    `<label class="num split${wide ? ' wide' : ''}"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-split="${k}" aria-label="Split per 500 m"><small data-watts="${k}"></small></label>`;

  root.innerHTML = `
    <div class="menu">
      <header class="set-bar">
        <a class="back-pill" href="#/">${ICON_BACK}Home</a>
        ${LOGO}
        <div class="bar-right"><button type="button" class="state-pill" data-id="state">${ICON_BT}<span>Not connected</span></button>${DRIVE_BUTTON}${FS_BUTTON}</div>
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
              <div class="field no-steady" title="Target split at the start and at the peak – e.g. 2:50 → 2:20"><span>Split /500 m <em>start → peak</em></span><div class="pair">${split('minPower')}→${split('maxPower')}</div></div>
              <div class="field no-steady" title="Target stroke rate at the start and at the peak"><span>Stroke rate <em>start → peak</em></span><div class="pair">${num('minSpm', 'spm', 'min="12" max="40"')}→${num('maxSpm', 'spm', 'min="12" max="45"')}</div></div>
              <div class="field only-steady"><span>Split /500 m</span>${split('steadyPower', true)}</div>
              <div class="field only-steady"><span>Stroke rate</span>${num('steadySpm', 'spm', 'min="12" max="45"', true)}</div>
            </div>
          </section>
          <section>
            <div class="pv-head"><h2>Workout preview</h2><b data-id="pvTotal"></b></div>
            <div class="pv" data-id="preview"></div>
            <div class="pv-axis"><span>0 min</span><span data-id="pvEnd"></span></div>
          </section>
        </div>

        <div class="set-card">
          <h2>Your rower</h2>
          <div class="notice-light" data-id="noBt" hidden>No Web Bluetooth in this browser – use Chrome or Edge, or try the simulator.</div>
          <p class="rower-hint">Pair your rower – close other rowing apps first.</p>
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
          <button class="btn-start" data-id="startBtn" disabled>Start rowing ${ICON_ARROW}</button>
          <p class="start-hint" data-id="startHint">Connect a rower or use the simulator.</p>
        </div>
      </div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
  const $a = <T extends HTMLElement = HTMLInputElement>(id: string) => root.querySelector<T>(`[data-a="${id}"]`)!;

  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const offDisc = bindDisconnectPill($('state'));
  const offDrive = bindDriveButton(root.querySelector<HTMLElement>('.drive-wrap')!);

  // ---------- sound ----------
  const snd = loadAudioSettings();
  const music = $a<HTMLInputElement>('music');
  const effects = $a<HTMLInputElement>('effects');
  const muted = $a<HTMLInputElement>('muted');
  music.value = String(Math.round(snd.music * 100));
  effects.value = String(Math.round(snd.effects * 100));
  muted.checked = snd.muted;
  const saveSound = () => { saveAudioSettings({ music: Number(music.value) / 100, effects: Number(effects.value) / 100, muted: muted.checked }); markSettingsChanged(); };
  music.oninput = effects.oninput = muted.onchange = saveSound;

  // ---------- graphics ----------
  const gfx = loadGraphics();
  const qualitySel = $a<HTMLSelectElement>('quality');
  const showFps = $a<HTMLInputElement>('showFps');
  qualitySel.value = gfx.quality;
  showFps.checked = gfx.showFps;
  const saveGfx = () => { saveGraphics({ quality: qualitySel.value as QualitySetting, showFps: showFps.checked }); markSettingsChanged(); };
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

  // splits: typed as m:ss, stored as the watts the workout is built from
  root.querySelectorAll<HTMLInputElement>('input[data-split]').forEach((input) => {
    const k = input.dataset.split as SplitKey;
    const watts = root.querySelector<HTMLElement>(`[data-watts="${k}"]`)!;
    const show = () => { watts.textContent = `${Math.round(settings[k])} W`; };
    const format = () => { input.value = formatPace(paceFromPower(settings[k])); };
    format(); show();
    input.oninput = () => {
      const sec = parseSplit(input.value);
      input.classList.toggle('bad', sec == null && input.value.trim() !== '');
      if (sec == null) return;
      settings = { ...settings, [k]: powerFromPace(sec) };
      saveSettings(settings);
      show();
      renderPreview();
    };
    input.onblur = () => { input.classList.remove('bad'); format(); };
    input.onfocus = () => input.select();
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
      `<i style="flex:${s.end - s.start} 1 0;height:${(height(s) * 100).toFixed(1)}%;background:${difficultyColor(s.intensity)}" title="${played.phases[s.phase].name} · ${formatPace(s.pace.target)} /500 m (${s.power.target} W) · ${s.spm.target} spm · ${formatDuration(s.end - s.start)}"></i>`).join('')}</div>` +
      beats.map((b) => {
        const seg = segmentAt(w, b.t);
        const x = (b.t / w.duration) * plotW;
        let row = rowEnd.findIndex((end) => x - end >= MARK + 2);
        if (row < 0) row = rowEnd.indexOf(Math.min(...rowEnd));
        rowEnd[row] = x;
        const top = ROWS[row];
        const barTop = BARS_TOP + (PV_H - BARS_TOP) * (1 - height(seg));
        return `<button type="button" class="pv-beat${b.id === jump ? ' on' : ''}" data-beat="${b.id}" style="top:${top}px;left:calc(4px + (100% - 8px) * ${(b.t / w.duration).toFixed(4)});background:${difficultyColor(seg.intensity)};--stem:${Math.max(0, barTop - top - MARK).toFixed(0)}px"
          title="Start at: ${b.name} (${formatDuration(b.t)})" aria-label="Start at ${b.name}"><svg viewBox="0 0 16 16">${BEAT_ICONS[b.effect]}</svg></button>`;
      }).join('');
    pv.querySelectorAll<HTMLButtonElement>('.pv-beat').forEach((btn) => {
      btn.onclick = () => { jump = btn.dataset.beat === jump ? null : btn.dataset.beat ?? null; renderPreview(); };
    });
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
    const bt = $<HTMLButtonElement>('btBtn');
    bt.classList.toggle('ok', connected && !sim);
    const link = connection.rowerLink;
    bt.querySelector('span')!.textContent = link === 'connected' ? 'Disconnect rower' : link === 'connecting' ? 'Cancel connecting' : 'Connect rower';
    $('simBtn').classList.toggle('ok', !!sim && connected);
    $('simBtn').querySelector('span')!.textContent = sim && connected ? 'Disconnect simulator' : 'Use simulator';
    const hr = connection.heartRate;
    const hrBtn = $<HTMLButtonElement>('hrBtn');
    hrBtn.querySelector('span')!.textContent = hr.state === 'connected' ? 'Disconnect heart-rate monitor' : hr.state === 'connecting' ? 'Cancel connecting' : 'Connect heart-rate monitor';
    hrBtn.disabled = !isWebBluetoothAvailable();
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
  $('btBtn').onclick = () => (connection.rowerLink ? connection.disconnectRower() : connection.use(new BluetoothSource(false)));
  $('simBtn').onclick = () => (connection.session?.source instanceof SimulatorSource && connection.active
    ? connection.disconnect() : connection.use(new SimulatorSource({ power: 0, heartRate: true, seed: Date.now() })));
  $('hrBtn').onclick = () => (connection.heartRate.state === 'idle' || connection.heartRate.state === 'disconnected' || connection.heartRate.state === 'error'
    ? connection.connectHeartRate() : connection.disconnectHeartRate());
  $('startBtn').onclick = () => onStart({ autopilot: connection.session?.source instanceof SimulatorSource, jump });

  return () => { offConn(); offSession?.(); ro.disconnect(); offFs(); offDisc(); offDrive(); };
}
