import './ui/styles.css';
import './ui/menu.css';
import './game/game.css';
import { mountDiagnostics } from './diagnostics/DiagnosticsView';
import { mountPlay } from './game/SetupView';
import { LEVELS, levelById } from './game/levels';
import { mountHome } from './ui/HomeView';
import { mountHistory } from './history/HistoryView';
import { drive } from './cloud/drive';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function route() {
  cleanup?.();
  app.innerHTML = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  const path = hash.split('?')[0];
  if (path.startsWith('/diagnose')) cleanup = mountDiagnostics(app);
  // '#/history' lists every training, '#/history/<id>' shows one
  else if (path.startsWith('/history')) cleanup = mountHistory(app, decodeURIComponent(path.split('/')[2] ?? '') || null);
  // "#/play/<level id>" – plain "#/play" (old links) opens the first level
  else if (path.startsWith('/play')) cleanup = mountPlay(app, levelById(path.split('/')[2]) ?? LEVELS[0]);
  else cleanup = mountHome(app);
  scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
// count trainings waiting for Google Drive, and sync right away if the last sign-in is still valid
void drive.init();
