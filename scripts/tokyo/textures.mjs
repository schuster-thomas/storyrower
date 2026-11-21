// Tileable textures for the 3D banks of "Tokyo Super Row" (city high-rises, promenade, Japanese
// garden), painted by the image model in the style of the level's paintings.
//   node scripts/tokyo/textures.mjs [id …] [--force]   → src/assets/levels/tokyo/tex/<id>.webp
// Raw PNGs: assets/raw/levels/tokyo/tex/ (not committed). The game repeats them in metres
// (src/game/scene/tokyo/kit.ts), so each prompt fixes how much of the world one tile shows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/levels/tokyo/tex';
const OUT = 'src/assets/levels/tokyo/tex';
const CITY_REF = 'assets/raw/painted/city/painted-raw.png';
const GARDEN_REF = 'assets/raw/painted/garden/painted-raw.png';

const TILE = 'Seamless tileable texture: the left edge continues exactly into the right edge and the top edge into the bottom edge. A flat, front-on orthographic view that fills the whole image edge to edge – no perspective, no vanishing lines, no sky, no ground line, no frame, no border, no text, no logos, no people.';
const STYLE = 'Painted in exactly the style, palette and light of the reference image (premium stylised console game art, clean readable shapes, soft painterly detail, bright spring daylight).';

const TEXTURES = [
  { id: 'facade-glass', ref: CITY_REF, size: '1024x1024', out: 512, prompt: `A modern blue glass curtain-wall facade of a Tokyo office tower: exactly 4 columns and 4 storeys of tall glass panels in a perfectly regular grid with thin white aluminium mullions and slim floor bands, the glass reflecting blue sky and soft white clouds.` },
  { id: 'facade-office', ref: CITY_REF, size: '1024x1024', out: 512, prompt: `The facade of a white modern Tokyo office building: exactly 4 storeys, each a long horizontal band of dark blue-grey ribbon windows divided into 4 panes, between smooth white concrete spandrel bands.` },
  { id: 'facade-flats', ref: CITY_REF, size: '1024x1024', out: 512, prompt: `The facade of a warm beige Tokyo apartment block: exactly 3 columns and 4 storeys of balconies with glass railings and sliding windows behind them, a few small potted plants, cream concrete slabs between the floors.` },
  { id: 'facade-teal', ref: CITY_REF, size: '1024x1024', out: 512, prompt: `A teal-green glass facade of a modern Tokyo tower: exactly 4 columns and 4 storeys of green-teal glass panels with thin gold horizontal floor lines and slim dark vertical fins, reflecting the sky.` },
  { id: 'podium', ref: CITY_REF, size: '1536x1024', out: 768, prompt: `The ground floor of a modern Tokyo building seen straight on, one storey tall: a row of 3 bright glass shop fronts and a lobby entrance between grey stone pillars, warm light inside, small planters in front, a dark band above. No lettering, no signs.` },
  { id: 'roof', ref: CITY_REF, size: '1024x1024', out: 256, prompt: `A flat building roof seen from straight above: light grey concrete tiles with a few darker joints and small grey vents.` },
  { id: 'wall-stone', ref: GARDEN_REF, size: '1536x1024', out: 768, prompt: `An old Japanese castle-moat retaining wall of large irregular, rounded granite blocks in warm greys and beige, dark joints, a little green moss in the joints, the bottom fifth darker and wet. The blocks fill the whole image.` },
  { id: 'wall-city', ref: CITY_REF, size: '1536x1024', out: 768, prompt: `A river embankment wall of neatly cut rectangular grey granite blocks in regular courses, slightly weathered, a little moss, the bottom fifth darker and wet. The blocks fill the whole image.` },
  { id: 'paving', ref: CITY_REF, size: '1024x1024', out: 256, prompt: `Light grey-beige square stone paving slabs of a riverside promenade seen from straight above, 4 × 4 slabs, a few pink cherry petals.` },
  { id: 'lawn', ref: GARDEN_REF, size: '1024x1024', out: 512, prompt: `A lush, neatly kept Japanese garden lawn with soft moss seen from straight above, fresh spring green with lighter and darker patches and a few scattered pink cherry petals.` },
  { id: 'gravel', ref: GARDEN_REF, size: '1024x1024', out: 256, prompt: `Raked light grey-white gravel of a Japanese garden path seen from straight above, fine pebbles with gentle parallel rake lines running horizontally.` },
  { id: 'forest', ref: GARDEN_REF, size: '1024x1024', out: 512, prompt: `Dense tree canopy of a wooded hill seen from above: rounded green tree crowns in several greens with a few soft pink cherry trees in bloom among them.` },
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function generate(t) {
  const form = new FormData();
  form.append('model', 'gpt-image-1.5');
  form.append('prompt', `${TILE} ${t.prompt} ${STYLE}`);
  form.append('image[]', new Blob([readFileSync(t.ref)], { type: 'image/png' }), 'style.png');
  form.append('size', t.size);
  form.append('quality', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error?.message}`);
  writeFileSync(`${RAW}/${t.id}.png`, Buffer.from(json.data[0].b64_json, 'base64'));
}

const todo = TEXTURES.filter((t) => (only.length ? only.includes(t.id) : true)).filter((t) => force || !existsSync(`${RAW}/${t.id}.png`));
console.log(`${todo.length} texture(s) to generate`);
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    try { await generate(t); console.log(`✓ ${t.id}`); } catch (e) { console.log(`✗ ${t.id}: ${e.message}`); }
  }
}));
for (const t of TEXTURES) {
  const raw = `${RAW}/${t.id}.png`;
  if (!existsSync(raw)) continue;
  const meta = await sharp(raw).metadata();
  const w = t.out, h = Math.round((t.out * meta.height) / meta.width);
  await sharp(raw).resize(w, h).webp({ quality: 84 }).toFile(`${OUT}/${t.id}.webp`);
}
console.log('packed');
