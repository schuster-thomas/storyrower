import type { PhaseShare } from './workout';

/**
 * The default trainings – the modes every level can offer under "Choose your mode". This file is
 * the one place that fixes them.
 *
 * Like a custom training, each is a list of sections, but here a section's length is a share of
 * the whole workout (the user picks the duration, 25 min by default), so the same training works
 * for 10 or 90 minutes. Every section is set against the peak the user picks before rowing (the
 * hardest section of every training is the peak itself: slower 0, fewer 0):
 * - share:  % of the total time (the shares of a training add up to 100)
 * - slower: seconds per 500 m over the peak split (0 = the peak itself)
 * - fewer:  strokes per minute under the peak stroke rate (0 = the peak itself)
 *
 * `phases` places the story phases (scenery, sounds, story beats) along the time, as shares of the
 * total in story order – used when a level gives no plan of its own for the mode
 * (src/game/levels/*.ts, `modes.<mode>.phases`).
 */
export interface DefaultSection { share: number; slower: number; fewer: number }

export interface DefaultTraining {
  /** Name on the mode button. */
  label: string;
  /** One line on the setup screen when the level says nothing about the mode. */
  hint: string;
  sections: DefaultSection[];
  phases: PhaseShare[];
}

export type DefaultMode = 'steady' | 'buildup' | 'pyramid' | 'waves';

/** In the order the modes are shown. */
export const DEFAULT_TRAININGS: Record<DefaultMode, DefaultTraining> = {
  steady: {
    label: 'Steady',
    hint: 'The same targets from start to finish.',
    sections: [
      { share: 100, slower: 0, fewer: 0 },   // the peak, all the way
    ],
    phases: [{ phase: 'idyll', share: 0.85 }, { phase: 'winddown', share: 0.15 }],
  },

  buildup: {
    label: 'Build up',
    hint: 'Targets get harder step by step, up to the peak – then an easy cool-down.',
    sections: [
      { share: 14, slower: 30, fewer: 6 },
      { share: 14, slower: 24, fewer: 5 },
      { share: 14, slower: 18, fewer: 4 },
      { share: 14, slower: 12, fewer: 3 },
      { share: 14, slower: 6, fewer: 2 },
      { share: 15, slower: 0, fewer: 0 },   // the peak = the story's finale (70–85 %)
      { share: 15, slower: 35, fewer: 7 },  // cool-down
    ],
    phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.22 }, { phase: 'escalation', share: 0.28 }, { phase: 'finale', share: 0.15 }, { phase: 'winddown', share: 0.15 }],
  },

  pyramid: {
    label: 'Pyramid',
    hint: 'Hardest targets in the middle, easy at both ends.',
    sections: [
      { share: 12, slower: 30, fewer: 6 },
      { share: 12, slower: 22, fewer: 5 },
      { share: 12, slower: 14, fewer: 3 },
      { share: 12, slower: 7, fewer: 2 },
      { share: 12, slower: 0, fewer: 0 },   // the top
      { share: 12, slower: 7, fewer: 2 },
      { share: 12, slower: 14, fewer: 3 },
      { share: 16, slower: 25, fewer: 5 },
    ],
    phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.08 }, { phase: 'finale', share: 0.12 }, { phase: 'winddown', share: 0.4 }],
  },

  waves: {
    label: 'Waves',
    hint: 'Up and down: hard and easy stretches in turn.',
    sections: [
      { share: 15, slower: 30, fewer: 6 },  // warm-up
      { share: 10, slower: 18, fewer: 4 },
      // four waves: crest (the peak), trough
      { share: 7.5, slower: 0, fewer: 0 }, { share: 7.5, slower: 25, fewer: 5 },
      { share: 7.5, slower: 0, fewer: 0 }, { share: 7.5, slower: 25, fewer: 5 },
      { share: 7.5, slower: 0, fewer: 0 }, { share: 7.5, slower: 25, fewer: 5 },
      { share: 7.5, slower: 0, fewer: 0 }, { share: 7.5, slower: 25, fewer: 5 },
      { share: 15, slower: 35, fewer: 7 },  // cool-down
    ],
    phases: [{ phase: 'idyll', share: 0.2 }, { phase: 'omens', share: 0.2 }, { phase: 'escalation', share: 0.45 }, { phase: 'winddown', share: 0.15 }],
  },
};

/** Default length of a workout in a default mode (min); the user can change it. */
export const DEFAULT_DURATION_MIN = 25;
