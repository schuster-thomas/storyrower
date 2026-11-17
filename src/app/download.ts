import type { RowerSession } from '../rower/session';
import { BluetoothSource } from '../rower/sources/bluetooth';

/** Saves the session's recording (all packets + app events) as a JSON file. */
export function downloadRecording(session: RowerSession) {
  const name = session.source instanceof BluetoothSource ? session.source.deviceName : session.source.info.label;
  session.recorder.setDevice(name ?? null);
  const blob = new Blob([JSON.stringify(session.recorder.toJSON(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = session.recorder.fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
