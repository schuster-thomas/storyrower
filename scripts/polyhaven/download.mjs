// Downloads the selected CC0 assets from Poly Haven (https://polyhaven.com) via its public API.
//   node scripts/polyhaven/download.mjs
// Files land in assets/raw/polyhaven/<type>/<id>/ (not committed). Existing files are skipped.
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const ASSETS = {
  models: { res: '2k', ids: ['coastal_cliff_01', 'rock_face_01', 'rock_face_02', 'rock_moss_set_01', 'boulder_01', 'mountainside'] },
  textures: { res: '2k', maps: ['Diffuse', 'nor_gl', 'Rough', 'Displacement'], ids: ['mossy_rock', 'rock_face', 'sparse_grass', 'aerial_grass_rock', 'lichen_rock'] },
  hdris: { res: '2k', ids: ['kloofendal_48d_partly_cloudy_puresky', 'qwantani_morning_puresky'] },
};
const OUT = 'assets/raw/polyhaven';
const UA = { 'User-Agent': 'storyrower-asset-script' };

async function save(url, file) {
  if (existsSync(file)) return 0;
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return Number(res.headers.get('content-length') ?? 0);
}

let bytes = 0, files = 0;
for (const [type, cfg] of Object.entries(ASSETS)) {
  for (const id of cfg.ids) {
    const f = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
    const dir = join(OUT, type, id);
    const jobs = [];
    if (type === 'models') {
      const g = f.gltf[cfg.res].gltf;
      jobs.push([g.url, join(dir, `${id}.gltf`)]);
      for (const [rel, inc] of Object.entries(g.include ?? {})) jobs.push([inc.url, join(dir, rel)]);
    } else if (type === 'textures') {
      for (const map of cfg.maps) {
        const e = f[map]?.[cfg.res]?.jpg ?? f[map]?.[cfg.res]?.png;
        if (e) jobs.push([e.url, join(dir, `${id}_${map}.${e.url.split('.').pop()}`)]);
      }
    } else {
      const e = f.hdri[cfg.res].hdr;
      jobs.push([e.url, join(dir, `${id}.hdr`)]);
    }
    for (const [url, file] of jobs) { bytes += await save(url, file); files++; }
    console.log(`✓ ${type}/${id} (${jobs.length} files)`);
  }
}
console.log(`done: ${files} files, ${(bytes / 1048576).toFixed(1)} MB downloaded`);
