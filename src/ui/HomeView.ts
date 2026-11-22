import { connection } from '../app/connection';
import { LEVELS } from '../game/levels';
import { BluetoothSource, isWebBluetoothAvailable } from '../rower/sources/bluetooth';
import { LOGO } from './icons';
import { bindFullscreenButton, FS_BUTTON } from './fullscreen';
import rowerCard from '../assets/ui/rower-card.webp';
import historyCard from '../assets/ui/history-card.svg';
import customCard from '../assets/ui/custom-card.webp';
import { bindDriveButton, DRIVE_BUTTON } from './driveButton';

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
          ${DRIVE_BUTTON}
          ${FS_BUTTON}
        </div>
      </header>
      <main class="menu-page">
        <h1 class="menu-title">Choose your adventure</h1>
        <div class="tile-grid">
          ${LEVELS.map((l) => tile(`#/play/${l.id}`, l.art, l.title, l.tagline)).join('')}
          ${tile('#/custom', customCard, 'Customize trainings', 'Build your own workouts section by section – then row them in any adventure.')}
          ${tile('#/history', historyCard, 'Training history', 'Every workout you rowed – results, charts and settings to row it again.')}
          ${tile('#/diagnose', rowerCard, 'Devices &amp; Diagnostics', 'Connect your rower, check live data or try the simulator.')}
        </div>
      </main>
      <footer class="menu-foot"><a href="privacy.html">Privacy</a></footer>
    </div>`;

  const offFs = bindFullscreenButton(root.querySelector<HTMLButtonElement>('[data-fs]')!);
  const offDrive = bindDriveButton(root.querySelector<HTMLElement>('.drive-wrap')!);
  const btn = root.querySelector<HTMLButtonElement>('[data-id="connect"]')!;
  const render = () => {
    const s = connection.session;
    const connected = s?.state === 'connected';
    // the one button up here: connect the rower, or disconnect whatever is running (rower, simulator, replay)
    const a = connection.active;
    btn.textContent = !a ? 'Connect rower' : a.state === 'connecting' ? 'Cancel connecting' : `Disconnect ${a.label}`;
    btn.title = !a ? (isWebBluetoothAvailable() ? '' : 'No Web Bluetooth in this browser – use Chrome or Edge')
      : a.label === 'rower' && connected ? `${(s?.source as BluetoothSource).deviceName ?? 'Rower'} connected – tap to disconnect` : '';
    btn.disabled = !a && !isWebBluetoothAvailable();
    btn.classList.toggle('ok', connected);
  };
  btn.onclick = () => { if (connection.active) connection.disconnect(); else void connection.use(new BluetoothSource(false)); };

  let offSession: (() => void) | null = null;
  const follow = () => { offSession?.(); offSession = connection.session?.on((e) => { if (e.type === 'state') render(); }) ?? null; render(); };
  const offConn = connection.onChange(follow);
  follow();
  return () => { offConn(); offSession?.(); offFs(); offDrive(); };
}
