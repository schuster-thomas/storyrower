// Reads the OpenAI API key from the environment variable `gpt_api_key`.
// If this process was started before the variable was set, fall back to the Windows
// machine/user environment. The key is never printed.
import { execFileSync } from 'node:child_process';

export function openAiKey() {
  let key = process.env.gpt_api_key || process.env.GPT_API_KEY;
  if (!key && process.platform === 'win32') {
    for (const scope of ['User', 'Machine']) {
      try {
        key = execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('gpt_api_key','${scope}')`], { encoding: 'utf8' }).trim();
      } catch { /* ignore */ }
      if (key) break;
    }
  }
  if (!key) throw new Error('Environment variable gpt_api_key is not set');
  return key;
}
