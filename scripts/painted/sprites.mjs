// Painted cut-out sprites for things that must stand upright (they would lie flat if projected
// onto the ground): lupine clumps. Generated with a transparent background, split into tiles and
// packed into an atlas.
//   node scripts/painted/sprites.mjs [--force]   → src/assets/painted/lupines.webp (4 tiles side by side)
import { existsSync, mkdirSync } from 'node:fs';
import { generateSprites, packAtlas } from './atlas.mjs';

const RAW = 'assets/raw/painted/sprites';
mkdirSync(RAW, { recursive: true });
const raw = `${RAW}/lupines.png`;
if (!existsSync(raw) || process.argv.includes('--force')) {
  await generateSprites(raw, 'Four separate clumps of Nootka lupines in a row, evenly spaced with clear gaps, not touching: each clump is a bushy cluster of tall flower spikes in purple, violet and blue (a few pinkish) on dense green palmate leaves, about as tall as wide, standing upright on its base. Painted in exactly the style, palette and light of the reference image (premium stylised game art, soft painterly detail, bright morning light). Fully transparent background, no ground, no shadow, no text.',
    'assets/raw/painted/cliffs/painted.png');
}
mkdirSync('src/assets/painted', { recursive: true });
await packAtlas(raw, 'src/assets/painted/lupines.webp', 'bottom');
