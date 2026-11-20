import type { RowerSession } from '../rower/session';
import { BluetoothSource } from '../rower/sources/bluetooth';

function save(json: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Saves the session's recording (all packets + app events) as a JSON file. `report` adds what the
 * diagnostics page shows (tiles, services, Bluetooth trace, log) to the same file; players ignore
 * it, so the file can still be replayed. Without a session only the report is saved.
 */
export function downloadRecording(session: RowerSession | null, report?: unknown) {
  if (!session) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    save({ app: 'storyrower', version: 2, recordedAt: new Date().toISOString(), device: null, packets: [], events: [], report }, `storyrower-diagnostics-${stamp}.json`);
    return;
  }
  const name = session.source instanceof BluetoothSource ? session.source.deviceName : session.source.info.label;
  session.recorder.setDevice(name ?? null);
  save(report === undefined ? session.recorder.toJSON() : { ...session.recorder.toJSON(), report }, session.recorder.fileName());
}
