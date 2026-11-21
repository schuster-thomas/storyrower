// Painted assets of the "Tokyo Super Row" level, generated with the OpenAI image API in the style of
// the level's mock-up (screenshots/tokyo_super_row_1.png), then cut into game textures.
//   node scripts/tokyo/assets.mjs                 – generate what is missing, then pack everything
//   node scripts/tokyo/assets.mjs sakura --force  – regenerate one asset
//   node scripts/tokyo/assets.mjs --pack          – only pack (no API calls)
// Raw PNGs: assets/raw/levels/tokyo/ (not committed). Game files: src/assets/levels/tokyo/.
//
// Sprite sheets hold four separate objects on a transparent background; they are packed into a
// 4 × 1 atlas of 512 px tiles plus a JSON with each object's aspect ratio (width / height), so the
// game can size the cards without distorting them.
import { runAssets } from '../levels/assets-lib.mjs';

const RAW = 'assets/raw/levels/tokyo';
const OUT = 'src/assets/levels/tokyo';
const REF = 'screenshots/tokyo_super_row_1.png';

const STYLE = 'Painted in exactly the style, palette and light of the reference image (premium stylised console adventure game art in the spirit of Mario Kart 8: clean readable shapes, saturated natural colours, soft painterly detail, bright spring morning light).';
const MODEL = ' Seen from the front at a three-quarter angle at eye level, the whole object visible, standing alone on a plain white background, evenly lit, no shadow, no ground, no people, no text. Painted in exactly the style of the reference image (premium stylised console game art, clean readable shapes, rich colours).';
const CUTOUT ='Fully transparent background, no ground plane, no cast shadow, no water, no text, no logos, no people.';

/** id → how it is generated and packed */
const ASSETS = [
  {
    id: 'far', kind: 'panorama', size: '3072x1024',
    prompt: `${STYLE} A very wide panoramic backdrop seen from a river in Tokyo, far away on the horizon: in the left-centre a large, majestic, perfectly shaped snow-capped volcanic cone (classic Japanese sacred mountain look) with long gentle blue-violet slopes and a bright white snow cap with streaks; low hazy blue-green hills on the far left; on the right half a long, low, hazy pale-blue silhouette of a distant modern city skyline (many small high-rise towers, no recognisable buildings, no tower with antenna). Soft atmospheric haze at the base, colours getting paler with distance. The ridge and skyline fill the lower 55% of the image; everything above is a perfectly flat, uniform, pure magenta (#FF00FF) background – no clouds, no sky gradient, no magenta in the subject. The bottom edge is a straight horizontal line of distant haze. No text, no logos, no water, no boats.`,
  },
  {
    id: 'sakura', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate Japanese cherry trees (sakura) in full bloom in a row, evenly spaced with clear transparent gaps, not touching: each has a dark, gnarled, characterful trunk and wide, layered, cloud-like canopies of soft pink blossoms (light pink to deeper pink, a few white highlights), some branches reaching far out to one side; different shapes: one wide and spreading, one tall, one leaning to the right, one smaller and round. Each stands upright on the base of its trunk. ${CUTOUT}`,
  },
  {
    id: 'garden', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate elements of a traditional Japanese garden in a row, evenly spaced with clear transparent gaps, not touching, each seen from the front at eye level and standing upright on its base: (1) a five-storey wooden pagoda with dark grey curved tiled roofs and vermilion red posts and a golden spire, tall and slender; (2) a small wooden tea pavilion on a stone base with a dark curved tiled roof, warm wooden walls, sliding paper screens and a small veranda; (3) a tall grey stone lantern (ishidoro) with a curved cap; (4) a carefully pruned Japanese black pine with cloud-shaped flat green foliage pads on a twisting trunk. ${CUTOUT}`,
  },
  {
    id: 'shrubs', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate low garden plants in a row, evenly spaced with clear transparent gaps, not touching, each wider than tall and standing on its base: (1) a rounded bush of bright pink azaleas covered in blossoms; (2) a rounded bush of magenta-pink azaleas; (3) a clump of neatly clipped round green box shrubs with a few pink flowers; (4) a small low cherry blossom bush with pink flowers. ${CUTOUT}`,
  },
  {
    // high-rises between the river and the volcano (a ring of its own, in front of the far panorama)
    id: 'skyline', kind: 'panorama', size: '3072x1024',
    prompt: `${STYLE} A very wide panoramic band of a dense modern Tokyo skyline seen from far away across a river, softly hazy: many high-rise towers of different heights and shapes (blue glass towers, white office towers, beige apartment blocks), a few taller towers in the middle and on the right, all with regular window grids, pale blue haze making the furthest ones lighter. The skyline fills the lower 45% of the image and its bottom edge is a straight horizontal line of low hazy buildings. Everything above the rooftops is a perfectly flat, uniform, pure magenta (#FF00FF) background – no clouds, no sky gradient, no mountains, no magenta in the subject. No red-and-white lattice tower, no text, no logos, no water.`,
  },
  {
    id: 'pagoda', kind: 'single', size: '1024x1536',
    prompt: `${STYLE} One tall five-storey Japanese pagoda standing alone, seen from the front at a slight angle: bright vermilion red posts, beams and balconies with white plaster panels, five wide sweeping roofs in weathered green-grey copper with upturned corners and small bronze bells, a tall dark bronze spire with nine rings on top, on a low grey stone base. Like a famous mountain pagoda overlooking cherry trees, but standing alone. It fills the full height of the image. ${CUTOUT}`,
  },
  {
    id: 'dragon-concept', kind: 'raw', size: '1536x1024', ref: 'screenshots/tokyo/03-monster-lasers-v6-dragon-large-fuji.png',
    prompt: 'A single original fantasy dragon for a 3D model reference, full body, seen from the front three-quarter view in a neutral T-pose-like flying pose with both large bat-like wings spread wide and fully visible, on a plain white background, evenly lit, no shadows. Deep crimson red scales with darker red back plates, a golden-bronze armoured belly, two large curved ivory horns swept back, a spiky frill, glowing magenta eyes, open jaws with white fangs, muscular arms and legs with dark claws, a long spiked tail. Painterly stylised premium console game look (like the reference image). Nothing else in the image, no text.',
  },
  {
    // more variety for the garden than cherry trees: maples, a willow over the water, bamboo
    id: 'trees', kind: 'atlas', position: 'bottom', size: '1536x1024',
    prompt: `${STYLE} Four separate, fairly small trees of a Japanese garden in a row, each in its own quarter of the image with WIDE empty transparent gaps between them – no leaves or branches may reach into a neighbour's quarter – each standing upright on the base of its trunk: (1) a Japanese maple (momiji) with a layered, airy crown of bright red-orange leaves; (2) a Japanese maple with fresh light-green spring leaves and a gracefully curved trunk; (3) a weeping willow with long hanging curtains of fresh green leaves, as wide as tall; (4) a tall clump of green bamboo stalks with feathery leaves, taller than wide. ${CUTOUT}`,
  },
  // concepts for Tripo3D models (scripts/tripo/tripo.mjs image …): small buildings for the garden
  { id: 'house-concept', kind: 'raw', size: '1024x1024', prompt: `A small traditional Japanese wooden garden house (machiya style) with dark grey curved ceramic roof tiles, warm brown timber walls, white plaster panels, paper sliding doors and a small engawa veranda on a low stone base.${MODEL}` },
  { id: 'pagoda3-concept', kind: 'raw', size: '1024x1536', prompt: `A slender three-storey Japanese pagoda (sanjunoto) of dark natural wood with white plaster panels, three wide dark grey tiled roofs with upturned corners and a bronze spire with rings, on a stone base.${MODEL}` },
  { id: 'shrine-concept', kind: 'raw', size: '1024x1024', prompt: `A small Shinto shrine building: a vermilion red wooden hall with a sweeping dark green copper roof with crossed chigi beams on top, a short flight of wooden steps, a straw rope with white paper streamers over the entrance, on a stone base.${MODEL}` },
  {
    id: 'tower', kind: 'single', size: '1024x1536',
    prompt: `${STYLE} One tall, slender steel lattice observation and broadcast tower standing alone, seen from the front at a distance: four splayed legs that taper upwards, painted in alternating bands of international orange-red and white, a two-storey observation deck about one third up and a smaller deck about two thirds up, then a thin antenna mast at the top. Original design, no logos, no signs. It fills the full height of the image. ${CUTOUT}`,
  },
];

await runAssets({ RAW, OUT, REF, ASSETS });
