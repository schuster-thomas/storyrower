import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/AudioEngine';
import { loadGraphics, saveGraphics, type GraphicsSettings } from '../game/scene/quality';
import { DEFAULT_SETTINGS, type WorkoutSettings } from '../workout/workout';

/**
 * The user's settings in one place: the workout settings (setup screen), sound and graphics.
 * Each part keeps its own localStorage key; this module adds a change time so the copy in
 * Google Drive and the one on this device can be compared (newer wins).
 */

const WORKOUT_KEY = 'storyrower.settings';
const UPDATED_KEY = 'storyrower.settingsUpdatedAt';

const MIN_SECTION_KEY = 'storyrower.minSection120';

export function loadSettings(): WorkoutSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKOUT_KEY) ?? '{}') as Partial<WorkoutSettings>;
    // once: the shortest section used to default to 30 s – whoever still has that gets the new 120 s
    if (!localStorage.getItem(MIN_SECTION_KEY)) {
      localStorage.setItem(MIN_SECTION_KEY, '1');
      if (stored.minSegmentSec === 30) { stored.minSegmentSec = DEFAULT_SETTINGS.minSegmentSec; localStorage.setItem(WORKOUT_KEY, JSON.stringify(stored)); }
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: WorkoutSettings) {
  try { localStorage.setItem(WORKOUT_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  markSettingsChanged();
}

/** Everything that is synced, as one object. */
export interface SettingsSnapshot {
  updatedAt: string;
  workout: WorkoutSettings;
  audio: AudioSettings;
  graphics: GraphicsSettings;
}

export function settingsSnapshot(): SettingsSnapshot {
  return { updatedAt: settingsUpdatedAt(), workout: loadSettings(), audio: loadAudioSettings(), graphics: loadGraphics() };
}

/** Take over settings from elsewhere (Drive) without counting that as a local change. */
export function applySettingsSnapshot(s: SettingsSnapshot) {
  try { localStorage.setItem(WORKOUT_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...s.workout })); } catch { /* ignore */ }
  if (s.audio) saveAudioSettings(s.audio);
  if (s.graphics) saveGraphics(s.graphics);
  try { localStorage.setItem(UPDATED_KEY, s.updatedAt); } catch { /* ignore */ }
}

/** When the settings on this device last changed (ISO); the epoch when never. */
export function settingsUpdatedAt(): string {
  try { return localStorage.getItem(UPDATED_KEY) ?? new Date(0).toISOString(); } catch { return new Date(0).toISOString(); }
}

const listeners = new Set<() => void>();
/** Fires after the user changed a setting (the Drive sync uploads them, debounced). */
export function onSettingsChanged(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

export function markSettingsChanged() {
  try { localStorage.setItem(UPDATED_KEY, new Date().toISOString()); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}
