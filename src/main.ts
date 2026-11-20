import './ui/styles.css';
import './game/game.css';
import { mountDiagnostics } from './diagnostics/DiagnosticsView';
import { mountPlay } from './game/SetupView';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function home(root: HTMLElement) {
  root.innerHTML = `
    <div class="hero">
      <div>
        <h1>StoryRower</h1>
        <p class="muted">Rowing as a story you live through. Live data from your rowing machine drives the adventure.</p>
      </div>
      <div class="cards">
        <a class="card" href="#/play"><b>🌋 Iceland Volcano Run</b><span class="muted">Greybox preview – story, graphics and sound follow</span></a>
        <a class="card" href="#/diagnose"><b>🔌 Device &amp; diagnostics</b><span class="muted">Connect, live values, recording, simulator</span></a>
      </div>
    </div>`;
  return () => {};
}

function route() {
  cleanup?.();
  app.innerHTML = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  cleanup = hash.startsWith('/diagnose') ? mountDiagnostics(app) : hash.startsWith('/play') ? mountPlay(app) : home(app);
}

window.addEventListener('hashchange', route);
route();
