const FS_ICON = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const FS_ENTER_ICON = FS_ICON('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5');
const FS_EXIT_ICON = FS_ICON('M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5');

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/**
 * Turns a button into a fullscreen on/off toggle (whole page, so it stays on across screens).
 * The button stays hidden where the browser has no Fullscreen API (e.g. iPhone, some in-app browsers).
 * Returns a cleanup; the listeners also drop themselves once the button is gone from the page.
 */
export function bindFullscreenButton(b: HTMLButtonElement): () => void {
  const doc = document as FsDocument;
  const root = document.documentElement as FsElement;
  b.hidden = true;
  if (!(document.fullscreenEnabled || doc.webkitFullscreenEnabled)) return () => {};
  const isFs = () => !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
  const off = () => {
    document.removeEventListener('fullscreenchange', render);
    document.removeEventListener('webkitfullscreenchange', render);
  };
  function render() {
    if (!b.isConnected && b.innerHTML) { off(); return; }
    b.innerHTML = isFs() ? FS_EXIT_ICON : FS_ENTER_ICON;
    b.title = isFs() ? 'Exit fullscreen' : 'Fullscreen';
  }
  document.addEventListener('fullscreenchange', render);
  document.addEventListener('webkitfullscreenchange', render);
  b.onclick = () => {
    try {
      if (isFs()) {
        if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
        else doc.webkitExitFullscreen?.();
      } else if (root.requestFullscreen) {
        void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      } else root.webkitRequestFullscreen?.();
    } catch { /* not allowed here */ }
  };
  b.setAttribute('aria-label', 'Fullscreen on/off');
  b.hidden = false;
  render();
  return off;
}

/** Markup for the menu screens' fullscreen button (wire it up with bindFullscreenButton). */
export const FS_BUTTON = `<button type="button" class="icon-btn fs-btn" data-fs hidden></button>`;
