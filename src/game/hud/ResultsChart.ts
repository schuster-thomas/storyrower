import { formatDuration } from '../../rower/ftms';
import type { TracePoint } from '../../workout/trace';
import type { PhaseId } from '../../workout/workout';
import { PHASE_COLORS } from '../phaseColors';

/**
 * The workout as a time series on the end screen: power, stroke rate and heart rate as small
 * multiples on one shared time axis (each with its own scale – never two scales on one chart),
 * the target bands shaded behind power and stroke rate, the story phases as a strip on top.
 * A crosshair with a tooltip follows the finger or the mouse; a table view lists minute averages.
 */

interface Panel {
  title: string;
  unit: string;
  color: string;
  value: (p: TracePoint) => number | null;
  band?: (p: TracePoint) => [number, number];
}

const NS = 'http://www.w3.org/2000/svg';
// STRIP: phase strip on top; TITLE: room for each panel's title above its plot area
const LEFT = 40, RIGHT = 12, STRIP = 8, TITLE = 18, GAP = 10, AXIS = 20;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** A "nice" step (1, 2 or 5 × 10ⁿ) so that the range fits in about `count` steps. */
function niceStep(range: number, count: number) {
  const raw = Math.max(1e-6, range / count);
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

export function mountResultsChart(host: HTMLElement, points: TracePoint[], phaseName: (p: PhaseId) => string, opts: { panelHeight?: number } = {}): () => void {
  const PANEL = opts.panelHeight ?? 76;
  const hasHr = points.some((p) => p.hr != null);
  const panels: Panel[] = [
    { title: 'Power', unit: 'W', color: 'var(--s-power)', value: (p) => p.power, band: (p) => p.powerBand },
    { title: 'Stroke rate', unit: 'spm', color: 'var(--s-spm)', value: (p) => p.spm, band: (p) => p.spmBand },
    ...(hasHr ? [{ title: 'Heart rate', unit: 'bpm', color: 'var(--s-hr)', value: (p: TracePoint) => p.hr }] : []),
  ];

  host.innerHTML = `
    <div class="rc">
      <div class="rc-head">
        <span class="rc-title">Your workout over time</span>
        <button class="rc-toggle" data-a="view" aria-pressed="false">Table</button>
      </div>
      <div class="rc-plot">
        <div class="rc-cross" hidden></div>
        <div class="rc-tip" hidden></div>
      </div>
      <div class="rc-table" hidden></div>
      ${hasHr ? '' : '<p class="rc-note">No heart-rate monitor was connected.</p>'}
    </div>`;
  const plot = host.querySelector<HTMLElement>('.rc-plot')!;
  const cross = host.querySelector<HTMLElement>('.rc-cross')!;
  const tip = host.querySelector<HTMLElement>('.rc-tip')!;
  const table = host.querySelector<HTMLElement>('.rc-table')!;
  const toggle = host.querySelector<HTMLButtonElement>('[data-a="view"]')!;

  if (points.length < 2) {
    plot.innerHTML = '<p class="rc-note">Row a little longer to see your workout here.</p>';
    toggle.hidden = true;
    return () => {};
  }

  const t0 = points[0].t, t1 = points[points.length - 1].t;
  let svg: SVGSVGElement | null = null;
  let dots: SVGCircleElement[] = [];
  let x = (t: number) => t;
  const ys: ((v: number) => number)[] = [];
  const panelTop = (i: number) => STRIP + 10 + TITLE + i * (TITLE + PANEL + GAP);

  function render() {
    const width = Math.max(280, plot.clientWidth);
    const height = panelTop(panels.length) - TITLE - GAP + AXIS;
    svg?.remove();
    svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'rc-svg', role: 'img', 'aria-label': 'Power, stroke rate and heart rate over the workout' });
    plot.prepend(svg);
    const w = width - LEFT - RIGHT;
    x = (t: number) => LEFT + ((t - t0) / Math.max(1, t1 - t0)) * w;

    // story phases: a thin strip on top
    let runStart = 0;
    for (let i = 1; i <= points.length; i++) {
      if (i < points.length && points[i].phase === points[runStart].phase) continue;
      const a = x(points[runStart].t), b = x(points[i - 1].t);
      el('rect', { x: a, y: 0, width: Math.max(1, b - a - 2), height: STRIP, rx: 3, fill: PHASE_COLORS[points[runStart].phase] }, svg);
      runStart = i;
    }

    ys.length = 0;
    panels.forEach((pn, i) => {
      const top = panelTop(i);
      const vals = points.map(pn.value).filter((v): v is number => v != null);
      const bands = pn.band ? points.flatMap((p) => pn.band!(p)) : [];
      const lo0 = Math.min(...vals, ...bands), hi0 = Math.max(...vals, ...bands);
      const step = niceStep(Math.max(1, hi0 - lo0), 3);
      const lo = Math.max(0, Math.floor(lo0 / step) * step), hi = Math.ceil(hi0 / step) * step;
      const y = (v: number) => top + PANEL - ((v - lo) / Math.max(1e-6, hi - lo)) * PANEL;
      ys.push(y);
      // recessive grid and tick labels (text ink, not the series colour)
      for (let v = lo; v <= hi + 1e-6; v += step) {
        el('line', { x1: LEFT, x2: LEFT + w, y1: y(v), y2: y(v), class: 'rc-grid' }, svg!);
        const lbl = el('text', { x: LEFT - 6, y: y(v) + 4, class: 'rc-tick', 'text-anchor': 'end' }, svg!);
        lbl.textContent = String(Math.round(v * 10) / 10);
      }
      // the target band behind the line
      if (pn.band) {
        const upper = points.map((p) => `${x(p.t).toFixed(1)},${y(pn.band!(p)[1]).toFixed(1)}`);
        const lower = points.map((p) => `${x(p.t).toFixed(1)},${y(pn.band!(p)[0]).toFixed(1)}`).reverse();
        el('polygon', { points: [...upper, ...lower].join(' '), style: `fill:${pn.color};opacity:0.24` }, svg!);
      }
      // the line (breaks where there is no value, e.g. heart rate dropped out)
      let d = '';
      let pen = false;
      for (const p of points) {
        const v = pn.value(p);
        if (v == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      el('path', { d, class: 'rc-line', style: `stroke:${pn.color}` }, svg!);
      // title: a short line key in the series colour, the words in text ink
      el('line', { x1: LEFT + 2, x2: LEFT + 16, y1: top - 12, y2: top - 12, class: 'rc-key', style: `stroke:${pn.color}` }, svg!);
      const title = el('text', { x: LEFT + 22, y: top - 8, class: 'rc-ptitle' }, svg!);
      title.textContent = `${pn.title} (${pn.unit})${pn.band ? ' · target band shaded' : ''}`;
    });

    // time axis under the last panel
    const axisY = panelTop(panels.length) - TITLE - GAP + 14;
    const span = Math.max(1, t1 - t0);
    const stepMin = [1, 2, 5, 10, 15, 20, 30].find((m) => span / (m * 60) <= 6) ?? 30;
    for (let s = Math.ceil(t0 / (stepMin * 60)) * stepMin * 60; s <= t1; s += stepMin * 60) {
      // the last label ends at the right edge instead of being cut off
      const anchor = x(s) > width - RIGHT - 18 ? 'end' : x(s) < LEFT + 18 ? 'start' : 'middle';
      const lbl = el('text', { x: x(s), y: axisY, class: 'rc-tick', 'text-anchor': anchor }, svg);
      lbl.textContent = formatDuration(s);
    }

    // hover dots (surface ring keeps them readable on the line)
    dots = panels.map((pn) => el('circle', { r: 4.5, class: 'rc-dot', style: `fill:${pn.color}`, visibility: 'hidden' }, svg!));
  }

  // ---------- hover: crosshair across all panels and one tooltip ----------
  function nearest(px: number) {
    const t = t0 + ((px - LEFT) / Math.max(1, (svg?.clientWidth ?? 1) - LEFT - RIGHT)) * (t1 - t0);
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t < t) lo = mid; else hi = mid; }
    return Math.abs(points[lo].t - t) < Math.abs(points[hi].t - t) ? lo : hi;
  }
  function show(ev: PointerEvent) {
    if (!svg) return;
    const r = plot.getBoundingClientRect();
    const px = ev.clientX - r.left;
    if (px < LEFT - 4 || px > r.width - RIGHT + 4) { hide(); return; }
    const p = points[nearest(px)];
    const cx = x(p.t);
    cross.hidden = false;
    cross.style.left = `${cx}px`;
    panels.forEach((pn, i) => {
      const v = pn.value(p);
      dots[i].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { dots[i].setAttribute('cx', String(cx)); dots[i].setAttribute('cy', String(ys[i](v))); }
    });
    tip.hidden = false;
    tip.innerHTML = `<b>${formatDuration(p.t)}</b> · ${phaseName(p.phase)}` + panels.map((pn) => {
      const v = pn.value(p);
      const band = pn.band ? ` <span>(target ${pn.band(p)[0]}–${pn.band(p)[1]})</span>` : '';
      return `<div><i style="background:${pn.color}"></i>${pn.title}: <b>${v ?? '–'}</b> ${pn.unit}${band}</div>`;
    }).join('');
    const tw = tip.offsetWidth;
    tip.style.left = `${cx + 12 + tw > r.width ? cx - 12 - tw : cx + 12}px`;
  }
  function hide() {
    cross.hidden = true;
    tip.hidden = true;
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  }
  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointerleave', hide);

  // ---------- table view: minute averages ----------
  function renderTable() {
    const rows: string[] = [];
    for (let m = Math.floor(t0 / 60); m * 60 <= t1; m++) {
      const ps = points.filter((p) => p.t >= m * 60 && p.t < (m + 1) * 60);
      if (!ps.length) continue;
      const avg = (f: (p: TracePoint) => number | null) => {
        const v = ps.map(f).filter((x): x is number => x != null);
        return v.length ? Math.round((v.reduce((s, a) => s + a, 0) / v.length) * 10) / 10 : '–';
      };
      rows.push(`<tr><td>${formatDuration(m * 60)}</td><td>${phaseName(ps[0].phase)}</td>${panels.map((pn) => `<td>${avg(pn.value)}</td>`).join('')}</tr>`);
    }
    table.innerHTML = `<table><thead><tr><th>Minute</th><th>Phase</th>${panels.map((pn) => `<th>${pn.title} (${pn.unit})</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  toggle.onclick = () => {
    const showTable = table.hidden;
    if (showTable) renderTable();
    table.hidden = !showTable;
    plot.hidden = showTable;
    toggle.textContent = showTable ? 'Chart' : 'Table';
    toggle.setAttribute('aria-pressed', String(showTable));
  };

  const ro = new ResizeObserver(() => { if (!plot.hidden) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}
