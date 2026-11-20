import { drive } from '../cloud/drive';
import type { TrainingRecord } from './history';
import { putTraining } from './store';

export type SaveResult = 'uploaded' | 'waiting' | 'local' | 'failed';

/** Keep a finished training on this device and, when signed in, in Google Drive. */
export async function saveTraining(r: TrainingRecord): Promise<SaveResult> {
  try { await putTraining(r); } catch { return 'failed'; }
  const d = await drive.trainingSaved().catch(() => 'waiting' as const);
  return d === 'off' ? 'local' : d;
}

export const SAVE_TEXT: Record<SaveResult, string> = {
  uploaded: 'Saved to your history and Google Drive.',
  waiting: 'Saved to your history on this device – not in Google Drive yet.',
  local: 'Saved to your history on this device.',
  failed: 'Could not save this training on this device.',
};

/**
 * The line under the results: where the training went, and – when it is not in Google Drive yet –
 * a button that signs in (or renews the sign-in) and uploads it right there.
 */
export function showSaveResult(el: HTMLElement, result: SaveResult) {
  const canUpload = drive.configured && (result === 'waiting' || result === 'local');
  el.hidden = false;
  el.dataset.result = result;
  el.innerHTML = `<span></span>${canUpload ? ` <button type="button" class="save-upload">${drive.signedIn ? 'Upload to Google Drive' : 'Save to Google Drive'}</button>` : ''}`;
  el.querySelector('span')!.textContent = SAVE_TEXT[result];
  const btn = el.querySelector<HTMLButtonElement>('.save-upload');
  if (!btn) return;
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    void drive.connect().then(() => {
      const s = drive.status;
      if (s.state === 'synced' && s.pending === 0) { showSaveResult(el, 'uploaded'); return; }
      btn.disabled = false;
      btn.textContent = drive.signedIn ? 'Upload to Google Drive' : 'Save to Google Drive';
      if (s.error) el.querySelector('span')!.textContent = `${SAVE_TEXT[result]} ${s.error}`;
    });
  };
}
