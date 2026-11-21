// Generates the sounds Freesound has no CC0 recording for, with ElevenLabs Sound Effects.
//   node scripts/audio/generate.mjs [slot …]          → variants in assets/raw/audio/gen/<slot>/
//   node scripts/audio/generate.mjs --pick rowlock=2,4 puffin=1
//        copies the chosen variants into assets/raw/audio/<slot>/ for process.mjs
// Listen first: with `npm run dev` running open http://localhost:5173/assets/raw/audio/gen/
// (index.html is rewritten after every run).
//
// Needs the env var `elevenlabs_api_key` (paid plan = commercial use, royalty free).
// Cost: about 40 credits per generated second – the whole list below is ~6000 credits.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { envKey } from '../env-key.mjs';

const GEN_DIR = 'assets/raw/audio/gen';
const RAW = 'assets/raw/audio';

/** What to generate. `n` variants per slot, `duration` in seconds, `loop` for seamless ambience. */
export const GENERATE = {
  'shishi-odoshi': {
    n: 3, duration: 2.5,
    prompt: 'A Japanese bamboo water fountain (shishi-odoshi) in a quiet garden: a single hollow, resonant wooden clack as the bamboo tube tips over and strikes a stone, a little trickle of water before and after, calm, no music, no voices',
  },
  rowlock: {
    n: 4, duration: 1.5,
    prompt: 'Single clunk of a wooden oar turning in a metal oarlock on a small rowing boat, dry close-up knock with a slight wooden creak, no water, no music',
  },
  puffin: {
    // v1–4 had "light sea breeze" in the prompt and came out as wind
    n: 8, duration: 3,
    prompt: 'Close-up recording of a single Atlantic puffin calling: a deep, creaky, drawn-out growl "arr-arr-arr", like a low groan or snore, clearly audible bird voice, quiet background, no wind, no water, no music',
  },
  ash: {
    n: 3, duration: 12, loop: true,
    prompt: 'Fine volcanic ash and tiny pumice grains raining softly onto calm water and a wooden boat, gentle continuous patter and hiss, steady ambience, no thunder, no music',
  },
  calving: {
    n: 4, duration: 7,
    prompt: 'Glacier calving: deep cracking groan of ice, then a huge block of ice crashes into a river with a massive splash and rumbling echo, no music',
  },
  'tidal-wave': {
    n: 4, duration: 8,
    prompt: 'A huge tidal wave approaching from behind, deep roaring rush of water building up louder and louder, ominous, no music',
  },
  escape: {
    n: 4, duration: 3,
    prompt: 'Short uplifting success sting for a video game, bright bells rising, triumphant relief, ends cleanly',
  },
  sunset: {
    n: 4, duration: 4,
    prompt: 'Short calm ending chime for a video game, warm soft bells, peaceful sunset mood, fades out gently',
  },
};

const args = process.argv.slice(2);

if (args[0] === '--pick') {
  for (const a of args.slice(1)) {
    const [slot, list] = a.split('=');
    const spec = GENERATE[slot];
    if (!spec || !list) throw new Error(`usage: --pick <slot>=1,3 (unknown: ${a})`);
    const dir = join(RAW, slot);
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir).filter((f) => f.startsWith('gen-'))) throw new Error(`${dir} already has ${f} – remove the old gen-* files first`);
    for (const n of list.split(',').map(Number)) {
      const src = join(GEN_DIR, slot, `v${n}.mp3`);
      if (!existsSync(src)) throw new Error(`missing ${src}`);
      copyFileSync(src, join(dir, `gen-${n}.mp3`));
      writeFileSync(join(dir, `gen-${n}.json`), JSON.stringify({
        name: spec.prompt, author: 'ElevenLabs Sound Effects (generated)', license: 'generated with a paid ElevenLabs plan – commercial use, royalty free',
        url: 'https://elevenlabs.io/sound-effects',
      }, null, 2));
    }
    console.log(`✓ ${slot}: ${list} → ${dir}`);
  }
  process.exit(0);
}

const key = envKey('elevenlabs_api_key');
const only = args.filter((a) => !a.startsWith('--'));
for (const s of only) if (!GENERATE[s]) throw new Error(`unknown slot ${s}`);

async function generate(spec) {
  const body = { text: spec.prompt, duration_seconds: spec.duration, prompt_influence: 0.5, model_id: 'eleven_text_to_sound_v2', loop: !!spec.loop };
  const post = (b) => fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  let res = await post(body);
  if (res.status === 400 || res.status === 422) {
    // older API without the v2 model / loop option
    const { model_id, loop, ...plain } = body;
    res = await post(plain);
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

let seconds = 0;
for (const [slot, spec] of Object.entries(GENERATE)) {
  if (only.length && !only.includes(slot)) continue;
  const dir = join(GEN_DIR, slot);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= spec.n; n++) {
    const file = join(dir, `v${n}.mp3`);
    if (existsSync(file)) continue;
    writeFileSync(file, await generate(spec));
    seconds += spec.duration;
  }
  console.log(`✓ ${slot}: ${spec.n} variants`);
}
console.log(`generated ${seconds} s (≈ ${seconds * 40} credits)`);

// listening page
const rows = Object.entries(GENERATE).map(([slot, spec]) => {
  const files = existsSync(join(GEN_DIR, slot)) ? readdirSync(join(GEN_DIR, slot)).filter((f) => f.endsWith('.mp3')).sort() : [];
  return `<section><h2>${slot}</h2><p>${spec.prompt}</p>${files.map((f) =>
    `<div class="v"><b>${f.replace('.mp3', '').replace('v', '')}</b><audio controls preload="none" ${spec.loop ? 'loop' : ''} src="${slot}/${f}"></audio></div>`).join('')}</section>`;
}).join('\n');
writeFileSync(join(GEN_DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>StoryRower – generated sounds</title>
<style>body{font:15px system-ui;max-width:760px;margin:24px auto;padding:0 16px;color:#123}h2{margin:28px 0 4px}p{color:#567;margin:0 0 10px}
.v{display:flex;align-items:center;gap:12px;margin:6px 0}.v b{width:24px;text-align:right}audio{width:100%}</style>
<h1>Generated sounds</h1><p>Listen and note the numbers you like per sound.</p>
${rows}`);
