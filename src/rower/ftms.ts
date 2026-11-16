// FTMS (Bluetooth Fitness Machine Service) – constants, decoder and encoder.
// Spec: Bluetooth SIG "Fitness Machine Service 1.0".

export const uuid16 = (n: number): string => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const UUID = {
  FTMS: uuid16(0x1826),
  ROWER_DATA: uuid16(0x2ad1),
  FEATURE: uuid16(0x2acc),
  TRAINING_STATUS: uuid16(0x2ad3),
  CONTROL_POINT: uuid16(0x2ad9),
  MACHINE_STATUS: uuid16(0x2ada),
  HEART_RATE: uuid16(0x180d),
  HEART_RATE_MEASUREMENT: uuid16(0x2a37),
  DEVICE_INFO: uuid16(0x180a),
  BATTERY: uuid16(0x180f),
  BATTERY_LEVEL: uuid16(0x2a19),
} as const;

/** Services Web Bluetooth should expose (it only shows services listed up front). */
export const OPTIONAL_SERVICES = [
  UUID.FTMS, UUID.HEART_RATE, UUID.DEVICE_INFO, UUID.BATTERY,
  uuid16(0x1816), uuid16(0x1818), uuid16(0xfff0), uuid16(0xffe0),
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const NAMES: Record<string, string> = {
  [UUID.FTMS]: 'Fitness Machine (FTMS)',
  [UUID.ROWER_DATA]: 'Rower Data',
  [UUID.FEATURE]: 'Fitness Machine Feature',
  [UUID.TRAINING_STATUS]: 'Training Status',
  [UUID.CONTROL_POINT]: 'Control Point',
  [UUID.MACHINE_STATUS]: 'Machine Status',
  [UUID.HEART_RATE]: 'Heart Rate',
  [UUID.HEART_RATE_MEASUREMENT]: 'Heart Rate Measurement',
  [UUID.DEVICE_INFO]: 'Device Information',
  [UUID.BATTERY]: 'Battery',
  [UUID.BATTERY_LEVEL]: 'Battery Level',
  [uuid16(0x2ad6)]: 'Supported Resistance Range',
  [uuid16(0x2ad8)]: 'Supported Power Range',
  [uuid16(0x2a24)]: 'Model Number',
  [uuid16(0x2a25)]: 'Serial Number',
  [uuid16(0x2a26)]: 'Firmware Revision',
  [uuid16(0x2a27)]: 'Hardware Revision',
  [uuid16(0x2a28)]: 'Software Revision',
  [uuid16(0x2a29)]: 'Manufacturer Name',
};
export const nameOf = (uuid: string): string => NAMES[uuid] ?? uuid;

// ---------- Hex helpers ----------
export function toHex(dv: DataView): string {
  const out: string[] = [];
  for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i).toString(16).padStart(2, '0'));
  return out.join(' ');
}
export function fromHex(hex: string): DataView {
  const bytes = hex.trim() ? hex.trim().split(/\s+/).map((b) => parseInt(b, 16)) : [];
  return new DataView(new Uint8Array(bytes).buffer);
}

// ---------- Rower Data (0x2AD1) ----------
export interface RowerData {
  flags: number;
  strokeRate?: number;      // spm (resolution 0.5)
  strokeCount?: number;
  avgStrokeRate?: number;   // spm
  totalDistance?: number;   // m
  pace?: number;            // s / 500 m
  avgPace?: number;         // s / 500 m
  power?: number;           // W
  avgPower?: number;        // W
  resistance?: number;
  totalEnergy?: number;     // kcal
  energyPerHour?: number;   // kcal/h
  energyPerMinute?: number; // kcal/min
  heartRate?: number;       // bpm
  met?: number;
  elapsedTime?: number;     // s
  remainingTime?: number;   // s
  error?: string;
  warning?: string;
}

export const ROWER_FLAG = {
  MORE_DATA: 1 << 0, AVG_STROKE_RATE: 1 << 1, TOTAL_DISTANCE: 1 << 2, PACE: 1 << 3, AVG_PACE: 1 << 4,
  POWER: 1 << 5, AVG_POWER: 1 << 6, RESISTANCE: 1 << 7, ENERGY: 1 << 8, HEART_RATE: 1 << 9,
  MET: 1 << 10, ELAPSED_TIME: 1 << 11, REMAINING_TIME: 1 << 12,
} as const;

/** Flags the Domyos Woodrower (firmware 2.5.0) always sends. */
export const WOODROWER_FLAGS = 0x0bae;

export function parseRowerData(dv: DataView): RowerData {
  let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const s16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u24 = () => { const v = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16); o += 3; return v; };

  const flags = u16();
  const has = (f: number) => (flags & f) !== 0;
  const r: RowerData = { flags };
  try {
    if (!has(ROWER_FLAG.MORE_DATA)) { r.strokeRate = u8() / 2; r.strokeCount = u16(); }
    if (has(ROWER_FLAG.AVG_STROKE_RATE)) r.avgStrokeRate = u8() / 2;
    if (has(ROWER_FLAG.TOTAL_DISTANCE)) r.totalDistance = u24();
    if (has(ROWER_FLAG.PACE)) r.pace = u16();
    if (has(ROWER_FLAG.AVG_PACE)) r.avgPace = u16();
    if (has(ROWER_FLAG.POWER)) r.power = s16();
    if (has(ROWER_FLAG.AVG_POWER)) r.avgPower = s16();
    if (has(ROWER_FLAG.RESISTANCE)) r.resistance = s16();
    if (has(ROWER_FLAG.ENERGY)) { r.totalEnergy = u16(); r.energyPerHour = u16(); r.energyPerMinute = u8(); }
    if (has(ROWER_FLAG.HEART_RATE)) r.heartRate = u8();
    if (has(ROWER_FLAG.MET)) r.met = u8() / 10;
    if (has(ROWER_FLAG.ELAPSED_TIME)) r.elapsedTime = u16();
    if (has(ROWER_FLAG.REMAINING_TIME)) r.remainingTime = u16();
  } catch {
    r.error = `Packet shorter than its flags announce (${dv.byteLength} bytes, read up to ${o})`;
  }
  if (!r.error && o !== dv.byteLength) r.warning = `${dv.byteLength - o} byte(s) left over – flags may not be spec-compliant`;
  return r;
}

/** Builds a Rower Data packet in the Woodrower format (flags 0x0BAE). For the simulator and tests. */
export function encodeWoodrowerData(v: {
  strokeRate: number; strokeCount: number; avgStrokeRate: number; totalDistance: number; pace: number;
  power: number; resistance: number; totalEnergy: number; energyPerHour: number; energyPerMinute: number;
  heartRate: number; elapsedTime: number;
}): DataView {
  const dv = new DataView(new ArrayBuffer(23));
  let o = 0;
  const u8 = (x: number) => dv.setUint8(o++, Math.max(0, Math.min(0xff, Math.round(x))));
  const u16 = (x: number) => { dv.setUint16(o, Math.max(0, Math.min(0xffff, Math.round(x))), true); o += 2; };
  const s16 = (x: number) => { dv.setInt16(o, Math.round(x), true); o += 2; };
  const u24 = (x: number) => { const n = Math.max(0, Math.min(0xffffff, Math.floor(x))); dv.setUint16(o, n & 0xffff, true); dv.setUint8(o + 2, n >> 16); o += 3; };
  u16(WOODROWER_FLAGS);
  u8(v.strokeRate * 2); u16(v.strokeCount);
  u8(v.avgStrokeRate * 2);
  u24(v.totalDistance);
  u16(v.pace);
  s16(v.power);
  s16(v.resistance);
  u16(v.totalEnergy); u16(v.energyPerHour); u8(v.energyPerMinute);
  u8(v.heartRate);
  u16(v.elapsedTime);
  return dv;
}

// ---------- Feature (0x2ACC) ----------
const MACHINE_FEATURES = [
  'Average Speed', 'Cadence', 'Total Distance', 'Inclination', 'Elevation Gain', 'Pace',
  'Step Count', 'Resistance Level', 'Stride Count', 'Expended Energy', 'Heart Rate',
  'Metabolic Equivalent', 'Elapsed Time', 'Remaining Time', 'Power Measurement',
  'Force on Belt / Power Output', 'User Data Retention',
];
const TARGET_FEATURES = [
  'Speed Target', 'Inclination Target', 'Resistance Target', 'Power Target', 'Heart Rate Target',
  'Expended Energy Config', 'Step Number Config', 'Stride Number Config', 'Distance Config',
  'Training Time Config', 'Time in 2 HR Zones', 'Time in 3 HR Zones', 'Time in 5 HR Zones',
  'Indoor Bike Simulation', 'Wheel Circumference', 'Spin Down Control', 'Cadence Target',
];
export function parseFeature(dv: DataView): { machine: string[]; target: string[] } {
  const machine = dv.getUint32(0, true);
  const target = dv.byteLength >= 8 ? dv.getUint32(4, true) : 0;
  return {
    machine: MACHINE_FEATURES.filter((_, i) => machine & (1 << i)),
    target: TARGET_FEATURES.filter((_, i) => target & (1 << i)),
  };
}

// ---------- Machine Status (0x2ADA) ----------
export type MachineStatus =
  | { kind: 'reset' }
  | { kind: 'stopped'; by: 'stop' | 'pause' }
  | { kind: 'started' }
  | { kind: 'resistance'; level: number }
  | { kind: 'other'; opcode: number; label: string };

const STATUS_LABELS: Record<number, string> = {
  0x03: 'Stopped (safety key)', 0x05: 'Target speed changed', 0x06: 'Target incline changed',
  0x08: 'Target power changed', 0x09: 'Target heart rate changed', 0xff: 'Control permission lost',
};
export function parseMachineStatus(dv: DataView): MachineStatus {
  const op = dv.getUint8(0);
  switch (op) {
    case 0x01: return { kind: 'reset' };
    case 0x02: return { kind: 'stopped', by: dv.byteLength > 1 && dv.getUint8(1) === 0x01 ? 'stop' : 'pause' };
    case 0x04: return { kind: 'started' };
    case 0x07: return { kind: 'resistance', level: dv.byteLength > 1 ? dv.getUint8(1) / 10 : NaN };
    default: return { kind: 'other', opcode: op, label: STATUS_LABELS[op] ?? `0x${op.toString(16)}` };
  }
}
export function describeMachineStatus(s: MachineStatus): string {
  switch (s.kind) {
    case 'reset': return 'Reset';
    case 'stopped': return s.by === 'stop' ? 'Stopped' : 'Paused';
    case 'started': return 'Started/resumed';
    case 'resistance': return `Resistance ${s.level}`;
    case 'other': return s.label;
  }
}
export function encodeMachineStatus(s: MachineStatus): DataView {
  const bytes =
    s.kind === 'reset' ? [0x01] :
    s.kind === 'stopped' ? [0x02, s.by === 'stop' ? 0x01 : 0x02] :
    s.kind === 'started' ? [0x04] :
    s.kind === 'resistance' ? [0x07, Math.round(s.level * 10)] :
    [s.opcode];
  return new DataView(new Uint8Array(bytes).buffer);
}

// ---------- Training Status (0x2AD3) ----------
const TRAINING_STATUS: Record<number, string> = {
  0x00: 'Other', 0x01: 'Idle', 0x02: 'Warm-up', 0x03: 'Low-intensity interval', 0x04: 'High-intensity interval',
  0x05: 'Recovery', 0x06: 'Isometric', 0x07: 'Heart rate control', 0x08: 'Fitness test', 0x09: 'Speed too low',
  0x0a: 'Speed too high', 0x0b: 'Cool-down', 0x0c: 'Watt control', 0x0d: 'Manual mode (quick start)',
  0x0e: 'Pre-Workout', 0x0f: 'Post-Workout',
};
export function parseTrainingStatus(dv: DataView): string {
  if (dv.byteLength < 2) return '?';
  const s = dv.getUint8(1);
  return TRAINING_STATUS[s] ?? `0x${s.toString(16)}`;
}

// ---------- Control Point (0x2AD9) ----------
export const CONTROL = {
  REQUEST_CONTROL: [0x00],
  RESET: [0x01],
  START: [0x07],
  STOP: [0x08, 0x01],
  PAUSE: [0x08, 0x02],
  /** Target resistance in 0.1 steps (supported according to the Woodrower feature bits, untested). */
  setResistance: (level: number) => [0x04, Math.round(level * 10)],
} as const;

const CP_OPCODES: Record<number, string> = { 0x00: 'Request Control', 0x01: 'Reset', 0x04: 'Set Resistance', 0x07: 'Start/Resume', 0x08: 'Stop/Pause' };
const CP_RESULTS: Record<number, string> = { 0x01: 'Success', 0x02: 'Not Supported', 0x03: 'Invalid Parameter', 0x04: 'Failed', 0x05: 'Control Not Permitted' };
export function parseControlPointResponse(dv: DataView): string {
  if (dv.byteLength < 3 || dv.getUint8(0) !== 0x80) return toHex(dv);
  const op = dv.getUint8(1), res = dv.getUint8(2);
  return `${CP_OPCODES[op] ?? `0x${op.toString(16)}`}: ${CP_RESULTS[res] ?? `0x${res.toString(16)}`}`;
}

// ---------- Heart Rate Measurement (0x2A37) ----------
export function parseHeartRate(dv: DataView): number {
  return dv.getUint8(0) & 1 ? dv.getUint16(1, true) : dv.getUint8(1);
}

// ---------- Conversions ----------
/** Concept2 formula; the Woodrower converts pace and watts exactly like this. */
export const paceFromPower = (watts: number): number => (watts > 0 ? 500 * Math.cbrt(2.8 / watts) : 0);
export const powerFromPace = (pace: number): number => (pace > 0 ? 2.8 / (pace / 500) ** 3 : 0);

export const formatPace = (s: number | null | undefined): string =>
  s == null || s <= 0 || s >= 0xffff ? '–' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
export const formatDuration = (s: number | null | undefined): string =>
  s == null ? '–' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
