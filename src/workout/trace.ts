import type { PhaseId, Segment } from './workout';

/** One second of a workout, for the results chart. */
export interface TracePoint {
  /** workout time (s) */
  t: number;
  /** W (smoothed over the last strokes) */
  power: number;
  /** strokes per minute */
  spm: number;
  /** bpm, null without a heart-rate source */
  hr: number | null;
  /** the target bands at that moment */
  powerBand: [number, number];
  spmBand: [number, number];
  phase: PhaseId;
}

/** Collects one point per second of rowing (workout time), for the chart at the end. */
export class WorkoutTrace {
  readonly points: TracePoint[] = [];
  private next = -Infinity;

  /** Call every frame while rowing; keeps at most one point per second of workout time. */
  add(t: number, power: number, spm: number, hr: number | null, seg: Segment) {
    if (t < this.next) return;
    if (!this.points.length && (power <= 0 || spm <= 0)) return;   // start with the first stroke, not a ramp from 0
    this.next = Math.floor(t) + 1;
    this.points.push({
      t, power: Math.round(power), spm: Math.round(spm * 2) / 2, hr: hr && hr > 0 ? Math.round(hr) : null,
      powerBand: [seg.power.lo, seg.power.hi], spmBand: [seg.spm.lo, seg.spm.hi], phase: seg.phase,
    });
  }
}

export interface WorkoutSummary {
  /** s of rowing */
  time: number;
  distance: number;
  strokes: number;
  avgPower: number;
  maxPower: number;
  avgSpm: number;
  /** s per 500 m, null without distance */
  avgPace: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** kcal, null when the rower doesn't report energy */
  energy: number | null;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** The numbers for the end screen, from the trace plus the rower's own counters. */
export function summarize(points: TracePoint[], c: { time: number; distance: number; strokes: number; energy: number | null }): WorkoutSummary {
  const rowing = points.filter((p) => p.power > 0 || p.spm > 0);
  const hrs = points.map((p) => p.hr).filter((h): h is number => h != null);
  return {
    time: c.time,
    distance: c.distance,
    strokes: c.strokes,
    avgPower: Math.round(mean(rowing.map((p) => p.power))),
    maxPower: Math.round(Math.max(0, ...points.map((p) => p.power))),
    avgSpm: Math.round(mean(rowing.map((p) => p.spm)) * 10) / 10,
    avgPace: c.distance > 0 && c.time > 0 ? (500 * c.time) / c.distance : null,
    avgHr: hrs.length ? Math.round(mean(hrs)) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    energy: c.energy != null ? Math.round(c.energy) : null,
  };
}
