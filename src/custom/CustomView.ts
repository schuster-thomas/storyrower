import { loadSettings } from '../app/settings';
import { drive } from '../cloud/drive';
import { difficultyColor, sectionBarHeight } from '../game/phaseColors';
import { levelById } from '../game/levels';
import { formatDuration, formatPace } from '../rower/ftms';
import { bindDriveButton, DRIVE_BUTTON } from '../ui/driveButton';
import { bindFullscreenButton, FS_BUTTON } from '../ui/fullscreen';
import { customIcon, ICON_BACK, LOGO, sectionLabel } from '../ui/icons';
import { CUSTOM_LIMITS, customBands, customDuration, intensityScale, type CustomSection } from '../workout/workout';
import {
  deleteCustom, freeName, getCustom, listCustom, newCustomId, onCustomChanged, saveCustom, starterSections, type CustomTraining,
} from '../workout/customStore';
import customCard from '../assets/ui/custom-card.webp';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Bar height in the chart: the max split is the full height, +45 s and slower a stub. */
const barHeight = (s: CustomSection) => sectionBarHeight(s.slower);
/** Quick buttons under a section field: take `by` off or add it to the number in the box. */
const steps = (k: keyof CustomSection, by: number, unit: string) =>
  `<div class="ct-steps"><button type="button" data-step="${k}" data-by="${-by}" aria-label="${by} ${unit} less">−${by} ${unit}</button><button type="button" data-step="${k}" data-by="${by}" aria-label="${by} ${unit} more">+${by} ${unit}</button></div>`;
const plus = (s: CustomSection) => (s.slower ? `+${s.slower} s` : 'max');
const minus = (s: CustomSection) => (s.fewer ? `−${s.fewer} spm` : 'max spm');

/**
 * "#/custom" and "#/custom/<id>": make and change custom trainings. A training is a list of
 * sections – length in seconds, seconds per 500 m over the max split, strokes under the max stroke
 * rate; the levels then ask only for the max split and stroke rate. Every change is saved right away (Drive a moment later).
 * "?from=<level>" (coming from a level's settings) leads back there; "?new" starts a new training.
 */
export function mountCustom(root: HTMLElement, initialId: string | null, params: URLSearchParams): () => void {
  const from = levelById(params.get('from') ?? '');
  root.innerHTML = `
    <div class="menu ct">
      <header class="set-bar">
        <a class="back-pill" href="${from ? `#/play/${from.id}` : '#/'}">${ICON_BACK}${from ? esc(from.title) : 'Home'}</a>
        ${LOGO}
        <div class="bar-right">${DRIVE_BUTTON}${FS_BUTTON}</div>
      </header>
      <div class="set-banner">
        <img src="${customCard}" alt="">
        <div><h1>Custom trainings</h1><p data-id="sub"></p></div>
      </div>
      <div class="ct-grid">
        <aside class="set-card ct-list">
          <h2>Your trainings</h2>
          <div class="ct-items" data-id="items"></div>
          <button type="button" class="btn-big outline ct-new" data-id="new">＋ New training</button>
        </aside>
        <section class="set-card ct-edit" data-id="edit"></section>
      </div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-id="${id}"]`)!;
  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const offDrive = bindDriveButton(root.querySelector<HTMLElement>('.drive-wrap')!);

  let current: CustomTraining | null = null;
  let sel = 0;
  /** our own save is under way: the change event that comes with it is not news */
  let saving = false;
  const save = (plan: Parameters<typeof saveCustom>[0]) => { saving = true; try { return saveCustom(plan); } finally { saving = false; } };

  const setUrl = () => {
    const q = from ? `?from=${from.id}` : '';
    history.replaceState(null, '', `#/custom${current ? `/${encodeURIComponent(current.id)}` : ''}${q}`);
  };

  const open = (id: string | null) => {
    current = (id && getCustom(id)) || null;
    sel = 0;
    setUrl();
    renderList();
    renderEditor();
  };

  const create = () => {
    const t = save({ id: newCustomId(), name: freeName('Intervals'), sections: starterSections() });
    open(t.id);
    root.querySelector<HTMLInputElement>('[data-f="name"]')?.select();
  };

  /** Save the training being edited; `full` redraws the fields too (else only list and chart). */
  const commit = (full = false) => {
    if (!current) return;
    current = save(current);
    sel = Math.min(sel, current.sections.length - 1);
    renderList();
    if (full) renderEditor(); else { renderChart(); renderTotals(); }
  };

  function renderSub() {
    $('sub').textContent = drive.configured && drive.signedIn ? 'Saved on this device and in your Google Drive'
      : 'Saved in this browser – link Google Drive to have them on every device';
  }

  function renderList() {
    const list = listCustom();
    $('items').innerHTML = list.length ? list.map((t) => `
      <button type="button" class="ct-item${t.id === current?.id ? ' on' : ''}" data-open="${esc(t.id)}">
        ${customIcon(t.sections)}
        <span><b>${esc(t.name)}</b><small>${formatDuration(customDuration(t.sections))} · ${t.sections.length} section${t.sections.length === 1 ? '' : 's'}</small></span>
      </button>`).join('')
      : `<p class="muted-line">No trainings yet.</p>`;
    $('items').querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => { b.onclick = () => open(b.dataset.open!); });
  }

  function renderEditor() {
    const ed = $('edit');
    if (!current) {
      ed.innerHTML = `
        <div class="ct-empty">
          <h2>Build your own workout</h2>
          <p class="muted-line">Set up sections – how long, how many seconds per 500 m slower than your max split and how many strokes under your max stroke rate.
            Every level offers your trainings under "Choose your mode"; there you only set your max split and stroke rate.</p>
          <button type="button" class="btn-navy" data-act="first">${listCustom().length ? 'Pick a training on the left or make a new one' : 'Make your first training'}</button>
        </div>`;
      ed.querySelector<HTMLButtonElement>('[data-act="first"]')!.onclick = create;
      return;
    }
    ed.innerHTML = `
      <div class="ct-head">
        <label class="ct-name"><span>Name</span><input type="text" data-f="name" maxlength="40" autocomplete="off" spellcheck="false"></label>
        <div class="field ct-count"><span>Sections</span><label class="num wide"><input type="number" inputmode="numeric" data-f="count" min="1" max="${CUSTOM_LIMITS.sections}"></label></div>
        <div class="ct-total"><span>Total</span><b data-id="total"></b></div>
      </div>
      <p class="muted-line ct-tip">Tap a bar to change its section.</p>
      <div class="ct-chart" data-id="chart" role="listbox" aria-label="Sections"></div>
      <div class="pv-axis"><span>0:00</span><span data-id="end"></span></div>
      <div class="ct-sec">
        <h3 data-id="secTitle"></h3>
        <div class="fields">
          <div class="field"><span>Length <em data-id="lenText"></em></span><label class="num wide"><input type="number" inputmode="numeric" data-s="sec" min="${CUSTOM_LIMITS.sec[0]}" max="${CUSTOM_LIMITS.sec[1]}" step="5"><small>s</small></label>${steps('sec', 10, 's')}</div>
          <div class="field" title="Seconds per 500 m slower than your max split: 0 = the max itself, 15 = 2:50 at a 2:35 max"><span>Split <em>seconds over max</em></span><label class="num wide"><input type="number" inputmode="numeric" data-s="slower" min="${CUSTOM_LIMITS.slower[0]}" max="${CUSTOM_LIMITS.slower[1]}"><small>+ s</small></label>${steps('slower', 5, 's')}</div>
          <div class="field" title="Strokes per minute under your max stroke rate: 0 = the max itself, 3 = 25 at a max of 28"><span>Stroke rate <em>under max</em></span><label class="num wide"><input type="number" inputmode="numeric" data-s="fewer" min="${CUSTOM_LIMITS.fewer[0]}" max="${CUSTOM_LIMITS.fewer[1]}"><small>− spm</small></label>${steps('fewer', 1, 'spm')}</div>
        </div>
        <p class="muted-line" data-id="example"></p>
        <div class="ct-actions">
          <button type="button" class="ct-btn" data-act="left" title="Move this section earlier">◀ Move</button>
          <button type="button" class="ct-btn" data-act="right" title="Move this section later">Move ▶</button>
          <button type="button" class="ct-btn" data-act="dup" title="Add a section after this one, with the same length, split and stroke rate">Add section</button>
          <button type="button" class="ct-btn danger" data-act="del">Delete section</button>
        </div>
      </div>
      <hr class="rule">
      <div class="ct-foot">
        <button type="button" class="ct-btn" data-act="copy">Copy training</button>
        <button type="button" class="ct-btn danger" data-act="remove">Delete training</button>
      </div>`;

    const name = ed.querySelector<HTMLInputElement>('[data-f="name"]')!;
    name.value = current.name;
    name.oninput = () => { if (current) { current = { ...current, name: name.value }; commit(); } };
    name.onblur = () => { name.value = current?.name ?? ''; };

    const count = ed.querySelector<HTMLInputElement>('[data-f="count"]')!;
    count.onchange = () => {
      if (!current) return;
      const n = Math.max(1, Math.min(CUSTOM_LIMITS.sections, Math.round(Number(count.value)) || current.sections.length));
      const secs = current.sections.slice(0, n);
      while (secs.length < n) secs.push({ ...secs[secs.length - 1] });
      current = { ...current, sections: secs };
      commit(true);
    };
    count.onfocus = () => count.select();

    ed.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((input) => {
      const k = input.dataset.s as keyof CustomSection;
      const [lo, hi] = CUSTOM_LIMITS[k];
      input.oninput = () => {
        const v = Math.round(Number(input.value));
        const ok = input.value.trim() !== '' && Number.isFinite(v) && v >= lo && v <= hi;
        input.classList.toggle('bad', !ok && input.value.trim() !== '');
        if (!ok || !current) return;
        const secs = current.sections.map((s, i) => (i === sel ? { ...s, [k]: v } : s));
        current = { ...current, sections: secs };
        commit();
        renderSection(false);
      };
      input.onblur = () => { input.classList.remove('bad'); renderSection(); };
      input.onfocus = () => input.select();
    });

    ed.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach((b) => {
      b.onclick = () => {
        if (!current) return;
        const k = b.dataset.step as keyof CustomSection;
        const [lo, hi] = CUSTOM_LIMITS[k];
        const by = Number(b.dataset.by);
        const secs = current.sections.map((s, i) => (i === sel ? { ...s, [k]: Math.max(lo, Math.min(hi, s[k] + by)) } : s));
        current = { ...current, sections: secs };
        commit();
        renderSection();
      };
    });

    const act = (a: string, fn: () => void) => { ed.querySelector<HTMLButtonElement>(`[data-act="${a}"]`)!.onclick = fn; };
    const edit = (secs: CustomSection[], nextSel: number) => { if (!current) return; current = { ...current, sections: secs }; sel = nextSel; commit(true); };
    act('left', () => { if (!current || sel === 0) return; const s = [...current.sections]; [s[sel - 1], s[sel]] = [s[sel], s[sel - 1]]; edit(s, sel - 1); });
    act('right', () => { if (!current || sel >= current.sections.length - 1) return; const s = [...current.sections]; [s[sel + 1], s[sel]] = [s[sel], s[sel + 1]]; edit(s, sel + 1); });
    act('dup', () => { if (!current || current.sections.length >= CUSTOM_LIMITS.sections) return; const s = [...current.sections]; s.splice(sel + 1, 0, { ...s[sel] }); edit(s, sel + 1); });
    act('del', () => { if (!current || current.sections.length <= 1) return; const s = current.sections.filter((_, i) => i !== sel); edit(s, Math.min(sel, s.length - 1)); });
    act('copy', () => {
      if (!current) return;
      const t = save({ id: newCustomId(), name: freeName(`${current.name} copy`), sections: current.sections });
      open(t.id);
    });
    act('remove', () => {
      if (!current || !confirm(`Delete "${current.name}"? This removes it on all your devices.`)) return;
      saving = true;
      try { deleteCustom(current.id); } finally { saving = false; }
      open(listCustom()[0]?.id ?? null);
    });

    renderTotals();
    renderChart();
    renderSection();
  }

  function renderTotals() {
    if (!current) return;
    const total = customDuration(current.sections);
    $('total').textContent = formatDuration(total);
    $('end').textContent = formatDuration(total);
    const count = root.querySelector<HTMLInputElement>('[data-f="count"]');
    if (count && document.activeElement !== count) count.value = String(current.sections.length);
  }

  function renderChart() {
    if (!current) return;
    const chart = $('chart');
    // every bar carries its split and stroke rate; narrow bars drop the units ("+20" over "−4")
    const total = customDuration(current.sections) || 1;
    const plotW = Math.max(200, chart.clientWidth - 8);
    let t = 0;
    const scale = intensityScale(current.sections);
    chart.innerHTML = current.sections.map((s, i) => {
      const start = t;
      t += s.sec;
      const wide = (s.sec / total) * plotW >= 52;
      return `<button type="button" role="option" class="ct-bar${i === sel ? ' on' : ''}" data-i="${i}" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}"
        style="flex:${s.sec} 1 0;height:${(barHeight(s) * 100).toFixed(1)}%;--c:${difficultyColor(scale(s))}"
        title="Section ${i + 1} · ${formatDuration(start)}–${formatDuration(t)} · split ${plus(s)} · ${minus(s)}"
        aria-label="Section ${i + 1}: ${formatDuration(s.sec)}, split ${plus(s)}, ${minus(s)}">${sectionLabel(s, wide)}</button>`;
    }).join('');
    chart.querySelectorAll<HTMLButtonElement>('.ct-bar').forEach((b) => {
      b.onclick = () => { sel = Number(b.dataset.i); renderChart(); renderSection(); };
      b.onkeydown = (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d || !current) return;
        e.preventDefault();
        sel = Math.max(0, Math.min(current.sections.length - 1, sel + d));
        renderChart(); renderSection();
        chart.querySelector<HTMLButtonElement>('.ct-bar.on')?.focus();
      };
    });
  }

  /** The selected section's fields (`fill` false: leave the inputs alone while one is typed in). */
  function renderSection(fill = true) {
    if (!current) return;
    const s = current.sections[sel];
    const start = customDuration(current.sections.slice(0, sel));
    $('secTitle').innerHTML = `<i style="background:${difficultyColor(intensityScale(current.sections)(s))}"></i>Section ${sel + 1} of ${current.sections.length} <small>${formatDuration(start)} – ${formatDuration(start + s.sec)}</small>`;
    $('lenText').textContent = formatDuration(s.sec);
    if (fill) root.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((input) => { input.value = String(s[input.dataset.s as keyof CustomSection]); });
    const w = loadSettings();
    const b = customBands(w.customMaxPower, w.customMaxSpm, s);
    const maxSplit = formatPace(customBands(w.customMaxPower, w.customMaxSpm, { slower: 0, fewer: 0 }).pace.target);
    $('example').innerHTML = `With a max of <b>${maxSplit}</b> /500 m and <b>${w.customMaxSpm}</b> spm (set in the level): <b>${formatPace(b.pace.target)}</b> /500 m · <b>${b.spm.target}</b> spm`;
    // step buttons that would go past a limit are off
    root.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach((b) => {
      const k = b.dataset.step as keyof CustomSection;
      const [lo, hi] = CUSTOM_LIMITS[k];
      b.disabled = Number(b.dataset.by) < 0 ? s[k] <= lo : s[k] >= hi;
    });
    const n = current.sections.length;
    root.querySelector<HTMLButtonElement>('[data-act="left"]')!.disabled = sel === 0;
    root.querySelector<HTMLButtonElement>('[data-act="right"]')!.disabled = sel >= n - 1;
    root.querySelector<HTMLButtonElement>('[data-act="del"]')!.disabled = n <= 1;
    root.querySelector<HTMLButtonElement>('[data-act="dup"]')!.disabled = n >= CUSTOM_LIMITS.sections;
  }

  $('new').onclick = create;
  // trainings from Drive (another device): redraw, unless the user is typing right here
  const offCustom = onCustomChanged(() => {
    if (saving) return;
    if (current && root.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') { renderList(); return; }
    const fresh = current ? getCustom(current.id) : null;
    if (current && !fresh) { open(listCustom()[0]?.id ?? null); return; }
    if (fresh && fresh.updatedAt !== current?.updatedAt) { current = fresh; sel = Math.min(sel, fresh.sections.length - 1); renderEditor(); }
    renderList();
  });
  const offDriveState = drive.onChange(renderSub);
  renderSub();

  if (params.has('new')) create();
  else open(initialId ?? listCustom()[0]?.id ?? null);
  drive.requestSync();

  // the labels' units depend on how wide the bars are
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = $('edit').clientWidth; if (w !== lastW) { lastW = w; renderChart(); } });
  ro.observe($('edit'));

  return () => { offFs(); offDrive(); offCustom(); offDriveState(); ro.disconnect(); };
}
