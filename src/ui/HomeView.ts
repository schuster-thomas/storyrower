import { connection } from '../app/connection';
import { LEVELS } from '../game/levels';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { SimulatorSource } from '../rower/sources/simulator';
import { ICON_GEAR, LOGO } from './icons';
import { bindFullscreenButton, FS_BUTTON } from './fullscreen';
import icelandCard from '../assets/ui/iceland-card.webp';
import rowerCard from '../assets/ui/rower-card.webp';

/** Tile art per level id. */
const LEVEL_ART: Record<string, string> = { 'iceland-volcano-run': icelandCard };

/** "#/": pick a level (only levels that exist), or go to devices & diagnostics. */
export function mountHome(root: HTMLElement): () => void {
  const tile = (href: string, img: string, title: string, text: string) => `
    <a class="tile-card" href="${href}">
      <div class="tile-img"><img src="${img}" alt="" loading="lazy"></div>
      <div class="tile-text"><h2>${title}</h2><p>${text}</p></div>
    </a>`;
  root.innerHTML = `
    <div class="menu">
      <header class="menu-bar">
        <a href="#/" class="menu-logo">${LOGO}</a>
        <div class="menu-bar-right">
          <button class="btn-navy" data-id="connect">Connect rower</button>
          ${FS_BUTTON}
          <a class="icon-btn" href="#/diagnose" title="Devices &amp; diagnostics" aria-label="Devices &amp; diagnostics">${ICON_GEAR}</a>
        </div>
      </header>
      <main class="menu-page">
        <h1 class="menu-title">Choose your adventure</h1>
        <div class="tile-grid">
          ${LEVELS.map((l) => tile(`#/play/${l.id}`, LEVEL_ART[l.id] ?? icelandCard, l.title, l.tagline)).join('')}
          ${tile('#/diagnose', rowerCard, 'Devices &amp; Diagnostics', 'Connect your rower, check live data or try the simulator.')}
        </div>
      </main>
    </div>`;

  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const btn = root.querySelector<HTMLButtonElement>('[data-id="connect"]')!;
  const render = () => {
    const s = connection.session;
    const connected = s?.state === 'connected';
    btn.textContent = !s ? 'Connect rower'
      : s.source instanceof SimulatorSource ? (connected ? 'Simulator ready' : 'Simulator…')
      : connected ? 'Rower connected' : s.state === 'connecting' ? 'Connecting…' : 'Connect rower';
    btn.classList.toggle('ok', connected);
  };
  if (!isWebBluetoothAvailable()) { btn.disabled = true; btn.title = 'No Web Bluetooth in this browser – use Chrome or Edge'; }
  btn.onclick = () => { if (connection.session?.state !== 'connected') void connection.use(new BluetoothSource(false)); };

  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') render(); }) ?? null; render(); };
  const offConn = connection.onChange(follow);
  follow();
  return () => { offConn(); offSession?.(); offFs(); };
}
