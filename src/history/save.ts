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
  waiting: 'Saved to your history – it goes to Google Drive once you sign in again (cloud icon on the menu pages).',
  local: 'Saved to your history on this device.',
  failed: 'Could not save this training on this device.',
};
