// Shared types of the data layer.
//
// Structure: PacketSource (Bluetooth | recording | simulator)
//            └─ delivers raw FTMS packets (uuid + bytes + timestamp)
//          RowerSession
//            └─ decodes, drops duplicates, detects strokes/pauses, smooths, records
//            └─ delivers RowerEvents to the game AND the diagnostics view (same data path)

export interface RawPacket {
  /** ms since the source started */
  t: number;
  uuid: string;
  data: DataView;
  /** 'notify' = streaming data, 'read' = value read once, 'write' = sent to the device */
  kind: 'notify' | 'read' | 'write';
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SourceInfo {
  kind: 'bluetooth' | 'replay' | 'simulator';
  label: string;
}

export interface PacketSourceEvents {
  packet: (p: RawPacket) => void;
  state: (s: ConnectionState, detail?: string) => void;
  log: (msg: string, level: 'info' | 'warn' | 'error') => void;
}

export interface PacketSource {
  readonly info: SourceInfo;
  start(): Promise<void>;
  stop(): void;
  on<K extends keyof PacketSourceEvents>(event: K, fn: PacketSourceEvents[K]): () => void;
  /** Send a command to the device (Bluetooth; the simulator fakes a response). */
  sendControl?(bytes: number[]): Promise<void>;
}

/** Normalised state used by the game. */
export interface RowerSample {
  /** ms since session start */
  t: number;
  strokeRate: number;        // spm, raw value from the device
  strokeCount: number;
  distance: number;          // m
  pace: number | null;       // s/500m, null when the device reports 0
  power: number;             // W, raw value (jumps from stroke to stroke)
  powerSmoothed: number;     // W, time-weighted mean over the last seconds
  paceSmoothed: number | null;
  avgStrokeRate: number | null;
  resistance: number | null;
  energy: number | null;     // kcal
  heartRate: number | null;  // bpm, null when no heart-rate source
  heartRateSource: 'monitor' | 'console' | null;
  elapsedTime: number | null;// s, device clock
  rowing: boolean;           // false = paused
}

export type RowerEvent =
  | { type: 'sample'; sample: RowerSample }
  | { type: 'stroke'; t: number; count: number; intervalMs: number | null }
  | { type: 'paused'; t: number }
  | { type: 'resumed'; t: number }
  | { type: 'resistance'; t: number; level: number }
  | { type: 'trainingStatus'; t: number; status: string }
  | { type: 'deviceInfo'; info: Record<string, unknown> }
  | { type: 'state'; state: ConnectionState; detail?: string }
  | { type: 'raw'; packet: RawPacket; decoded: unknown; duplicate: boolean }
  | { type: 'log'; t: number; msg: string; level: 'info' | 'warn' | 'error' };
