// Downloads CC0 recordings for every slot in sounds.mjs from the Freesound API.
//   node scripts/audio/fetch.mjs [slot …]        (all slots when none given)
//   node scripts/audio/fetch.mjs --refresh wind  (search again even if files exist)
//   node scripts/audio/fetch.mjs --list          (only write candidates.md, download nothing)
//
// Needs a free Freesound API key in the env var `freesound_api_key`
// (account on freesound.org → https://freesound.org/apiv2/apply → "Client secret/Api key").
// Only CC0 sounds are taken. The HQ Ogg preview is downloaded (no OAuth login needed);
// for a game mix that is plenty. Files land in assets/raw/audio/<slot>/<id>.ogg (not committed)
// with a <id>.json next to it (title, author, licence, link). assets/raw/audio/candidates.md
// lists the next-best matches per slot so you can listen and pin better ones.
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { envKey } from '../env-key.mjs';
import { SOUNDS } from './sounds.mjs';

const OUT = 'assets/raw/audio';
const API = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,username,duration,license,previews,num_downloads,avg_rating,num_ratings,url,tags';
const CC0 = 'Creative Commons 0';
const key = envKey('freesound_api_key');
const headers = { Authorization: `Token ${key}`, 'User-Agent': 'storyrower-asset-script' };

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const listOnly = args.includes('--list');
const only = args.filter((a) => !a.startsWith('--'));
const slots = Object.entries(SOUNDS).filter(([slot]) => !only.length || only.includes(slot));
for (const s of only) if (!SOUNDS[s]) throw new Error(`unknown slot ${s}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  await sleep(1100); // Freesound allows 60 requests a minute
  let res = await fetch(url, { headers });
  for (let retry = 0; res.status === 429 && retry < 3; retry++) {
    console.log('  (throttled, waiting 30 s)');
    await sleep(30000);
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function search(query, [dmin, dmax]) {
  const r = await api('/search/text/', {
    query, filter: `license:"${CC0}" duration:[${dmin} TO ${dmax}]`,
    fields: FIELDS, page_size: 15, // sorted by relevance
  });
  return r.results ?? [];
}

async function save(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

const isCc0 = (s) => /publicdomain\/zero|Creative Commons 0/i.test(s.license);
const report = ['# Freesound candidates (CC0)', '', 'Listen on Freesound, then put better ids into `pin` (or bad ones into `exclude`) in scripts/audio/sounds.mjs.', ''];

for (const [slot, spec] of slots) {
  if (spec.disabled) { console.log(`- ${slot}: disabled`); continue; }
  const dir = join(OUT, slot);
  const have = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ogg') && /^\d+\.ogg$/.test(f)) : [];
  if (have.length && !refresh && !listOnly) { console.log(`= ${slot}: ${have.length} file(s) already there`); continue; }
  if (refresh && !listOnly && existsSync(dir)) for (const f of have) { rmSync(join(dir, f)); rmSync(join(dir, f.replace('.ogg', '.json')), { force: true }); }
  mkdirSync(dir, { recursive: true });

  let picks;
  const exclude = new Set(spec.exclude ?? []);
  if (spec.pin?.length) {
    picks = [];
    for (const id of spec.pin) picks.push(await api(`/sounds/${id}/`, { fields: FIELDS }));
  } else {
    // round-robin over the queries, so one generic query cannot fill every slot
    const lists = [];
    for (const q of spec.queries) lists.push(await search(q, spec.duration));
    const seen = new Set();
    const merged = [];
    // the title or tags must mention one of the slot's words – relevance alone lets music and
    // unrelated popular sounds through
    const must = spec.must ? new RegExp(spec.must.join('|'), 'i') : null;
    const fits = (s) => !must || must.test(`${s.name} ${(s.tags ?? []).join(' ')}`);
    for (let i = 0; i < 15; i++) for (const l of lists) {
      const s = l[i];
      if (s && !seen.has(s.id) && !exclude.has(s.id) && isCc0(s) && fits(s) && !(s.num_ratings >= 3 && s.avg_rating < 3)) { seen.add(s.id); merged.push(s); }
    }
    picks = merged.slice(0, spec.files ?? 1);
    report.push(`## ${slot}`, '', ...merged.slice(0, 14).map((s, i) =>
      `- ${i < picks.length ? '**✓**' : '  '} [${s.id}](${s.url}) ${s.name} – ${s.username}, ${s.duration.toFixed(1)} s, ${s.num_downloads} dl, ★${s.avg_rating.toFixed(1)} · ${(s.tags ?? []).slice(0, 8).join(' ')}`), '');
  }
  if (listOnly) { console.log(`· ${slot}: ${picks.length} candidates listed`); continue; }
  for (const s of picks) {
    if (!isCc0(s)) { console.warn(`! ${slot}: ${s.id} is not CC0 (${s.license}) – skipped`); continue; }
    await save(s.previews['preview-hq-ogg'], join(dir, `${s.id}.ogg`));
    writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ id: s.id, name: s.name, author: s.username, license: s.license, url: s.url, duration: s.duration }, null, 2));
  }
  console.log(`✓ ${slot}: ${picks.map((s) => `${s.id} "${s.name}"`).join(', ') || 'nothing found'}`);
}
if (report.length > 4) writeFileSync(join(OUT, 'candidates.md'), report.join('\n'));
