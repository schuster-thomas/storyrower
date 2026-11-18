import { formatDuration, formatPace } from '../../rower/ftms';
import type { RowerSample } from '../../rower/types';
import { accuracy, type ScoreState, type Zone } from '../../workout/scoring';
import type { Band, Segment, Workout } from '../../workout/workout';
import { phaseSpans } from '../../workout/workout';
import type { Level } from '../levels/iceland';

export interface HudState {
  level: Level;
  workout: Workout;
  t: number;
  segment: Segment;
  next: Segment | null;
  sample: RowerSample | null;
  zones: { power: Zone; spm: Zone } | null;
  score: ScoreState;
  distance: number;
  /** strokes since the workout started */
  strokes: number;
  message: { text: string; tone: 'info' | 'warn' | 'ok' } | null;
}

const KIND_LABEL: Record<Segment['kind'], string> = { steady: 'Steady', ramp: 'Build', hard: 'Hard', easy: 'Easy', peak: 'All out' };

/** DOM overlay on top of the 3D scene. Large digits – the tablet is 1–1.5 m away. */
export class Hud {
  readonly el: HTMLElement;
  private q = <T extends HTMLElement = HTMLElement>(id: string) => this.el.querySelector<T>(`[data-h="${id}"]`)!;
  private builtFor: Workout | null = null;
  /** Target key (split and stroke-rate centre) currently shown; a change triggers the big announcement. */
  private targetKey: string | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private captionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Called whenever new targets are announced (e.g. to play a sound). */
  onAnnounce: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-title glass">
          <div class="hud-level" data-h="level"></div>
          <div class="hud-phase" data-h="phase"></div>
        </div>
        <div class="hud-progress glass" data-h="progress"></div>
        <div class="hud-right">
          <div class="hud-fps glass" data-h="fps" hidden></div>
          <div class="hud-timer glass" data-h="timer"></div>
          <button class="hud-btn" data-h="muteBtn" title="Sound on/off" aria-label="Sound on/off">🔊</button>
          <button class="hud-btn" data-h="diagBtn" title="Diagnostics" aria-label="Diagnostics">i</button>
          <button class="hud-btn" data-h="exitBtn" title="End workout" aria-label="End workout">✕</button>
        </div>
      </div>
      <div class="hud-next glass" data-h="next"></div>
      <div class="hud-message" data-h="message"></div>
      <div class="hud-target" data-h="target" aria-live="polite"></div>
      <div class="hud-caption" data-h="caption" aria-live="polite"></div>
      <div class="hud-side glass">
        <div><span data-h="acc">–</span><small>in band</small></div>
      </div>
      <div class="hud-bottom glass">
        <div class="hud-tile" data-h="dist"><div class="lbl">Distance</div><div class="val"><b>–</b><span>m</span></div><div class="sub"></div></div>
        <div class="hud-tile" data-h="power"><div class="lbl">Power</div><div class="val"><b>–</b><span>W</span></div><div class="band"><i class="zone"></i><i class="mark"></i></div><div class="sub"></div></div>
        <div class="hud-tile" data-h="spm"><div class="lbl">Stroke rate</div><div class="val"><b>–</b><span>spm</span></div><div class="band"><i class="zone"></i><i class="mark"></i></div><div class="sub"></div></div>
        <div class="hud-tile" data-h="pace"><div class="lbl">Split</div><div class="val"><b>–</b><span>/500 m</span></div><div class="band"><i class="zone"></i><i class="mark"></i></div><div class="sub"></div></div>
        <div class="hud-tile" data-h="hr"><div class="lbl">Heart rate</div><div class="val"><b>–</b><span>bpm</span></div><div class="sub"></div></div>
      </div>`;
    parent.appendChild(this.el);
  }

  onExit(fn: () => void) { this.q('exitBtn').onclick = fn; }
  onDiagnostics(fn: () => void) { this.q('diagBtn').onclick = fn; }
  onMute(fn: () => boolean) {
    const b = this.q('muteBtn');
    b.onclick = () => { b.textContent = fn() ? '🔇' : '🔊'; };
  }
  setMuted(muted: boolean) { this.q('muteBtn').textContent = muted ? '🔇' : '🔊'; }

  showFps(on: boolean) { this.q('fps').hidden = !on; }
  private fpsShown = -1;
  setFps(fps: number, quality: string) {
    const el = this.q('fps');
    if (el.hidden) return;
    const v = Math.round(fps);
    if (v === this.fpsShown) return;
    this.fpsShown = v;
    el.textContent = `${v} fps · ${quality}`;
    el.className = `hud-fps glass ${v < 40 ? 'bad' : v < 55 ? 'meh' : ''}`;
  }

  /** A story line, shown for a few seconds above the bottom bar. */
  caption(text: string, seconds = 6) {
    const el = this.q('caption');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  private buildProgress(w: Workout, level: Level) {
    const spans = phaseSpans(w);
    this.q('progress').innerHTML =
      `<div class="prog-track"><i class="prog-fill" data-h="progFill"></i>` +
      spans.map((p, i) => `<div class="prog-node" data-phase="${p.phase}" style="left:${(p.start / w.duration) * 100}%" title="${level.phases[p.phase].name}">${i + 1}</div>`).join('') +
      `<div class="prog-node finish" style="left:100%">🏁</div></div>`;
    this.builtFor = w;
  }

  /** Big centre display of the new split and stroke-rate targets for a few seconds. */
  announce(seg: Segment, headline: string, seconds = 5) {
    const el = this.q('target');
    el.innerHTML = `
      <div class="tg-head">${headline}</div>
      <div class="tg-pace">${formatPace(seg.pace.lo)}–${formatPace(seg.pace.hi)}<small>/500 m</small></div>
      <div class="tg-spm">${seg.spm.lo}–${seg.spm.hi}<small>spm</small></div>`;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
    this.onAnnounce?.();
  }

  get announcing() { return this.q('target').classList.contains('show'); }

  update(s: HudState) {
    if (this.builtFor !== s.workout) this.buildProgress(s.workout, s.level);
    // Announce when the target split (band centre) or stroke rate changes – also once at the start
    const key = `${Math.round((s.segment.pace.lo + s.segment.pace.hi) / 2)}|${s.segment.spm.lo + s.segment.spm.hi}`;
    if (key !== this.targetKey) {
      const first = this.targetKey == null;
      this.targetKey = key;
      const phaseName = s.level.phases[s.segment.phase].name;
      this.announce(s.segment, first ? `${phaseName} · first target` : `New target · ${KIND_LABEL[s.segment.kind]}`);
    }
    const spans = phaseSpans(s.workout);
    const pi = spans.findIndex((p) => p.phase === s.segment.phase);
    this.q('level').textContent = s.level.title;
    this.q('phase').textContent = `Phase ${pi + 1}/${spans.length} – ${s.level.phases[s.segment.phase].name}`;
    this.q('progFill').style.width = `${Math.min(100, (s.t / s.workout.duration) * 100)}%`;
    this.el.querySelectorAll<HTMLElement>('.prog-node[data-phase]').forEach((n, i) => {
      n.classList.toggle('done', i < pi);
      n.classList.toggle('current', i === pi);
    });
    this.q('timer').textContent = `${formatDuration(s.t)} / ${formatDuration(s.workout.duration)}`;

    // Next segment preview, shown in the last 20 s
    const toNext = s.segment.end - s.t;
    const nx = this.q('next');
    if (s.next && toNext <= 20) {
      const phaseChange = s.next.phase !== s.segment.phase ? `${s.level.phases[s.next.phase].name}! ` : '';
      nx.innerHTML = `In <b>${Math.ceil(toNext)} s</b>: ${phaseChange}${KIND_LABEL[s.next.kind]} · ${s.next.power.lo}–${s.next.power.hi} W · ${s.next.spm.lo}–${s.next.spm.hi} spm`;
      nx.hidden = false;
    } else {
      nx.innerHTML = `${KIND_LABEL[s.segment.kind]} · ${formatDuration(Math.max(0, toNext))} left`;
      nx.hidden = false;
    }

    const msg = this.q('message');
    const showMsg = s.message && !this.announcing;
    msg.textContent = showMsg ? s.message!.text : '';
    msg.className = `hud-message ${showMsg ? `show ${s.message!.tone}` : ''}`;

    const smp = s.sample;
    this.tile('dist', String(Math.round(s.distance)), `${s.strokes} ${s.strokes === 1 ? 'stroke' : 'strokes'}`);
    this.tile('power', smp ? String(Math.round(smp.powerSmoothed)) : '–', `${s.segment.power.lo}–${s.segment.power.hi} W`);
    this.band('power', s.segment.power, smp?.powerSmoothed ?? null, s.zones?.power ?? null);
    this.tile('spm', smp ? smp.strokeRate.toFixed(0) : '–', `${s.segment.spm.lo}–${s.segment.spm.hi} spm`);
    this.band('spm', s.segment.spm, smp?.strokeRate ?? null, s.zones?.spm ?? null);
    this.tile('pace', formatPace(smp?.paceSmoothed), `${formatPace(s.segment.pace.lo)}–${formatPace(s.segment.pace.hi)}`);
    // Split: lower is faster → mirror so "faster" is on the right like the other bars
    const pz = s.zones?.power ?? null;
    this.band('pace', { lo: -s.segment.pace.hi, hi: -s.segment.pace.lo }, smp?.paceSmoothed ? -smp.paceSmoothed : null, pz);
    this.tile('hr', smp?.heartRate != null ? String(smp.heartRate) : '–', smp?.heartRate != null ? '' : 'not connected');

    this.q('acc').textContent = s.score.time > 5 ? `${Math.round(accuracy(s.score) * 100)}%` : '–';
  }

  private tile(id: string, value: string, sub: string) {
    const t = this.q(id);
    t.querySelector('b')!.textContent = value;
    t.querySelector('.sub')!.textContent = sub;
  }

  private band(id: string, band: Band, value: number | null, zone: Zone | null) {
    const t = this.q(id);
    const span = Math.max(1e-6, band.hi - band.lo);
    const min = band.lo - span * 0.9, max = band.hi + span * 0.9;
    const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    const zoneEl = t.querySelector<HTMLElement>('.zone')!;
    zoneEl.style.left = `${pct(band.lo)}%`;
    zoneEl.style.width = `${pct(band.hi) - pct(band.lo)}%`;
    const mark = t.querySelector<HTMLElement>('.mark')!;
    mark.style.display = value == null ? 'none' : '';
    if (value != null) mark.style.left = `${pct(value)}%`;
    t.dataset.zone = zone ?? '';
  }
}
