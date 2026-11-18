// Reads an API key from an environment variable.
// If this process was started before the variable was set, fall back to the Windows
// user/machine environment. The key is never printed.
import { execFileSync } from 'node:child_process';

export function envKey(name) {
  let key = process.env[name] || process.env[name.toUpperCase()];
  if (!key && process.platform === 'win32') {
    for (const scope of ['User', 'Machine']) {
      try {
        key = execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}','${scope}')`], { encoding: 'utf8' }).trim();
      } catch { /* ignore */ }
      if (key) break;
    }
  }
  if (!key) throw new Error(`Environment variable ${name} is not set`);
  return key;
}
