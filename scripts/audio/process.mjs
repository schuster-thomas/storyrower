// Turns the raw recordings in assets/raw/audio/<slot>/ into the game's sounds.
//   node scripts/audio/process.mjs [slot …]      (all slots that have recordings when none given)
// Writes public/audio/<slot>-<n>.ogg (Opus), the manifest src/audio/sounds.json that the game
// loads, and public/audio/CREDITS.md. Runs Blender headless for decoding/cutting/encoding.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SOUNDS } from './sounds.mjs';

const RAW = 'assets/raw/audio';
const OUT = 'public/audio';
const MANIFEST = 'src/audio/sounds.json';
const TMP = 'assets/raw/build';
const BLENDER = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe';
const AUDIO = /\.(ogg|wav|mp3|flac|m4a|aiff?|opus)$/i;

const only = process.argv.slice(2);
for (const s of only) if (!SOUNDS[s]) throw new Error(`unknown slot ${s}`);

const slots = {};
for (const [slot, spec] of Object.entries(SOUNDS)) {
  if (only.length && !only.includes(slot)) continue;
  const dir = join(RAW, slot);
  if (spec.disabled || !existsSync(dir)) continue;
  const inputs = readdirSync(dir).filter((f) => AUDIO.test(f)).sort().map((f) => resolve(dir, f));
  if (inputs.length) slots[slot] = { spec, inputs };
}
if (!Object.keys(slots).length) throw new Error(`No recordings in ${RAW}/<slot>/ – run scripts/audio/fetch.mjs first`);

mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const job = resolve(TMP, 'audio-job.json');
const res = resolve(TMP, 'audio-result.json');
writeFileSync(job, JSON.stringify({ out: resolve(OUT), slots }));
const log = execFileSync(BLENDER, ['-b', '--factory-startup', '--python', 'scripts/blender/audio_process.py', '--', job, res], { encoding: 'utf8', maxBuffer: 64 << 20 });
for (const line of log.split('\n')) if (line.startsWith('AUDIO ') || /Error|Traceback/.test(line)) console.log(line.replace(/^AUDIO /, '✓ '));
const result = JSON.parse(readFileSync(res, 'utf8'));

// manifest: merge with the slots that were not processed this time
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
for (const [slot, files] of Object.entries(result)) manifest[slot] = files.map((f) => f.file);
const ordered = Object.fromEntries(Object.keys(SOUNDS).filter((s) => !SOUNDS[s].disabled && manifest[s]?.length).map((s) => [s, manifest[s]]));
writeFileSync(MANIFEST, JSON.stringify(ordered, null, 2) + '\n');
// switched-off slots leave the game: drop their files
for (const [slot, spec] of Object.entries(SOUNDS)) {
  if (!spec.disabled) continue;
  for (const f of readdirSync(OUT).filter((f) => f.startsWith(`${slot}-`) && f.endsWith('.ogg'))) { unlinkSync(join(OUT, f)); console.log(`- removed ${f}`); }
}

// credits for everything that is in the manifest
const lines = ['# Sound credits', '', 'All recordings are CC0 (public domain) unless noted – no attribution required, listed for reference.', ''];
for (const slot of Object.keys(ordered)) {
  const dir = join(RAW, slot);
  const sources = existsSync(dir) ? readdirSync(dir).filter((f) => AUDIO.test(f)) : [];
  lines.push(`## ${slot}`);
  for (const f of sources) {
    const meta = join(dir, f.replace(AUDIO, '.json'));
    if (existsSync(meta)) {
      const m = JSON.parse(readFileSync(meta, 'utf8'));
      lines.push(`- "${m.name}" by ${m.author} – ${m.url} (${/zero|Creative Commons 0/i.test(m.license) ? 'CC0' : m.license})`);
    } else lines.push(`- ${f} (added manually)`);
  }
  lines.push('');
}
writeFileSync(join(OUT, 'CREDITS.md'), lines.join('\n'));
console.log(`manifest: ${Object.keys(ordered).length} slots → ${MANIFEST}`);
