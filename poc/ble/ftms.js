// FTMS (Bluetooth Fitness Machine Service) – Konstanten und Parser.
// Spezifikation: Bluetooth SIG "Fitness Machine Service 1.0", Rower Data 0x2AD1.

const uuid16 = (n) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

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
};

// Weitere Services, die Web Bluetooth freigeben soll, damit der Explorer sie sehen kann.
// (Web Bluetooth zeigt nur Services, die hier vorab genannt werden.)
export const EXPLORER_SERVICES = [
  UUID.FTMS,
  UUID.HEART_RATE,
  UUID.DEVICE_INFO,
  UUID.BATTERY,
  uuid16(0x1816), // Cycling Speed & Cadence
  uuid16(0x1818), // Cycling Power
  uuid16(0xfff0), // häufiger proprietärer Service
  uuid16(0xffe0), // HM-10 / China-UART
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip Transparent UART (ältere Domyos-Geräte)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
];

export const NAMES = {
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
  [uuid16(0x2ad2)]: 'Indoor Bike Data',
  [uuid16(0x2acd)]: 'Treadmill Data',
  [uuid16(0x2ace)]: 'Cross Trainer Data',
  [uuid16(0x2ad6)]: 'Supported Resistance Range',
  [uuid16(0x2ad8)]: 'Supported Power Range',
  [uuid16(0x2a29)]: 'Manufacturer Name',
  [uuid16(0x2a24)]: 'Model Number',
  [uuid16(0x2a26)]: 'Firmware Revision',
  [uuid16(0x2a19)]: 'Battery Level',
};

export const nameOf = (u) => NAMES[u] ?? u;

export function toHex(dataView) {
  const out = [];
  for (let i = 0; i < dataView.byteLength; i++) out.push(dataView.getUint8(i).toString(16).padStart(2, '0'));
  return out.join(' ');
}

export function fromHex(hex) {
  const bytes = hex.trim().split(/\s+/).map((b) => parseInt(b, 16));
  return new DataView(new Uint8Array(bytes).buffer);
}

/**
 * Parst eine Rower-Data-Notification. Gibt nur die Felder zurück, die im Paket stecken.
 * Manche Geräte verteilen die Werte auf mehrere Pakete ("More Data") – der Aufrufer
 * sollte die Ergebnisse daher in einen laufenden Zustand mergen.
 */
export function parseRowerData(dv) {
  let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const s16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u24 = () => { const v = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16); o += 3; return v; };

  const flags = u16();
  const has = (bit) => (flags & (1 << bit)) !== 0;
  const r = { flags };

  try {
    // Bit 0 "More Data" ist invertiert: 0 => Schlagfrequenz + Schlagzähler vorhanden
    if (!has(0)) { r.strokeRate = u8() / 2; r.strokeCount = u16(); }
    if (has(1)) r.avgStrokeRate = u8() / 2;
    if (has(2)) r.totalDistance = u24();          // m
    if (has(3)) r.pace = u16();                   // s / 500 m
    if (has(4)) r.avgPace = u16();                // s / 500 m
    if (has(5)) r.power = s16();                  // W
    if (has(6)) r.avgPower = s16();               // W
    if (has(7)) r.resistance = s16();
    if (has(8)) { r.totalEnergy = u16(); r.energyPerHour = u16(); r.energyPerMinute = u8(); } // kcal
    if (has(9)) r.heartRate = u8();               // bpm
    if (has(10)) r.met = u8() / 10;
    if (has(11)) r.elapsedTime = u16();           // s
    if (has(12)) r.remainingTime = u16();         // s
  } catch (e) {
    r.error = `Paket kürzer als laut Flags erwartet (${dv.byteLength} Bytes, gelesen bis ${o})`;
  }
  if (!r.error && o !== dv.byteLength) r.warning = `${dv.byteLength - o} Byte(s) übrig – Flags evtl. nicht spec-konform`;
  return r;
}

const ROWER_FEATURES = [
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

export function parseFeature(dv) {
  const machine = dv.getUint32(0, true);
  const target = dv.byteLength >= 8 ? dv.getUint32(4, true) : 0;
  return {
    machine: ROWER_FEATURES.filter((_, i) => machine & (1 << i)),
    target: TARGET_FEATURES.filter((_, i) => target & (1 << i)),
  };
}

const CP_OPCODES = { 0x00: 'Request Control', 0x01: 'Reset', 0x07: 'Start/Resume', 0x08: 'Stop/Pause' };
const CP_RESULTS = { 0x01: 'Success', 0x02: 'Not Supported', 0x03: 'Invalid Parameter', 0x04: 'Failed', 0x05: 'Control Not Permitted' };

export function parseControlPointResponse(dv) {
  if (dv.getUint8(0) !== 0x80) return { raw: toHex(dv) };
  const op = dv.getUint8(1);
  const res = dv.getUint8(2);
  return { opcode: CP_OPCODES[op] ?? `0x${op.toString(16)}`, result: CP_RESULTS[res] ?? `0x${res.toString(16)}` };
}

export const formatPace = (s) => (s == null || s === 0 || s >= 0xffff ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export const formatTime = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
