import './ui/styles.css';
import { mountDiagnostics } from './diagnostics/DiagnosticsView';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function home(root: HTMLElement) {
  root.innerHTML = `
    <div class="hero">
      <div>
        <h1>StoryRower</h1>
        <p class="muted">Rudern als erlebte Geschichte. Deine Live-Daten vom Rudergerät treiben das Abenteuer an.</p>
      </div>
      <div class="cards">
        <a class="card disabled" href="#/"><b>🌋 Iceland Volcano Run</b><span class="muted">Kommt in Meilenstein 2–4</span></a>
        <a class="card" href="#/diagnose"><b>🔌 Gerät &amp; Diagnose</b><span class="muted">Verbinden, Live-Werte, Aufzeichnen, Simulator</span></a>
      </div>
      <p class="muted">Alte PoC-Testseite: <a href="poc/ble/">poc/ble</a></p>
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
