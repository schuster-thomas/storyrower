import { drive, type DriveStatus } from '../cloud/drive';
import { DRIVE_FOLDER } from '../cloud/config';

const CLOUD = `<path d="M7.2 18.5h10.3a4.1 4.1 0 0 0 .6-8.15 6.1 6.1 0 0 0-11.6-1.6A4.9 4.9 0 0 0 7.2 18.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`;
const BADGES: Partial<Record<DriveStatus['state'], string>> = {
  synced: `<path d="M9.2 13.4l2 2 3.8-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  syncing: `<path d="M12 10.2v5.6m0-5.6-2.2 2.2m2.2-2.2 2.2 2.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  connecting: `<path d="M12 10.2v5.6m0-5.6-2.2 2.2m2.2-2.2 2.2 2.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  'needs-login': `<path d="M12 10v3.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.1" r="1.2" fill="currentColor"/>`,
  error: `<path d="M12 10v3.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.1" r="1.2" fill="currentColor"/>`,
  'signed-out': `<path d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  unconfigured: `<path d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
};

/** Cloud icon for the top right of the menu pages: Google Drive status, tap for details. */
export const DRIVE_BUTTON = `<div class="drive-wrap"><button type="button" class="icon-btn drive-btn" data-drive aria-haspopup="dialog" aria-expanded="false"></button><div class="drive-pop" role="dialog" hidden></div></div>`;

const TITLES: Record<DriveStatus['state'], string> = {
  unconfigured: 'Google Drive – not set up yet',
  'signed-out': 'Google Drive – not signed in',
  connecting: 'Google Drive – signing in…',
  syncing: 'Google Drive – syncing…',
  synced: 'Google Drive – synced',
  'needs-login': 'Google Drive – sign in again to sync',
  error: 'Google Drive – sync problem',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'never');

export function bindDriveButton(wrap: HTMLElement): () => void {
  const btn = wrap.querySelector<HTMLButtonElement>('[data-drive]')!;
  const pop = wrap.querySelector<HTMLElement>('.drive-pop')!;
  drive.preload();

  const renderPop = (s: DriveStatus) => {
    const what = `Your trainings and settings are saved to a “${DRIVE_FOLDER}” folder in your Google Drive. StoryRower only sees the files it created there.`;
    const waiting = s.pending ? `<p><b>${s.pending}</b> ${s.pending === 1 ? 'training waits' : 'trainings wait'} to be uploaded.</p>` : '';
    const err = s.error ? `<p class="drive-err">${esc(s.error)}</p>` : '';
    let body = '';
    switch (s.state) {
      case 'unconfigured':
        body = `<h3>Google Drive</h3><p>Saving to Google Drive is not set up yet. Your trainings are kept in the history on this device.</p>`;
        break;
      case 'signed-out':
        body = `<h3>Google Drive</h3><p>${what}</p>${waiting}${err}<button class="btn-navy" data-act="signin">Sign in with Google</button>`;
        break;
      case 'needs-login':
        body = `<h3>Google Drive</h3><p>${s.email ? esc(s.email) + ' – ' : ''}the sign-in has run out. Sign in again to sync.</p>${waiting}${err}<button class="btn-navy" data-act="signin">Sign in again</button><button class="drive-link" data-act="signout">Sign out</button>`;
        break;
      case 'connecting':
        body = `<h3>Google Drive</h3><p>Signing in – finish it in the Google window.</p>`;
        break;
      default:
        body = `<h3>Google Drive</h3><p>${s.email ? `Signed in as <b>${esc(s.email)}</b>` : 'Signed in'}</p>
          <p class="drive-meta">${s.state === 'syncing' ? 'Syncing…' : `Last sync: ${time(s.lastSync)}`}</p>${waiting}${err}
          <button class="btn-navy" data-act="sync" ${s.state === 'syncing' ? 'disabled' : ''}>Sync now</button><button class="drive-link" data-act="signout">Sign out</button>`;
    }
    pop.innerHTML = body;
  };

  const render = (s: DriveStatus) => {
    btn.dataset.state = s.state;
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CLOUD}${BADGES[s.state] ?? ''}</svg>${s.pending && s.state !== 'unconfigured' ? `<span class="drive-count">${s.pending}</span>` : ''}`;
    btn.title = TITLES[s.state];
    btn.setAttribute('aria-label', TITLES[s.state]);
    if (!pop.hidden) renderPop(s);
  };

  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = () => {
    if (!pop.hidden) { close(); return; }
    renderPop(drive.status);
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  pop.onclick = (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'signin') void drive.signIn();       // straight from the tap: the browser allows the Google window
    else if (act === 'sync') void drive.connect();
    else if (act === 'signout') { drive.signOut(); close(); }
  };
  const onDoc = (e: PointerEvent) => { if (!wrap.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('pointerdown', onDoc);
  document.addEventListener('keydown', onKey);
  const off = drive.onChange(render);
  render(drive.status);
  return () => { off(); document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
}
