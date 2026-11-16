import './ui/styles.css';
import { mountDiagnostics } from './diagnostics/DiagnosticsView';

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
        <a class="card disabled" href="#/"><b>🌋 Iceland Volcano Run</b><span class="muted">Coming in milestones 2–4</span></a>
        <a class="card" href="#/diagnose"><b>🔌 Device &amp; diagnostics</b><span class="muted">Connect, live values, recording, simulator</span></a>
      </div>
      <p class="muted">Original PoC test page: <a href="poc/ble/">poc/ble</a></p>
    </div>`;
  return () => {};
}

function route() {
  cleanup?.();
  app.innerHTML = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  cleanup = hash.startsWith('/diagnose') ? mountDiagnostics(app) : home(app);
}

window.addEventListener('hashchange', route);
route();
