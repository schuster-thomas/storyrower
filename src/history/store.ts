import { sortTrainings, type TrainingRecord } from './history';

/**
 * The training history on this device, in IndexedDB (a 30 min training with its chart trace is
 * ~200 KB – too much for localStorage). Each record also remembers whether it is in Google Drive.
 */

export interface StoredTraining extends TrainingRecord {
  /** Drive file id once uploaded */
  driveId?: string;
}

const DB = 'storyrower';
const STORE = 'trainings';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

const listeners = new Set<() => void>();
/** Fires when a training was added or changed (the history page re-renders). */
export function onHistoryChanged(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => listeners.forEach((fn) => fn());
/** After a batch of silent updates (e.g. a Drive sync marked records as uploaded). */
export const notifyHistoryChanged = changed;

/** All trainings on this device, newest first (empty when storage is not available). */
export async function listTrainings(): Promise<StoredTraining[]> {
  try { return sortTrainings(await tx<StoredTraining[]>('readonly', (s) => s.getAll())) as StoredTraining[]; } catch { return []; }
}

export async function getTraining(id: string): Promise<StoredTraining | null> {
  try { return (await tx<StoredTraining | undefined>('readonly', (s) => s.get(id))) ?? null; } catch { return null; }
}

export async function putTraining(r: StoredTraining, notify = true): Promise<void> {
  await tx('readwrite', (s) => s.put(r));
  if (notify) changed();
}

export async function putTrainings(list: StoredTraining[]): Promise<void> {
  for (const r of list) await putTraining(r, false);
  if (list.length) changed();
}

/**
 * Deleted trainings, remembered on this device (localStorage, ids only) until the next Drive sync
 * has trashed their files and told the other devices – and kept after that, so a copy that turns
 * up again later (an old device, a restored file) is not brought back.
 */
const DELETED_KEY = 'storyrower.deletedTrainings';

export function deletedTrainingIds(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : []);
  } catch { return new Set(); }
}

export function rememberDeleted(ids: Iterable<string>) {
  const all = deletedTrainingIds();
  const before = all.size;
  for (const id of ids) all.add(id);
  if (all.size === before) return;
  try { localStorage.setItem(DELETED_KEY, JSON.stringify([...all])); } catch { /* ignore */ }
}

/** Remove trainings from this device only (a sync found them deleted elsewhere). */
export async function removeTrainings(ids: string[], notify = true): Promise<void> {
  for (const id of ids) await tx('readwrite', (s) => s.delete(id));
  if (notify && ids.length) changed();
}

/** Delete a training here; the next Drive sync trashes its file and removes it on the other devices. */
export async function deleteTraining(id: string): Promise<void> {
  rememberDeleted([id]);
  await removeTrainings([id]);
}
