import { connection } from '../app/connection';

const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11m0-11-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/** Disconnect button for the top right of a page header – hidden while nothing is connected. */
export const DISCONNECT_BUTTON = `<button class="disc-btn" data-disc hidden>${ICON_X}<span>Disconnect</span></button>`;

/**
 * Keeps the button in step with the shared connection: shown while a rower, the simulator or a
 * replay is connected or connecting ("Cancel" then), and disconnects it. Returns the cleanup.
 */
export function bindDisconnectButton(btn: HTMLButtonElement): () => void {
  const render = () => {
    const a = connection.active;
    btn.hidden = !a;
    if (!a) return;
    const text = a.state === 'connecting' ? 'Cancel' : 'Disconnect';
    btn.querySelector('span')!.textContent = text;
    btn.title = a.state === 'connecting' ? `Cancel connecting the ${a.label}` : `Disconnect the ${a.label}`;
    btn.setAttribute('aria-label', btn.title);
  };
  btn.onclick = () => connection.disconnect();
  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') render(); }) ?? null; render(); };
  const offConn = connection.onChange(follow);
  follow();
  return () => { offConn(); offSession?.(); };
}
