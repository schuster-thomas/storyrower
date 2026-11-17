export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityLevel;
export const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

/** Everything the scene scales with the graphics level. */
export interface QualityProfile {
  /** cap for devicePixelRatio (render resolution) */
  pixelRatio: number;
  chunksAhead: number;
  trees: number;
  lupines: number;
  /** 0–1 share of particles that are drawn */
  particles: number;
  clouds: number;
  /** water grid resolution across × along the river */
  waterSegments: [number, number];
  /** terrain grid resolution per chunk side (across × along) */
  terrainSegments: [number, number];
}

export const PROFILES: Record<QualityLevel, QualityProfile> = {
  low:    { pixelRatio: 1,    chunksAhead: 6,  trees: 5,  lupines: 12, particles: 0.35, clouds: 4,  waterSegments: [10, 60],  terrainSegments: [8, 4] },
  medium: { pixelRatio: 1.25, chunksAhead: 8,  trees: 9,  lupines: 24, particles: 0.7,  clouds: 7,  waterSegments: [16, 90],  terrainSegments: [12, 6] },
  high:   { pixelRatio: 2,    chunksAhead: 11, trees: 13, lupines: 40, particles: 1,    clouds: 11, waterSegments: [24, 130], terrainSegments: [16, 8] },
};

export interface GraphicsSettings { quality: QualitySetting; showFps: boolean }
export const DEFAULT_GRAPHICS: GraphicsSettings = { quality: 'auto', showFps: false };
const KEY = 'storyrower.graphics';

export function loadGraphics(): GraphicsSettings {
  try { return { ...DEFAULT_GRAPHICS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULT_GRAPHICS }; }
}
export function saveGraphics(s: GraphicsSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Rolling frame statistics. */
export class FrameStats {
  private frames: number[] = [];
  private renders: number[] = [];
  calls = 0;
  triangles = 0;

  push(frameMs: number, renderMs: number) {
    this.frames.push(frameMs);
    this.renders.push(renderMs);
    if (this.frames.length > 180) { this.frames.shift(); this.renders.shift(); }
  }

  get fps() { const a = avg(this.frames); return a > 0 ? 1000 / a : 0; }
  get frameMs() { return avg(this.frames); }
  get frameP95() { return pct(this.frames, 0.95); }
  get renderMs() { return avg(this.renders); }
  get count() { return this.frames.length; }
  reset() { this.frames = []; this.renders = []; }
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function pct(a: number[], p: number) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/**
 * Picks the graphics level automatically: steps down when the frame rate stays low,
 * steps back up after a long stretch of headroom. Hysteresis avoids flip-flopping.
 */
export class AutoQuality {
  level: QualityLevel;
  private windowTime = 0;
  private windowFrames = 0;
  private goodWindows = 0;
  private cooldown = 0;

  constructor(start: QualityLevel = 'medium', private readonly windowSec = 4) { this.level = start; }

  /** Feed one frame; returns the new level when it changed. */
  frame(dt: number): QualityLevel | null {
    this.windowTime += dt;
    this.windowFrames++;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.windowTime < this.windowSec) return null;
    const fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;
    if (this.cooldown > 0) return null;
    const i = LEVELS.indexOf(this.level);
    if (fps < 45 && i > 0) return this.change(LEVELS[i - 1]);
    if (fps > 57) {
      this.goodWindows++;
      if (this.goodWindows >= 4 && i < LEVELS.length - 1) return this.change(LEVELS[i + 1]);
    } else this.goodWindows = 0;
    return null;
  }

  private change(l: QualityLevel) {
    this.level = l;
    this.goodWindows = 0;
    this.cooldown = this.windowSec * 2;
    return l;
  }
}
