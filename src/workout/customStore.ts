import { cleanSections, type CustomPlan, type CustomSection } from './workout';

/**
 * The user's custom trainings: all of them in one localStorage entry on this device and, when
 * Google Drive is linked, in one custom-trainings.json in the StoryRower folder.
 *
 * Each training keeps its own change time, and a deleted one stays as a marker for a while, so the
 * copies from two devices can be merged training by training (the newer one wins) – a training made
 * on the tablet and another edited on the laptop both survive.
 */
export interface CustomTraining extends CustomPlan {
  updatedAt: string;
  /** deleted: kept as a marker so the deletion reaches the other devices */
  deleted?: true;
}

export interface CustomFile { v: 1; trainings: CustomTraining[] }

const KEY = 'storyrower.customTrainings';
/** Deletion markers older than this are dropped. */
const KEEP_DELETED_MS = 90 * 24 * 3600 * 1000;

function load(): CustomTraining[] {
  try { return parseCustomFile(JSON.parse(localStorage.getItem(KEY) ?? 'null'))?.trainings ?? []; } catch { return []; }
}

function store(list: CustomTraining[]) {
  const cutoff = new Date(Date.now() - KEEP_DELETED_MS).toISOString();
  const file: CustomFile = { v: 1, trainings: list.filter((t) => !t.deleted || t.updatedAt > cutoff) };
  try { localStorage.setItem(KEY, JSON.stringify(file)); } catch { /* storage unavailable */ }
}

const changed = new Set<() => void>();
const edited = new Set<() => void>();
/** Fires after any change: an edit here or trainings that came from Drive (pages redraw). */
export function onCustomChanged(fn: () => void) { changed.add(fn); return () => { changed.delete(fn); }; }
/** Fires after the user changed something on this device (the Drive sync uploads it, debounced). */
export function onCustomEdited(fn: () => void) { edited.add(fn); return () => { edited.delete(fn); }; }

/** The trainings, in the order they were made. */
export function listCustom(): CustomTraining[] { return load().filter((t) => !t.deleted); }

export function getCustom(id: string): CustomTraining | null { return listCustom().find((t) => t.id === id) ?? null; }

/** Add or replace a training (by id). */
export function saveCustom(plan: CustomPlan): CustomTraining {
  const t: CustomTraining = { id: plan.id, name: plan.name.trim() || 'My training', sections: cleanSections(plan.sections), updatedAt: new Date().toISOString() };
  const list = load();
  const i = list.findIndex((x) => x.id === t.id);
  if (i >= 0) list[i] = t; else list.push(t);
  store(list);
  edited.forEach((fn) => fn());
  changed.forEach((fn) => fn());
  return t;
}

export function deleteCustom(id: string) {
  const list = load();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list[i] = { id, name: list[i].name, sections: [], updatedAt: new Date().toISOString(), deleted: true };
  store(list);
  edited.forEach((fn) => fn());
  changed.forEach((fn) => fn());
}

export function newCustomId(): string {
  return `ct-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`;
}

/** A free name: "Intervals", "Intervals 2", … */
export function freeName(base: string): string {
  const names = new Set(listCustom().map((t) => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A new training to start from: warm-up, 4 × 1 min hard / 1 min easy, cool-down. */
export function starterSections(): CustomSection[] {
  const pair: CustomSection[] = [{ sec: 60, slower: 5, fewer: 1 }, { sec: 60, slower: 30, fewer: 4 }];
  return [{ sec: 300, slower: 30, fewer: 4 }, ...pair, ...pair, ...pair, ...pair, { sec: 240, slower: 40, fewer: 6 }];
}

// ---------- Drive ----------

/** Everything on this device (deletion markers included), as the Drive file holds it. */
export function customFile(): CustomFile { return { v: 1, trainings: load() }; }

/** Accepts what Drive gave us; null when it is not a custom-trainings file. */
export function parseCustomFile(json: unknown): CustomFile | null {
  const f = json as Partial<CustomFile> | null;
  if (!f || f.v !== 1 || !Array.isArray(f.trainings)) return null;
  const trainings = f.trainings.filter((t): t is CustomTraining =>
    !!t && typeof t.id === 'string' && typeof t.updatedAt === 'string' && Array.isArray(t.sections) && (t.deleted || t.sections.length > 0));
  return { v: 1, trainings: trainings.map((t) => ({ ...t, name: String(t.name ?? ''), sections: t.deleted ? [] : cleanSections(t.sections) })) };
}

/** Both copies, training by training: the newer one wins; this device's order first. */
export function mergeCustomFiles(local: CustomFile, remote: CustomFile): CustomFile {
  const byId = new Map<string, CustomTraining>();
  for (const t of [...local.trainings, ...remote.trainings]) {
    const have = byId.get(t.id);
    if (!have || t.updatedAt > have.updatedAt) byId.set(t.id, t);
  }
  return { v: 1, trainings: [...byId.values()] };
}

/** The same trainings, regardless of order. */
export function sameCustomFiles(a: CustomFile, b: CustomFile): boolean {
  const key = (f: CustomFile) => JSON.stringify([...f.trainings].sort((x, y) => (x.id < y.id ? -1 : 1)));
  return key(a) === key(b);
}

/** Take over trainings from Drive without counting that as an edit here. */
export function applyCustomFile(f: CustomFile) {
  store(f.trainings);
  changed.forEach((fn) => fn());
}
