import type { EffectId } from '../story/story';
import type { WorkoutMode } from '../workout/workout';

/** Small inline SVGs for the menu screens (no icon font, no extra requests). */

export const LOGO_MARK = `<svg class="logo-mark" viewBox="0 0 48 32" aria-hidden="true">
  <circle cx="24" cy="5" r="4" fill="currentColor"/>
  <path d="M15 19 L22 10.5 L31 15.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 12.5 L38 21" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M2 26 C13 18.5 29 18.5 46 22.5 C32 21.8 17 24 5 30 Z" fill="var(--teal)"/>
</svg>`;

export const LOGO = `<span class="logo">${LOGO_MARK}<b>StoryRower</b></span>`;

export const ICON_GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/></svg>`;
export const ICON_BT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10-5 4V3l5 4L7 17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON_BACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON_HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
export const ICON_ROWER = `<svg viewBox="0 0 32 24" aria-hidden="true"><circle cx="17" cy="5" r="2.6" fill="currentColor"/><path d="M10 15l5.5-6 6 3.4M5 10l22 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 20c8-4 18-4 28-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
export const ICON_CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON_ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Mode pictograms: the shape of the training curve. */
export const MODE_ICONS: Record<WorkoutMode, string> = {
  story: `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M8 8c9-2.5 18-1.5 24 3 6-4.5 15-5.5 24-3v23c-9-2.5-18-1.5-24 3-6-4.5-15-5.5-24-3Z M32 11v23" fill="none" stroke="var(--ink)" stroke-width="3.2" stroke-linejoin="round"/><path d="M6 36c9-3 19-2 26 1.5 7-3.5 17-4.5 26-1.5" fill="none" stroke="var(--teal)" stroke-width="3" stroke-linecap="round"/></svg>`,
  steady: `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M6 20h52" fill="none" stroke="var(--teal)" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  buildup: `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M6 32 58 8" fill="none" stroke="var(--teal)" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  pyramid: `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M6 32 32 8l26 24" fill="none" stroke="var(--teal)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  waves: `<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M4 24C9 8 17 8 22 20s13 12 18 0 13-12 20 4" fill="none" stroke="var(--teal)" stroke-width="3.4" stroke-linecap="round"/></svg>`,
};

export const MODE_LABELS: Record<WorkoutMode, string> = { story: 'Story', steady: 'Steady', buildup: 'Build up', pyramid: 'Pyramid', waves: 'Waves' };

/** What the targets do in each mode (the level adds what happens in the story). */
export const MODE_HINTS: Record<WorkoutMode, string> = {
  story: 'Targets follow the story: warm-up, build-up, intervals, a final sprint and a cool-down.',
  steady: 'The same targets from start to finish.',
  buildup: 'Targets get harder step by step, up to the peak at the end.',
  pyramid: 'Hardest targets in the middle, easy at both ends.',
  waves: 'Up and down: hard and easy stretches in turn.',
};

/** White glyphs for story moments on the workout preview (16×16). */
export const BEAT_ICONS: Record<EffectId, string> = {
  calm: `<path d="M1.5 13 6 6.5l2.6 3.4L10.5 8l4 5Z" fill="#fff"/>`,
  birds: `<path d="M1.5 8.5Q4 5.5 6.5 8.5Q9 5.5 11.5 8.5M8 4.5q1.6-1.8 3.2 0q1.6-1.8 3.2 0" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
  tremor: `<path d="M1 8.5 3.5 5l3 7 3-7 3 7 2.5-3.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  calving: `<path d="M3.5 13.5 4.5 5 10 2.5l2.5 6-1 5Z" fill="#fff"/>`,
  ash: `<circle cx="4.5" cy="5" r="1.4" fill="#fff"/><circle cx="10" cy="4" r="1.2" fill="#fff"/><circle cx="7.5" cy="9" r="1.4" fill="#fff"/><circle cx="12" cy="10" r="1.2" fill="#fff"/><circle cx="4" cy="12" r="1.1" fill="#fff"/>`,
  eruption: `<path d="M1.5 14.5 5.5 8h5l4 6.5Z" fill="#fff"/><path d="M8 6V1.8M5.2 6.5 3.2 3.5M10.8 6.5l2-3" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
  wave: `<path d="M1.5 13.5C2.5 7 8 3 13.5 5.5 10 5.5 8.5 8.5 11 11c1.2 1.2 2.6 1.3 3.5 1V13.5Z" fill="#fff"/>`,
  escape: `<path d="M4 14.5V2l8.5 3.2L4 8.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  sunset: `<path d="M1.5 12.5h13M4 12.5a4 4 0 0 1 8 0M8 3.5v2M3 6l1.3 1.3M13 6l-1.3 1.3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
};
