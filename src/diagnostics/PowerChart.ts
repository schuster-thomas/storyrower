import type { RowerSample } from '../rower/types';

/** Small canvas chart: raw power, smoothed power and stroke markers. */
export class PowerChart {
  private points: { t: number; raw: number; smooth: number }[] = [];
  private strokes: number[] = [];
  private frame = 0;
  private dirty = true;
  private readonly windowMs = 120_000;
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.observer = new ResizeObserver(() => { this.dirty = true; });
    this.observer.observe(canvas);
    const loop = () => { if (this.dirty) this.draw(); this.frame = requestAnimationFrame(loop); };
    this.frame = requestAnimationFrame(loop);
  }

  push(s: RowerSample) {
    this.points.push({ t: s.t, raw: s.power, smooth: s.powerSmoothed });
    const cutoff = s.t - this.windowMs;
    while (this.points.length > 2 && this.points[1].t < cutoff) this.points.shift();
    while (this.strokes.length && this.strokes[0] < cutoff) this.strokes.shift();
    this.dirty = true;
  }

  stroke(t: number) { this.strokes.push(t); this.dirty = true; }

  clear() { this.points = []; this.strokes = []; this.dirty = true; }

  dispose() { cancelAnimationFrame(this.frame); this.observer.disconnect(); }

  private draw() {
    this.dirty = false;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(c);
    const color = (v: string) => css.getPropertyValue(v).trim();
    const pad = { l: 36, r: 8, t: 8, b: 18 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const tEnd = this.points.length ? this.points[this.points.length - 1].t : this.windowMs;
    const tStart = tEnd - this.windowMs;
    const maxP = Math.max(100, ...this.points.map((p) => p.raw)) * 1.1;
    const x = (t: number) => pad.l + ((t - tStart) / this.windowMs) * pw;
    const y = (p: number) => pad.t + ph - (p / maxP) * ph;

    // Grid
    g.strokeStyle = color('--line'); g.fillStyle = color('--muted'); g.lineWidth = 1;
    g.font = '11px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    const step = maxP > 300 ? 100 : 50;
    for (let p = 0; p <= maxP; p += step) {
      g.beginPath(); g.moveTo(pad.l, Math.round(y(p)) + 0.5); g.lineTo(w - pad.r, Math.round(y(p)) + 0.5); g.stroke();
      g.fillText(`${p}`, pad.l - 6, y(p));
    }
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('−2 min', pad.l, h - pad.b + 4);
    g.textAlign = 'right'; g.fillText('now', w - pad.r, h - pad.b + 4);

    // Strokes
    g.strokeStyle = color('--muted'); g.globalAlpha = 0.35;
    for (const t of this.strokes) { if (t < tStart) continue; g.beginPath(); g.moveTo(Math.round(x(t)) + 0.5, pad.t + ph - 10); g.lineTo(Math.round(x(t)) + 0.5, pad.t + ph); g.stroke(); }
    g.globalAlpha = 1;
    if (this.points.length < 2) return;

    // Raw value as steps, smoothed as a line
    g.strokeStyle = color('--raw'); g.lineWidth = 1.5; g.beginPath();
    this.points.forEach((p, i) => {
      if (i === 0) g.moveTo(x(Math.max(p.t, tStart)), y(p.raw));
      else { g.lineTo(x(p.t), y(this.points[i - 1].raw)); g.lineTo(x(p.t), y(p.raw)); }
    });
    g.stroke();
    g.strokeStyle = color('--accent'); g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath();
    this.points.forEach((p, i) => (i === 0 ? g.moveTo(x(Math.max(p.t, tStart)), y(p.smooth)) : g.lineTo(x(p.t), y(p.smooth))));
    g.stroke();
  }
}
