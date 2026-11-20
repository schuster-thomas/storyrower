/**
 * What the diagnostics download needs to know about the device and browser.
 *
 * - Android Chrome shortens the user agent ("Android 10; K"): model and real Android version only
 *   come from navigator.userAgentData.
 * - An iPad in Bluefy (or Safari) usually reports a desktop Mac user agent; touch points tell it
 *   apart. Bluefy provides its own Web Bluetooth implementation, so which functions exist is noted.
 */

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);

interface UaData { brands?: { brand: string; version: string }[]; mobile?: boolean; platform?: string; getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>> }

export async function platformInfo(): Promise<Record<string, unknown>> {
  const n = navigator as Navigator & { userAgentData?: UaData; standalone?: boolean };
  const ua = n.userAgent;
  const info: Record<string, unknown> = {
    build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev',
    page: location.href.replace(/[?#].*$/, ''),
    userAgent: ua,
    platform: n.platform,
    vendor: n.vendor,
    maxTouchPoints: n.maxTouchPoints,
    language: n.language,
    screen: `${screen.width}×${screen.height} (viewport ${innerWidth}×${innerHeight} @${devicePixelRatio}x)`,
    installedAsApp: matchMedia('(display-mode: standalone)').matches || n.standalone === true,
    guess: /Bluefy/i.test(ua) ? 'Bluefy'
      : /iPad|iPhone/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1) ? 'iPad/iPhone (WebKit – Bluefy or Safari)'
      : /Android/.test(ua) ? 'Android' : 'desktop',
    webkitBridge: typeof (window as unknown as { webkit?: { messageHandlers?: unknown } }).webkit?.messageHandlers !== 'undefined',
  };

  if (n.userAgentData) {
    info.uaBrands = n.userAgentData.brands?.map((b) => `${b.brand} ${b.version}`).join(', ');
    try {
      const hi = await within(n.userAgentData.getHighEntropyValues?.(['model', 'platformVersion', 'fullVersionList']) ?? Promise.resolve({} as Record<string, unknown>), 1500);
      if (hi !== 'timeout') {
        info.model = hi.model || '(not reported)';
        info.platformVersion = hi.platformVersion;
        info.browserVersions = (hi.fullVersionList as { brand: string; version: string }[] | undefined)?.map((b) => `${b.brand} ${b.version}`).join(', ');
      } else info.model = 'timeout';
    } catch (e) { info.model = `error: ${(e as Error).message}`; }
  }

  const bt = n.bluetooth as unknown as Record<string, unknown> | undefined;
  if (!bt) info.webBluetooth = 'missing';
  else {
    const fns: string[] = [];
    // for…in also lists the interface methods on the prototype (Chrome) and own properties (Bluefy)
    for (const k in bt) { try { if (typeof bt[k] === 'function') fns.push(k); } catch { /* getter threw */ } }
    info.webBluetooth = fns.sort().join(', ') || '(object without functions)';
    if (typeof n.bluetooth.getAvailability === 'function') {
      try { info.bluetoothAvailable = await within(n.bluetooth.getAvailability(), 1500); } catch (e) { info.bluetoothAvailable = `error: ${(e as Error).message}`; }
    }
  }
  return info;
}
