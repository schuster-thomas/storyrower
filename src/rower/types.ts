// Gemeinsame Typen der Daten-Schicht.
//
// Aufbau:  PacketSource (Bluetooth | Aufzeichnung | Simulator)
//            └─ liefert rohe FTMS-Pakete (uuid + Bytes + Zeitstempel)
//          RowerSession
//            └─ dekodiert, entfernt Duplikate, erkennt Schläge/Pausen, glättet, zeichnet auf
//            └─ liefert RowerEvents an Spiel UND Diagnose-Ansicht (gleicher Datenweg)

export interface RawPacket {
  /** ms seit Start der Quelle */
  t: number;
  uuid: string;
  data: DataView;
  /** 'notify' = laufende Daten, 'read' = einmal gelesener Wert, 'write' = an das Gerät gesendet */
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
  /** Befehl an das Gerät senden (nur Bluetooth; Simulator ignoriert oder simuliert). */
  sendControl?(bytes: number[]): Promise<void>;
}

/** Normalisierter Zustand, den das Spiel nutzt. */
export interface RowerSample {
  /** ms seit Session-Start */
  t: number;
  strokeRate: number;        // spm, Rohwert vom Gerät
  strokeCount: number;
  distance: number;          // m
  pace: number | null;       // s/500m, null wenn das Gerät 0 meldet
  power: number;             // W, Rohwert (springt von Schlag zu Schlag)
  powerSmoothed: number;     // W, Mittel der letzten Schläge
  paceSmoothed: number | null;
  avgStrokeRate: number | null;
  resistance: number | null;
  energy: number | null;     // kcal
  heartRate: number | null;  // bpm, null wenn kein Gurt
  elapsedTime: number | null;// s, Gerätezeit
  rowing: boolean;           // false = Pause
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
