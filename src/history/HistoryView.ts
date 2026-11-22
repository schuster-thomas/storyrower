import { saveSettings } from '../app/settings';
import { formatDuration, formatPace, paceFromPower } from '../rower/ftms';
import { drive } from '../cloud/drive';
import { levelById } from '../game/levels';
import { mountResultsChart } from '../game/hud/ResultsChart';
import { bindDriveButton, DRIVE_BUTTON } from '../ui/driveButton';
import { bindFullscreenButton, FS_BUTTON } from '../ui/fullscreen';
import { ICON_BACK, LOGO, MODE_LABELS } from '../ui/icons';
import { cleanSettings, customDuration, type PhaseId, type WorkoutSettings } from '../workout/workout';
import historyCard from '../assets/ui/history-card.svg';
import { getCustom, saveCustom } from '../workout/customStore';
import { getTraining, listTrainings, onHistoryChanged, type StoredTraining } from './store';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const dateLine = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeLine = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const starsHtml = (n: number) => `<span class="h-stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const split = (w: number) => formatPace(paceFromPower(Math.max(1, w)));
/** "Build up", or a custom training's name. */
const modeLine = (r: { mode: WorkoutSettings['mode']; settings: WorkoutSettings }) =>
  r.mode === 'custom' && r.settings.custom ? esc(r.settings.custom.name) : MODE_LABELS[r.mode] ?? r.mode;

/** "#/history" (all trainings) and "#/history/<id>" (one training with its chart and settings). */
export function mountHistory(root: HTMLElement, id: string | null): () => void {
  root.innerHTML = `
    <div class="menu hist">
      <header class="set-bar">
        <a class="back-pill" href="${id ? '#/history' : '#/'}">${ICON_BACK}${id ? 'History' : 'Home'}</a>
        ${LOGO}
        <div class="bar-right">${DRIVE_BUTTON}${FS_BUTTON}</div>
      </header>
      <div class="set-banner">
        <img src="${historyCard}" alt="">
        <div><h1>Training history</h1><p data-id="sub"></p></div>
      </div>
      <main class="hist-page" data-id="body"></main>
    </div>`;
  const body = root.querySelector<HTMLElement>('[data-id="body"]')!;
  const sub = root.querySelector<HTMLElement>('[data-id="sub"]')!;
  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const offDrive = bindDriveButton(root.querySelector<HTMLElement>('.drive-wrap')!);
  let unmountChart: (() => void) | null = null;
  let disposed = false;

  async function render() {
    const list = await listTrainings();
    if (disposed) return;
    unmountChart?.(); unmountChart = null;
    if (id) return renderDetail(await getTraining(id));
    sub.textContent = list.length ? `${list.length} ${list.length === 1 ? 'training' : 'trainings'}` : 'Your finished workouts';
    if (!list.length) {
      body.innerHTML = `<div class="hist-empty"><h2>No trainings yet</h2>
        <p>Every workout you row with your rower is kept here – with its results, the chart and the settings, so you can row it again.</p>
        <p class="muted-line">${drive.configured ? 'Signed in with Google (cloud icon, top right), they are saved to your Google Drive too – and trainings from your other devices show up here.' : ''}</p>
        <a class="btn-navy" href="#/">Choose an adventure</a></div>`;
      return;
    }
    body.innerHTML = `${syncBanner(list)}<div class="hist-list">${list.map(item).join('')}</div>`;
  }

  /** Trainings only on this device: one tap signs in (or renews) and uploads them. */
  function syncBanner(list: StoredTraining[]) {
    if (!drive.configured) return '';
    const local = list.filter((r) => !r.driveId).length;
    if (!local) return '';
    const s = drive.status;
    const busy = s.state === 'syncing' || s.state === 'connecting';
    return `<div class="hist-sync">
      <span><b>${local}</b> ${local === 1 ? 'training is' : 'trainings are'} only on this device.${s.error ? ` <em>${esc(s.error)}</em>` : ''}</span>
      <button class="btn-navy" data-act="upload" ${busy ? 'disabled' : ''}>${busy ? 'Uploading…' : drive.signedIn ? 'Upload to Google Drive' : 'Sign in with Google to upload'}</button>
    </div>`;
  }

  function item(r: StoredTraining) {
    const s = r.summary;
    return `<a class="hist-item" href="#/history/${encodeURIComponent(r.id)}">
      <div class="hi-date"><b>${dateLine(r.startedAt)}</b><span>${timeLine(r.startedAt)}</span></div>
      <div class="hi-main"><b>${esc(r.level.title)}</b><span>${modeLine(r)}${r.early ? ' · ended early' : ''}</span></div>
      <div class="hi-stats">
        <span><b>${formatDuration(s.time)}</b><small>time</small></span>
        <span><b>${Math.round(s.distance)}</b><small>m</small></span>
        <span><b>${s.avgPace ? formatPace(s.avgPace) : '–'}</b><small>/500 m</small></span>
        <span><b>${s.avgSpm}</b><small>spm</small></span>
      </div>
      ${starsHtml(r.stars)}
      <span class="hi-cloud" title="${r.driveId ? 'In Google Drive' : 'Only on this device'}">${r.driveId ? '☁︎' : ''}</span>
    </a>`;
  }

  function renderDetail(r: StoredTraining | null) {
    if (!r) {
      sub.textContent = '';
      body.innerHTML = `<div class="hist-empty"><h2>Training not found</h2><a class="btn-navy" href="#/history">All trainings</a></div>`;
      return;
    }
    const s = r.summary;
    sub.textContent = `${dateLine(r.startedAt)} · ${timeLine(r.startedAt)}`;
    const tile = (value: string, label: string, extra = '') => `<div><b>${value}</b><small>${label}</small>${extra ? `<em>${extra}</em>` : ''}</div>`;
    const level = levelById(r.level.id);
    body.innerHTML = `
      <section class="set-card hist-detail">
        <div class="hd-head">
          <div><h2>${esc(r.level.title)}</h2><p>${modeLine(r)}${r.early ? ' · ended early' : ''}${r.device ? ` · ${esc(r.device)}` : ''}</p></div>
          ${starsHtml(r.stars)}
        </div>
        <div class="hd-results">
          ${tile(`${Math.round(s.distance)} m`, 'distance')}
          ${tile(formatDuration(s.time), 'time', `of ${formatDuration(r.plannedDuration)}`)}
          ${tile(String(s.strokes), 'strokes')}
          ${tile(s.avgPace ? formatPace(s.avgPace) : '–', 'avg split /500 m')}
          ${tile(`${s.avgPower} W`, 'avg power', `max ${s.maxPower} W`)}
          ${tile(`${s.avgSpm}`, 'avg strokes/min')}
          ${s.avgHr != null ? tile(`${s.avgHr}`, 'avg heart rate', `max ${s.maxHr}`) : ''}
          ${s.energy != null ? tile(`${s.energy}`, 'kcal') : ''}
          ${tile(`${Math.round(r.accuracy * 100)}%`, 'in target band')}
        </div>
        <div class="hd-chart"></div>
        <h2 class="hd-sub">Settings</h2>
        <dl class="hd-settings">${settingsRows(r.settings)}</dl>
        <div class="hd-actions">
          ${level ? `<button class="btn-navy" data-act="again">Row again with these settings</button>` : ''}
          <span class="muted-line">${r.driveId ? 'Saved in Google Drive' : 'Saved on this device only'}</span>
          ${!r.driveId && drive.configured ? `<button class="hd-upload" data-act="upload">${drive.signedIn ? 'Upload to Google Drive' : 'Sign in with Google to upload'}</button>` : ''}
        </div>
      </section>`;
    if (r.points.length > 1) {
      unmountChart = mountResultsChart(body.querySelector<HTMLElement>('.hd-chart')!, r.points, (p: PhaseId) => level?.phases[p]?.name ?? p);
    }
    body.querySelector<HTMLButtonElement>('[data-act="again"]')?.addEventListener('click', () => {
      // a custom training that was deleted since comes back, so it can be rowed (and changed) again
      const c = r.settings.mode === 'custom' ? r.settings.custom : undefined;
      if (c && !getCustom(c.id)) saveCustom(c);
      saveSettings(cleanSettings(r.settings));
      location.hash = `#/play/${r.level.id}`;
    });
  }

  function settingsRows(w: WorkoutSettings) {
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    if (w.mode === 'custom' && w.custom) {
      const c = w.custom;
      return [
        row('Mode', `Custom · ${esc(c.name)}`),
        row('Duration', `${formatDuration(customDuration(c.sections))} · ${c.sections.length} sections`),
        row('Max split', `${split(w.customMaxPower)} /500 m <small>${Math.round(w.customMaxPower)} W</small>`),
        row('Max stroke rate', `${w.customMaxSpm} spm`),
      ].join('');
    }
    return [
      row('Mode', MODE_LABELS[w.mode] ?? w.mode),
      row('Duration', `${w.durationMin} min`),
      row('Peak split', `${split(w.maxPower)} /500 m <small>${Math.round(w.maxPower)} W</small>`),
      row('Peak stroke rate', `${w.maxSpm} spm`),
    ].join('');
  }

  // the upload buttons (banner and detail): sign in or renew right from this tap, then sync
  body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act="upload"]');
    if (!b || b.disabled) return;
    b.disabled = true;
    b.textContent = 'Uploading…';
    void drive.connect().then(() => render());
  });
  const offHistory = onHistoryChanged(() => void render());
  // the banner follows the sign-in state (renewed elsewhere, sync finished, an error)
  const offDriveState = drive.onChange(() => { if (!id) void render(); });
  void render();
  // trainings from other devices: now, or on the next tap once the sign-in is renewed
  drive.requestSync();

  return () => { disposed = true; offHistory(); offDriveState(); offFs(); offDrive(); unmountChart?.(); };
}
