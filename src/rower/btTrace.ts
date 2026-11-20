/**
 * App-wide Bluetooth trace for the diagnostics download.
 *
 * Every connection step, error, disconnect and state change of every attempt (rower and
 * heart-rate monitor), the session's warnings and the page lifecycle (background, screen off,
 * uncaught errors) – each line with the wall-clock time. It lives outside the sources, so
 * nothing is lost when a new connection attempt starts or the page changes.
 *
 * Raw notifications go into a separate buffer that keeps only the latest ones; the events are
 * kept (almost) completely, so the start of a long session is still there.
 */

interface Entry { at: number; text: string }
export type TraceKind = 'event' | 'notify';

const MAX_EVENTS = 4000;
const MAX_NOTIFY = 600;
const events: Entry[] = [];
const notifies: Entry[] = [];
const listeners = new Set<(line: string) => void>();
let droppedEvents = 0, droppedNotifies = 0;

// wall clock of performance.now() = 0 (performance.timeOrigin is missing in older WebKit)
const origin = typeof performance !== 'undefined' ? Date.now() - performance.now() : 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function clock(at: number) {
  const d = new Date(origin + at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Add a line. `tag` names who it is from, e.g. "rower1", "hr1", "page", "session". */
export function trace(tag: string, msg: string, kind: TraceKind = 'event') {
  const at = now();
  const text = `${clock(at)}  ${tag.padEnd(7)} ${msg}`;
  const buf = kind === 'event' ? events : notifies;
  buf.push({ at, text });
  if (kind === 'event' && events.length > MAX_EVENTS) { events.shift(); droppedEvents++; }
  if (kind === 'notify' && notifies.length > MAX_NOTIFY) { notifies.shift(); droppedNotifies++; }
  listeners.forEach((fn) => fn(text));
}

/** All lines, events and the latest notifications merged in time order. */
export function traceLines(): string[] {
  const out: string[] = [];
  if (droppedEvents) out.push(`(${droppedEvents} older event lines dropped)`);
  if (droppedNotifies) out.push(`(${droppedNotifies} older notification lines dropped – only the last ${MAX_NOTIFY} are kept; all packets are in "packets")`);
  let i = 0, j = 0;
  while (i < events.length || j < notifies.length) {
    if (j >= notifies.length || (i < events.length && events[i].at <= notifies[j].at)) out.push(events[i++].text);
    else out.push(notifies[j++].text);
  }
  return out;
}

/** Only the event lines (no raw notifications) – the connection history. */
export function traceEvents(): string[] { return events.map((e) => e.text); }

export function onTraceLine(fn: (line: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- page lifecycle: on tablets the most common reason for a silent Bluetooth stop ----------
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  trace('page', `loaded · build ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'} · ${navigator.userAgent}`);
  document.addEventListener('visibilitychange', () => trace('page', `visibility: ${document.visibilityState}`));
  window.addEventListener('pagehide', (e) => trace('page', `pagehide (persisted: ${(e as PageTransitionEvent).persisted})`));
  window.addEventListener('pageshow', (e) => trace('page', `pageshow (persisted: ${(e as PageTransitionEvent).persisted})`));
  document.addEventListener('freeze', () => trace('page', 'freeze (page suspended by the browser)'));
  document.addEventListener('resume', () => trace('page', 'resume'));
  window.addEventListener('online', () => trace('page', 'online'));
  window.addEventListener('offline', () => trace('page', 'offline'));
  window.addEventListener('hashchange', () => trace('page', `navigate to ${location.hash || '#/'}`));
  window.addEventListener('error', (e) => trace('page', `uncaught error: ${e.message} (${e.filename?.split('/').pop() ?? ''}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    trace('page', `unhandled promise rejection: ${r?.name ?? ''} ${r?.message ?? String(e.reason)}`);
  });
}
