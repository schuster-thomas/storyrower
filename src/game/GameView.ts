import { connection } from '../app/connection';
import { downloadRecording } from '../app/download';
import type { AudioEngine } from '../audio/AudioEngine';
import { environmentAt, scheduleBeats, storyStateAt } from '../story/story';
import { formatDuration, formatPace } from '../rower/ftms';
import { SimulatorSource } from '../rower/sources/simulator';
import type { RowerEvent, RowerSample } from '../rower/types';
import { accuracy, isIn, isLow, newScore, stars, updateScore, type Zone } from '../workout/scoring';
import { WorkoutTrace, summarize } from '../workout/trace';
import { mountResultsChart } from './hud/ResultsChart';
import { nextSegment, segmentAt, type Segment, type Workout } from '../workout/workout';
import { Hud } from './hud/Hud';
import type { Level } from './levels/level';
import { AutoQuality, loadGraphics } from './scene/quality';
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
  /** Sound – created by the setup screen inside the Start click (browser autoplay rules). */
  audio?: AudioEngine | null;
}

/** How "hot" the music should be in each phase / section. */
function musicIntensity(seg: Segment): number {
  switch (seg.phase) {
    case 'idyll': return 0.05;
    case 'omens': return 0.25 + seg.intensity * 0.3;
    case 'escalation': return seg.kind === 'hard' ? 0.85 : 0.6;
    case 'finale': return 1;
    case 'winddown': return 0.1;
  }
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

  const graphics = loadGraphics();
  const auto = graphics.quality === 'auto' ? new AutoQuality('medium') : null;
  const scene = new RiverScene(canvas, level.phases.idyll.env, auto ? auto.level : graphics.quality === 'auto' ? 'medium' : graphics.quality);
  if (import.meta.env.DEV) (window as unknown as { __scene: RiverScene }).__scene = scene; // debugging aid in dev builds only
  const hud = new Hud(wrap);
  // Show the world only once boat, painted layers and model kit are in (preloaded on the setup
  // screen, so usually at once) and the first stretch of fjord is built – never a greybox frame.
  let worldReady = false;
  let shown = false;
  let readyFrames = 0;
  wrap.classList.add('loading');
  const loading = document.createElement('div');
  loading.className = 'game-loading';
  loading.textContent = 'Loading the fjord…';
  wrap.appendChild(loading);
  scene.ready.then(() => { worldReady = true; });
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
  let startStrokes: number | null = null;
  let startEnergy: number | null = null;
  const startT = t;
  /** one point per second of rowing, for the chart at the end */
  const trace = new WorkoutTrace();
  let unmountChart: (() => void) | null = null;
  const strokesRowed = () => (sample && startStrokes != null ? Math.max(0, sample.strokeCount - startStrokes) : 0);
  let powerSum = 0;
  let envSet = false;
  const audio = opts.audio ?? null;
  const beats = scheduleBeats(level, workout);
  let beatT = t; // beats at or before the start time are skipped (e.g. when jumping with ?at=)
  if (audio) hud.setMuted(audio.currentSettings.muted);
  hud.onMute(() => audio?.toggleMute() ?? false);
  hud.onAnnounce = () => audio?.targetChange();
  scene.onBombLanded = (d) => audio?.bombLanded(d);
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

  // ---------- recording: game events go into the same file as the rower packets ----------
  const fmtBand = (b: { lo: number; hi: number }) => [Math.round(b.lo), Math.round(b.hi)];
  session.logEvent('game-start', {
    level: level.id, settings: workout.settings, duration: workout.duration, autopilot: opts.autopilot,
    timeScale: opts.timeScale ?? 1, startAt: opts.startAt ?? 0, source: session.source.info.label,
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, graphics,
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
      if (!started && shown && e.sample.rowing) { started = true; session.logEvent('game-rowing-started', { gameT: t }); }
      if (started && startDistance == null) { startDistance = e.sample.distance; startEnergy = e.sample.energy; }
      // rowing starts with a stroke, and that one counts
      if (started && startStrokes == null) startStrokes = Math.max(0, e.sample.strokeCount - 1);
    } else if (e.type === 'stroke') { scene.stroke(e.intervalMs); audio?.stroke(); }
  });

  // ---------- layout ----------
  // Resizing clears the canvas, so it is applied in the loop right before the next frame is drawn
  // (a ResizeObserver fires after this frame was rendered – resizing there showed a black frame).
  let resizePending = false;
  const ro = new ResizeObserver(() => { resizePending = true; });
  ro.observe(wrap);
  scene.resize(wrap.clientWidth, wrap.clientHeight);
  // A lost GPU context draws nothing until it is restored – log it, the recording should show it
  const onContextLost = () => session.logEvent('webgl-context-lost', { gameT: Math.round(t) });
  const onContextRestored = () => session.logEvent('webgl-context-restored', { gameT: Math.round(t) });
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

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
      distance: Math.round(dist), strokes: strokesRowed(), avgPower: t > startT ? Math.round(powerSum / (t - startT)) : 0, coins: Math.floor(score.coins),
    });
    const energy = sample?.energy != null && startEnergy != null ? sample.energy - startEnergy : null;
    const sum = summarize(trace.points, { time: t - startT, distance: dist, strokes: strokesRowed(), energy });
    const tile = (value: string, label: string, extra = '') => `<div><b>${value}</b><small>${label}</small>${extra ? `<em>${extra}</em>` : ''}</div>`;
    overlay.className = 'game-overlay show';
    overlay.innerHTML = `
      <div class="card-big results-card">
        <h2>${early ? 'Workout ended' : `${level.phases.winddown.name} – you made it!`}</h2>
        <div class="stars">${'★'.repeat(st)}<span>${'★'.repeat(3 - st)}</span></div>
        <div class="results">
          ${tile(`${Math.round(dist)} m`, 'distance')}
          ${tile(formatDuration(sum.time), 'time')}
          ${tile(String(sum.strokes), 'strokes')}
          ${tile(`${sum.avgPower} W`, 'avg power', `max ${sum.maxPower} W`)}
          ${tile(sum.avgPace ? formatPace(sum.avgPace) : '–', 'avg split /500 m')}
          ${tile(`${sum.avgSpm}`, 'avg strokes/min')}
          ${sum.avgHr != null ? tile(`${sum.avgHr}`, 'avg heart rate', `max ${sum.maxHr}`) : ''}
          ${sum.energy != null ? tile(`${sum.energy}`, 'kcal') : ''}
          ${tile(`${Math.round(accuracy(score) * 100)}%`, 'in target band')}
        </div>
        <div class="results-chart"></div>
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
    unmountChart = mountResultsChart(overlay.querySelector<HTMLElement>('.results-chart')!, trace.points, (p) => level.phases[p].name);
  }

  hud.onExit(() => (finished || t < 1 ? opts.onExit() : finish(true)));
  hud.onDiagnostics(() => { diag.hidden = !diag.hidden; });
  hud.showFps(graphics.showFps);

  // ---------- loop ----------
  let last = performance.now();
  const startedAt = last;
  let frame = 0;
  let diagTimer = 0;
  let snapTimer = 0;
  let frames = 0;
  let fps = 0;
  let fpsTimer = 0;
  let lastSeg: Segment | null = null;
  // real (uncapped) frame times since the last snapshot – the scene stats cap dt at 100 ms and only cover 3 s
  let worstFrameMs = 0;
  let longFrames = 0;
  const loop = (now: number) => {
    const rawMs = now - last;
    const dt = Math.min(0.1, rawMs / 1000);
    last = now;
    worstFrameMs = Math.max(worstFrameMs, rawMs);
    if (rawMs > 50) longFrames++;
    if (resizePending) {
      resizePending = false;
      if (scene.resize(wrap.clientWidth, wrap.clientHeight)) session.logEvent('resize', { size: [wrap.clientWidth, wrap.clientHeight], dpr: devicePixelRatio, gameT: Math.round(t) });
    }
    const rowing = session.isRowing && session.state === 'connected';
    const active = started && rowing && !finished;
    const gdt = dt * (opts.timeScale ?? 1); // game time step
    if (active) t = Math.min(workout.duration, t + gdt);
    const seg = segmentAt(workout, t);
    if (seg !== lastSeg) {
      lastSeg = seg;
      session.logEvent('game-section', { index: workout.segments.indexOf(seg), gameT: Math.round(t), phase: seg.phase, kind: seg.kind, power: fmtBand(seg.power), spm: fmtBand(seg.spm), pace: fmtBand(seg.pace) });
    }
    if (worldReady && !shown && ++readyFrames > 4) {
      shown = true;
      wrap.classList.remove('loading');
      session.logEvent('game-world-ready', { ms: Math.round(now - startedAt) });
    }
    frames++; fpsTimer += dt;
    if (auto && started) {
      const changed = auto.frame(dt);
      if (changed) { scene.setQuality(changed); session.logEvent('quality-change', { to: changed, fps: Math.round(fps), gameT: Math.round(t) }); }
    }
    if (fpsTimer >= 1) { fps = frames / fpsTimer; frames = 0; fpsTimer = 0; }

    // Story: smooth environment, ongoing effects and one-shot beats
    const env = environmentAt(level, workout, t);
    scene.setEnvironment(env, !envSet);
    envSet = true;
    const story = storyStateAt(beats, workout, t);
    if (t > beatT) {
      for (const b of beats) {
        if (b.t > beatT && b.t <= t) {
          scene.play(b.effect);
          audio?.effect(b.effect);
          hud.caption(b.caption);
          session.logEvent('story-beat', { id: b.id, beatT: b.t, gameT: Math.round(t) });
        }
      }
      beatT = t;
    }
    if (active && sample) {
      trace.add(t, sample.powerSmoothed, sample.strokeRate, sample.heartRate, seg);
      zones = updateScore(score, gdt, seg, sample.powerSmoothed, sample.strokeRate);
      powerSum += sample.powerSmoothed * gdt;
    }
    if (t >= workout.duration) finish(false);

    const speed = rowing && sample?.paceSmoothed ? 500 / sample.paceSmoothed : 0;
    scene.update(dt, speed, score.threat, seg.intensity, story);
    audio?.update({
      dt, intensity: musicIntensity(seg), danger: env.wave * (1 - score.threat), speed,
      smoke: env.smoke, birds: story.birds, active: active || finished,
    });

    hud.update({
      level, workout, t, segment: seg, next: nextSegment(workout, t), sample, zones, score,
      distance: sample && startDistance != null ? sample.distance - startDistance : 0,
      strokes: strokesRowed(),
      message: finished ? null : messageFor(),
    });

    // A compact game snapshot every 5 s: enough to replay what the player saw
    snapTimer += dt;
    if (snapTimer >= 5) {
      snapTimer = 0;
      session.logEvent('game-snapshot', {
        gameT: Math.round(t), active, rowing, fps: Math.round(fps), quality: scene.quality,
        frameMs: +scene.stats.frameMs.toFixed(1), frameP95: +scene.stats.frameP95.toFixed(1), renderMs: +scene.stats.renderMs.toFixed(1),
        worstFrameMs: Math.round(worstFrameMs), longFrames,
        calls: scene.stats.calls, triangles: scene.stats.triangles, power: sample?.power ?? null, powerSmoothed: Math.round(sample?.powerSmoothed ?? 0),
        spm: sample?.strokeRate ?? null, pace: sample?.paceSmoothed ? Math.round(sample.paceSmoothed) : null, hr: sample?.heartRate ?? null,
        zones, threat: +score.threat.toFixed(2), accuracy: +accuracy(score).toFixed(3), coins: Math.floor(score.coins),
      });
      worstFrameMs = 0;
      longFrames = 0;
    }

    hud.setFps(fps, scene.quality);
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
        `display    ${Math.round(fps)} fps · frame ${scene.stats.frameMs.toFixed(1)} ms (p95 ${scene.stats.frameP95.toFixed(1)}) · render ${scene.stats.renderMs.toFixed(1)} ms`,
        `graphics   ${scene.quality}${auto ? ' (auto)' : ''} · ${scene.stats.calls} draw calls · ${Math.round(scene.stats.triangles / 1000)}k triangles · ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
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
    scene.onBombLanded = null;
    off();
    ro.disconnect();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('error', onError);
    if (!finished && started) session.logEvent('game-exit', { gameT: Math.round(t) });
    if (sim && opts.autopilot) sim.profile = null;
    wakeLock?.release().catch(() => {});
    unmountChart?.();
    scene.dispose();
  };
}
