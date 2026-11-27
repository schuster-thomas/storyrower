import type { TracePoint, WorkoutSummary } from '../workout/trace';
import type { WorkoutMode, WorkoutSettings } from '../workout/workout';

/**
 * One finished training, as kept on this device and in Google Drive (one JSON file each).
 * Everything the history page needs: when, which level and mode, the settings it was rowed
 * with, the results and the one-point-per-second trace for the chart.
 */
export interface TrainingRecord {
  v: 1;
  /** unique and sortable: start time plus a random tail */
  id: string;
  startedAt: string;
  finishedAt: string;
  level: { id: string; title: string };
  mode: WorkoutMode;
  settings: WorkoutSettings;
  /** planned length of the workout (s) */
  plannedDuration: number;
  /** ended before the workout was over */
  early: boolean;
  /** rower name (or "Simulator") */
  device: string | null;
  summary: WorkoutSummary;
  /** 0–1 share of time in the target bands */
  accuracy: number;
  stars: 0 | 1 | 2 | 3;
  points: TracePoint[];
}

/** Shorter than this (s of rowing) is not worth keeping – a test start, a mis-tap. */
export const MIN_TRAINING_SECONDS = 60;

export function newTrainingId(startedAt: Date, random = Math.random): string {
  return `${startedAt.toISOString().replace(/[:.]/g, '-')}-${Math.floor(random() * 0xffff).toString(16).padStart(4, '0')}`;
}

/** Newest first. */
export function sortTrainings(list: TrainingRecord[]): TrainingRecord[] {
  return [...list].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? 1 : -1));
}

/** Union of two lists by id (the first one wins on a clash), newest first. */
export function mergeTrainings(a: TrainingRecord[], b: TrainingRecord[]): TrainingRecord[] {
  const byId = new Map<string, TrainingRecord>();
  for (const r of [...b, ...a]) byId.set(r.id, r);
  return sortTrainings([...byId.values()]);
}

/**
 * The ids of deleted trainings, kept in Drive as deleted-trainings.json: a device that still has
 * a deleted training removes it on its next sync instead of uploading it again.
 */
export interface DeletedTrainingsFile { v: 1; ids: string[] }

/** Accepts what Drive gave us; an empty list when it is not a deleted-trainings file. */
export function parseDeletedFile(json: unknown): string[] {
  const f = json as Partial<DeletedTrainingsFile> | null;
  if (!f || f.v !== 1 || !Array.isArray(f.ids)) return [];
  return f.ids.filter((id): id is string => typeof id === 'string');
}

/** Accepts what a file or Drive gave us; null when it is not a training record. */
export function parseTraining(json: unknown): TrainingRecord | null {
  const r = json as Partial<TrainingRecord> | null;
  if (!r || r.v !== 1 || typeof r.id !== 'string' || typeof r.startedAt !== 'string' || !r.summary || !Array.isArray(r.points)) return null;
  return r as TrainingRecord;
}
