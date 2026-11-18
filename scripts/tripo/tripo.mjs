// Tripo3D API client (https://platform.tripo3d.ai). Key from env var `tripo_api_key`.
//   node scripts/tripo/tripo.mjs balance
//   node scripts/tripo/tripo.mjs text "a weathered wooden rowing boat" [--name boat] [--model <version>] [--faces 8000]
//   node scripts/tripo/tripo.mjs image path/to/ref.png [--name boat] [--model <version>] [--faces 8000]
//   node scripts/tripo/tripo.mjs status <task_id>
//   node scripts/tripo/tripo.mjs download <task_id> [--name boat]
// Generation commands wait for the task and download the results to assets/raw/tripo/ (not committed).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { envKey } from '../env-key.mjs';

const API = 'https://api.tripo3d.ai/v2/openapi';
const OUT = 'assets/raw/tripo';
const key = envKey('tripo_api_key');

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${res.status} ${text.slice(0, 300)}`); }
  if (!res.ok || json.code !== 0) throw new Error(`${res.status} code ${json.code}: ${json.message ?? ''} ${json.suggestion ?? ''}`.trim());
  return json.data;
}

const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const balance = () => call('/user/balance');
export const task = (id) => call(`/task/${id}`);

export async function upload(file) {
  const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), basename(file));
  const data = await call('/upload', { method: 'POST', body: form });
  return { type: ext, file_token: data.image_token };
}

export async function createTask(body) {
  const { task_id } = await post('/task', body);
  return task_id;
}

export async function waitFor(id, onProgress = () => {}) {
  for (;;) {
    const t = await task(id);
    onProgress(t);
    if (t.status === 'success') return t;
    if (!['queued', 'running'].includes(t.status)) throw new Error(`task ${id} ended with status ${t.status}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// Output URLs live in `output` (older) or `result` (newer, {url} objects); collect both.
function outputs(t) {
  const files = {};
  for (const [k, v] of Object.entries({ ...t.output, ...t.result })) {
    const url = typeof v === 'string' ? v : v?.url;
    if (url?.startsWith('http')) files[k] = url;
  }
  return files;
}

export async function download(t, name = t.task_id) {
  mkdirSync(OUT, { recursive: true });
  const saved = [];
  for (const [kind, url] of Object.entries(outputs(t))) {
    const ext = extname(new URL(url).pathname) || '.bin';
    const path = `${OUT}/${name}.${kind}${ext}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${kind}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    saved.push(path);
  }
  return saved;
}

function opt(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function generate(body, name) {
  const id = await createTask(body);
  console.log(`task ${id}`);
  let last = -1;
  const t = await waitFor(id, (s) => {
    if (s.progress !== last) { last = s.progress; process.stdout.write(`\r${s.status} ${s.progress ?? 0}%   `); }
  });
  console.log();
  for (const p of await download(t, name ?? id)) console.log(`✓ ${p}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const name = opt(rest, '--name');
  const extra = {};
  if (opt(rest, '--model')) extra.model_version = opt(rest, '--model');
  if (opt(rest, '--faces')) extra.face_limit = Number(opt(rest, '--faces'));
  try {
    switch (cmd) {
      case 'balance': {
        const b = await balance();
        console.log(`balance ${b.balance} credits (frozen ${b.frozen})`);
        break;
      }
      case 'text':
        await generate({ type: 'text_to_model', prompt: arg, ...extra }, name);
        break;
      case 'image':
        await generate({ type: 'image_to_model', file: await upload(arg), ...extra }, name);
        break;
      case 'status':
        console.log(JSON.stringify(await task(arg), null, 2));
        break;
      case 'download':
        for (const p of await download(await task(arg), name ?? arg)) console.log(`✓ ${p}`);
        break;
      default:
        console.log('usage: tripo.mjs balance | text "<prompt>" | image <file> | status <id> | download <id>  [--name n] [--model v] [--faces n]');
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}
