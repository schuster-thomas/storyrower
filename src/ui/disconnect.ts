import { connection } from '../app/connection';

const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11m0-11-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/**
 * Turns the status pill at the top right of a page into the disconnect button as well: while a
 * rower, the simulator or a replay is connected (or connecting) it shows an ✕ and a tap
 * disconnects it ("Cancel" while connecting). The page keeps writing the status text into the
 * pill's first <span>; this only adds the ✕ and the tap. Returns the cleanup.
 */
export function bindDisconnectPill(pill: HTMLElement): () => void {
  let x = pill.querySelector<HTMLElement>('.pill-x');
  if (!x) {
    x = document.createElement('i');
    x.className = 'pill-x';
    x.innerHTML = ICON_X;
    pill.appendChild(x);
  }
  const render = () => {
    const a = connection.active;
    pill.dataset.disc = a ? 'on' : 'off';
    const title = !a ? '' : a.state === 'connecting' ? `Cancel connecting the ${a.label}` : `Disconnect the ${a.label}`;
    pill.title = title;
    if (title) pill.setAttribute('aria-label', `${pill.querySelector('span')?.textContent ?? ''} – ${title}`); else pill.removeAttribute('aria-label');
  };
  pill.onclick = () => { if (connection.active) connection.disconnect(); };
  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') render(); }) ?? null; render(); };
  const offConn = connection.onChange(follow);
  follow();
  return () => { offConn(); offSession?.(); };
}
