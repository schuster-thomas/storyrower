import { connection } from '../app/connection';
import { downloadRecording } from '../app/download';
import { formatDuration, formatPace } from '../rower/ftms';
import { SimulatorSource } from '../rower/sources/simulator';
import type { RowerEvent, RowerSample } from '../rower/types';
import { accuracy, isIn, isLow, newScore, stars, updateScore, type Zone } from '../workout/scoring';
import { nextSegment, segmentAt, type PhaseId, type Segment, type Workout } from '../workout/workout';
import { Hud } from './hud/Hud';
import type { Level } from './levels/iceland';
import { RiverScene } from './scene/RiverScene';

export interface GameOptions {
  level: Level;
  workout: Workout;
  /** When the source is the simulator: let it follow the targets on its own. */
  autopilot: boolean;
  onExit: () => void;
  onRestart: () => void;
  /** Development aid: run the workout clock faster (e.g. #/play?speed=20). */
  timeScale?: number;
  /** Development aid: start at this workout second (e.g. #/play?at=960 jumps to the finale). */
  startAt?: number;
}

/**
 * The greybox game: 3D river + HUD, driven by the shared rower session.
 * The workout clock only runs while you row – stop rowing and the game pauses.
 */
export function mountGame(root: HTMLElement, opts: GameOptions): () => void {
  const { level, workout } = opts;
  const session = connection.session;
  root.innerHTML = `<div class="game"><canvas class="game-canvas"></canvas></div>`;
  const wrap = root.querySelector<HTMLElement>('.game')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;

  if (!session) {
    wrap.innerHTML = `<div class="game-overlay show"><div class="card-big"><h2>No rower connected</h2><p class="muted">Connect a rower or start the simulator first.</p><button class="primary" data-a="back">Back</button></div></div>`;
    wrap.querySelector<HTMLButtonElement>('[data-a="back"]')!.onclick = opts.onExit;
    return () => {};
  }

  const scene = new RiverScene(canvas, level.phases.idyll.env);
  const hud = new Hud(wrap);
  const overlay = document.createElement('div');
  overlay.className = 'game-overlay';
  wrap.appendChild(overlay);
  const diag = document.createElement('div');
  diag.className = 'game-diag glass';
  diag.hidden = true;
  diag.innerHTML = `<pre></pre><div class="row"><button data-a="rec">Download recording</button><span class="muted" data-a="recInfo"></span></div>`;
  wrap.appendChild(diag);
  const diagText = diag.querySelector('pre')!;
  diag.querySelector<HTMLButtonElement>('[data-a="rec"]')!.onclick = () => downloadRecording(session);

  // ---------- state ----------
  let t = Math.max(0, Math.min(workout.duration - 1, opts.startAt ?? 0));
  let started = false;
  let finished = false;
  let sample: RowerSample | null = session.sample;
  let zones: { power: Zone; spm: Zone } | null = null;
  let startDistance: number | null = null;
  let powerSum = 0;
  let phase: PhaseId | null = null;
  const score = newScore();

  // ---------- simulator helpers ----------
  const sim = session.source instanceof SimulatorSource ? session.source : null;
  if (sim && opts.autopilot) {
    // Follows the targets but drifts a little, so the band bars and the wave have something to show
    sim.profile = (s) => {
      const seg = segmentAt(workout, t);
      const mid = (seg.power.lo + seg.power.hi) / 2;
      return finished ? 0 : Math.max(20, mid * (1 + 0.12 * Math.sin(s / 9) + 0.06 * Math.sin(s / 2.3)));
    };
  }
  const onKey = (ev: KeyboardEvent) => {
    if (!sim || opts.autopilot) return;
    if (ev.key === 'ArrowUp') { sim.targetPower = Math.min(300, sim.targetPower + 10); ev.preventDefault(); }
    else if (ev.key === 'ArrowDown') { sim.targetPower = Math.max(0, sim.targetPower - 10); ev.preventDefault(); }
    else if (ev.key === ' ') { sim.targetPower = sim.targetPower > 0 ? 0 : 80; ev.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // ---------- recording: game events go into the same file as the rower packets ----------
  const fmtBand = (b: { lo: number; hi: number }) => [Math.round(b.lo), Math.round(b.hi)];
  session.logEvent('game-start', {
    level: level.id, settings: workout.settings, duration: workout.duration, autopilot: opts.autopilot,
    timeScale: opts.timeScale ?? 1, startAt: opts.startAt ?? 0, source: session.source.info.label,
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
    segments: workout.segments.map((g) => ({ start: g.start, end: g.end, phase: g.phase, kind: g.kind, power: fmtBand(g.power), spm: fmtBand(g.spm), pace: fmtBand(g.pace) })),
  });
  const onVisibility = () => session.logEvent('visibility', { state: document.visibilityState });
  document.addEventListener('visibilitychange', onVisibility);
  const onError = (ev: ErrorEvent) => session.logEvent('error', { message: ev.message, source: ev.filename, line: ev.lineno });
  window.addEventListener('error', onError);

  // ---------- session events ----------
  const off = session.on((e: RowerEvent) => {
    if (e.type === 'sample') {
      sample = e.sample;
      if (!started && e.sample.rowing) { started = true; session.logEvent('game-rowing-started', { gameT: t }); }
      if (started && startDistance == null) startDistance = e.sample.distance;
    } else if (e.type === 'stroke') scene.stroke(e.intervalMs);
  });

  // ---------- layout ----------
  const ro = new ResizeObserver(() => scene.resize(wrap.clientWidth, wrap.clientHeight));
  ro.observe(wrap);
  scene.resize(wrap.clientWidth, wrap.clientHeight);

  let wakeLock: WakeLockSentinel | null = null;
  navigator.wakeLock?.request('screen').then((w) => { wakeLock = w; }).catch(() => {});

  // ---------- results ----------
  function finish(early: boolean) {
    if (finished) return;
    finished = true;
    if (sim && opts.autopilot) sim.profile = () => 0;
    const st = stars(score);
    const dist = sample && startDistance != null ? sample.distance - startDistance : 0;
    session!.logEvent('game-finish', {
      early, gameT: Math.round(t), stars: st, accuracy: +accuracy(score).toFixed(3), powerInS: Math.round(score.powerIn), spmInS: Math.round(score.spmIn),
      distance: Math.round(dist), avgPower: t > 0 ? Math.round(powerSum / t) : 0, coins: Math.floor(score.coins),
    });
    overlay.className = 'game-overlay show';
    overlay.innerHTML = `
      <div class="card-big">
        <h2>${early ? 'Workout ended' : `${level.phases.winddown.name} – you made it!`}</h2>
        <div class="stars">${'★'.repeat(st)}<span>${'★'.repeat(3 - st)}</span></div>
        <div class="results">
          <div><b>${Math.round(accuracy(score) * 100)}%</b><small>in band</small></div>
          <div><b>${formatDuration(t)}</b><small>time</small></div>
          <div><b>${Math.round(dist)} m</b><small>distance</small></div>
          <div><b>${t > 0 ? Math.round(powerSum / t) : 0} W</b><small>avg power</small></div>
          <div><b>${Math.floor(score.coins)}</b><small>coins</small></div>
        </div>
        <div class="row" style="justify-content:center">
          <button class="primary" data-a="again">Row again</button>
          <button data-a="back">Back to setup</button>
        </div>
        <div class="row" style="justify-content:center">
          <button data-a="rec">Download recording</button>
        </div>
      </div>`;
    overlay.querySelector<HTMLButtonElement>('[data-a="again"]')!.onclick = opts.onRestart;
    overlay.querySelector<HTMLButtonElement>('[data-a="back"]')!.onclick = opts.onExit;
    overlay.querySelector<HTMLButtonElement>('[data-a="rec"]')!.onclick = () => downloadRecording(session!);
  }

  hud.onExit(() => (finished || t < 1 ? opts.onExit() : finish(true)));
  hud.onDiagnostics(() => { diag.hidden = !diag.hidden; });

  // ---------- loop ----------
  let last = performance.now();
  let frame = 0;
  let diagTimer = 0;
  let snapTimer = 0;
  let frames = 0;
  let fps = 0;
  let fpsTimer = 0;
  let lastSeg: Segment | null = null;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const rowing = session.isRowing && session.state === 'connected';
    const active = started && rowing && !finished;
    const gdt = dt * (opts.timeScale ?? 1); // game time step
    if (active) t = Math.min(workout.duration, t + gdt);
    const seg = segmentAt(workout, t);
    if (seg !== lastSeg) {
      lastSeg = seg;
      session.logEvent('game-section', { index: workout.segments.indexOf(seg), gameT: Math.round(t), phase: seg.phase, kind: seg.kind, power: fmtBand(seg.power), spm: fmtBand(seg.spm), pace: fmtBand(seg.pace) });
    }
    frames++; fpsTimer += dt;
    if (fpsTimer >= 1) { fps = frames / fpsTimer; frames = 0; fpsTimer = 0; }

    if (seg.phase !== phase) { scene.setEnvironment(level.phases[seg.phase].env, phase == null); phase = seg.phase; }
    if (active && sample) {
      zones = updateScore(score, gdt, seg, sample.powerSmoothed, sample.strokeRate);
      powerSum += sample.powerSmoothed * gdt;
    }
    if (t >= workout.duration) finish(false);

    const speed = rowing && sample?.paceSmoothed ? 500 / sample.paceSmoothed : 0;
    scene.update(dt, speed, score.threat, seg.intensity);

    hud.update({
      level, workout, t, segment: seg, next: nextSegment(workout, t), sample, zones, score,
      distance: sample && startDistance != null ? sample.distance - startDistance : 0,
      message: finished ? null : messageFor(),
    });

    // A compact game snapshot every 5 s: enough to replay what the player saw
    snapTimer += dt;
    if (snapTimer >= 5) {
      snapTimer = 0;
      session.logEvent('game-snapshot', {
        gameT: Math.round(t), active, rowing, fps: Math.round(fps), power: sample?.power ?? null, powerSmoothed: Math.round(sample?.powerSmoothed ?? 0),
        spm: sample?.strokeRate ?? null, pace: sample?.paceSmoothed ? Math.round(sample.paceSmoothed) : null, hr: sample?.heartRate ?? null,
        zones, threat: +score.threat.toFixed(2), accuracy: +accuracy(score).toFixed(3), coins: Math.floor(score.coins),
      });
    }

    diagTimer += dt;
    if (!diag.hidden && diagTimer > 0.25) {
      diagTimer = 0;
      diag.querySelector('[data-a="recInfo"]')!.textContent = `${session.recorder.count} packets · ${session.recorder.eventCount} events`;
      diagText.textContent = [
        `source     ${session.source.info.label} · ${session.state}${session.isRowing ? ' · rowing' : ' · paused'}`,
        `power      raw ${sample?.power ?? '–'} W · smoothed ${Math.round(sample?.powerSmoothed ?? 0)} W · band ${seg.power.lo}–${seg.power.hi} (${zones?.power ?? '–'})`,
        `stroke     ${sample?.strokeRate ?? '–'} spm · #${sample?.strokeCount ?? '–'} · band ${seg.spm.lo}–${seg.spm.hi} (${zones?.spm ?? '–'})`,
        `split      raw ${formatPace(sample?.pace)} · smoothed ${formatPace(sample?.paceSmoothed)} · ${speed.toFixed(2)} m/s`,
        `heart rate ${sample?.heartRate ?? '–'} (${sample?.heartRateSource ?? 'none'})`,
        `workout    ${formatDuration(t)} · ${seg.phase}/${seg.kind} · intensity ${seg.intensity.toFixed(2)} · threat ${score.threat.toFixed(2)}`,
        `display    ${Math.round(fps)} fps · ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
      ].join('\n');
    }
    frame = requestAnimationFrame(loop);

    function messageFor(): { text: string; tone: 'info' | 'warn' | 'ok' } | null {
      if (session!.state !== 'connected') return { text: 'Rower disconnected', tone: 'warn' };
      if (!started) return { text: 'Start rowing to begin', tone: 'info' };
      if (!rowing) return { text: 'Paused – row to continue', tone: 'info' };
      if (!zones) return null;
      const waveShown = level.phases[seg.phase].env.wave > 0;
      if (isLow(zones.power) && zones.power === 'low') return { text: waveShown ? 'More power – the wave is catching up!' : 'A little more power', tone: 'warn' };
      if (zones.power === 'high') return { text: 'Save your strength!', tone: 'info' };
      if (isIn(zones.power) && score.combo > 15 && score.combo < 18) return { text: 'In the zone!', tone: 'ok' };
      return null;
    }
  };
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    off();
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('error', onError);
    if (!finished && started) session.logEvent('game-exit', { gameT: Math.round(t) });
    if (sim && opts.autopilot) sim.profile = null;
    wakeLock?.release().catch(() => {});
    scene.dispose();
  };
}
