// Painted assets of the "Mauritius Shark Madness" level, generated with the OpenAI image API in the
// style of the level's mock-up (screenshots/mauritius/01-lagoon.png), then cut into game textures.
//   node scripts/mauritius/assets.mjs                 – generate what is missing, then pack everything
//   node scripts/mauritius/assets.mjs palms --force   – regenerate one asset
//   node scripts/mauritius/assets.mjs --pack          – only pack (no API calls)
// Raw PNGs: assets/raw/levels/mauritius/ (not committed). Game files: src/assets/levels/mauritius/.
// The *-concept images are the references for the Tripo3D models (scripts/mauritius/models.mjs).
import { runAssets } from '../levels/assets-lib.mjs';

const RAW = 'assets/raw/levels/mauritius';
const OUT = 'src/assets/levels/mauritius';
const REF = 'screenshots/mauritius/01-lagoon.png';

const STYLE = 'Painted in exactly the style, palette and light of the reference image (premium stylised console adventure game art in the spirit of Mario Kart 8: clean readable shapes, saturated tropical colours, soft painterly detail, bright sunny morning light).';
const MODEL = ' Seen from the side at a three-quarter angle from slightly above, the whole object visible, alone on a plain white background, evenly lit, no shadow, no ground, no water, no text, no logos. Painted in the style of the reference image (premium stylised console game art, clean readable shapes, rich colours).';
const CUTOUT = 'Fully transparent background, no ground plane, no cast shadow, no water, no sand, no text, no logos, no people.';
const TILE = 'Seamless tileable texture: the left edge continues exactly into the right edge and the top edge into the bottom edge. Seen from straight above, filling the whole image edge to edge – no perspective, no horizon, no sky, no frame, no border, no text, no people.';

const ASSETS = [
  {
    // the coast of the south-west of the island on the right of the boat: an arc from just left of
    // straight ahead (where the land meets the horizon) round to the right
    id: 'coast', kind: 'panorama', size: '3072x1024',
    prompt: `${STYLE} A very wide panoramic backdrop of the south-west coast of a tropical volcanic island, seen from a boat on the sea. On the far left, low green headland tapering down to the horizon. In the left third: a huge, dramatic basalt monolith mountain with a broad, slightly slanted almost flat summit plateau and sheer, vertically ridged rock cliffs in grey, brown and ochre with green moss and bushes in the ledges, its lower slopes and foothills covered in lush green tropical forest (in the spirit of Le Morne Brabant in Mauritius, but an original painting). To the right of it: a long chain of lower, rolling, jungle-covered green hills and a few rocky ridges, getting paler and bluer with distance towards the right edge. Soft atmospheric haze at the base. The mountains fill the lower 80% of the image, the big monolith reaching almost to the top; everything above the ridgeline is a perfectly flat, uniform, pure magenta (#FF00FF) background – no clouds, no sky gradient, no magenta in the subject. The bottom edge is a straight horizontal line of green forest. No beach, no sea, no palms, no buildings, no text, no logos.`,
  },
  {
    id: 'palms', kind: 'atlas', position: 'bottom', size: '1536x1024',
    prompt: `${STYLE} Four separate tall coconut palm trees in a row, each in its own quarter of the image with WIDE empty transparent gaps between them – no fronds may reach into a neighbour's quarter – each standing upright on the base of its trunk: (1) a tall palm with a slender, gently curved trunk leaning to the right and a full crown of bright green fronds with a few coconuts; (2) a tall, almost straight palm; (3) a palm with a strongly curved trunk leaning to the left; (4) a shorter palm with a thicker trunk and a big, lush crown. Ringed grey-brown trunks, glossy sunlit fronds in yellow-greens and deep greens. ${CUTOUT}`,
  },
  {
    id: 'tropic', kind: 'atlas', position: 'bottom', size: '1536x1024',
    prompt: `${STYLE} Four separate tropical plants in a row, each in its own quarter of the image with WIDE empty transparent gaps between them, each standing on its base: (1) a rounded hibiscus bush covered in big red flowers; (2) a bush of magenta-pink bougainvillea; (3) a banana plant with huge fresh green leaves; (4) a lush, wide clump of big-leaved green tropical shrubs and ferns with a few orange flowers. Nothing under the plants – no puddle, no water, no reflection, no soil patch. ${CUTOUT}`,
  },
  { id: 'sand', kind: 'texture', size: '1024x1024', out: 512, prompt: `${TILE} Fine, bright, warm white-golden tropical beach sand with very soft wind ripples, a few tiny shell fragments and pale pebbles. ${STYLE}` },
  { id: 'jungle', kind: 'texture', size: '1024x1024', out: 512, prompt: `${TILE} Dense tropical rainforest canopy of a hillside: rounded tree crowns and palm crowns in many fresh and deep greens, a few red flame-tree blossoms among them. ${STYLE}` },
  { id: 'scrub', kind: 'texture', size: '1024x1024', out: 512, prompt: `${TILE} The ground at the back of a tropical beach: sandy soil with patches of bright green creeping beach grass and morning-glory vines, a few fallen dry palm fronds and coconuts. ${STYLE}` },
  // concepts for the Tripo3D models
  { id: 'shark-concept', kind: 'raw', size: '1536x1024', ref: 'screenshots/mauritius/03-shark-overtake.png', prompt: `A single huge great white shark, full body, the body perfectly straight from snout to tail, seen from the side at a three-quarter angle from slightly above, jaws open showing rows of white teeth, slate grey-blue back, clean white belly, a big triangular dorsal fin, wide pectoral fins, a tall crescent tail fin, small dark eyes. Painterly stylised premium console game look (like the reference image).${MODEL}` },
  { id: 'speedboat-concept', kind: 'raw', size: '1536x1024', prompt: `A small sporty open motorboat (a 6 m runabout) with a glossy white hull with red and navy stripes, a curved windscreen, white and teal seats, a black outboard engine at the stern and a small water-ski tow pylon behind the seats, one driver in a cap and sunglasses at the wheel.${MODEL}` },
  { id: 'skier-concept', kind: 'raw', size: '1024x1024', prompt: `A water-skier in full action pose: a young man in a bright yellow life vest and red board shorts, standing on two long water skis, knees bent and leaning back, both hands holding a short tow handle bar in front of him at hip height – only the handle, no rope –, the whole figure and both skis visible.${MODEL}` },
  { id: 'surfer-concept', kind: 'raw', size: '1024x1024', prompt: `A surfer riding a surfboard: a young woman in a teal rash-guard and board shorts standing sideways on a long white surfboard with an orange stripe, knees bent, arms spread for balance, the whole figure and the whole board visible.${MODEL}` },
  { id: 'snorkeler-concept', kind: 'raw', size: '1536x1024', prompt: `A snorkeler floating face down, the body lying perfectly horizontal and stretched out, seen from the side and slightly above: a diving mask, a bright yellow snorkel tube sticking up from the head, a blue rash-guard, black swim shorts and long yellow fins, arms along the body.${MODEL}` },
  { id: 'loungers-concept', kind: 'raw', size: '1536x1024', prompt: `Two white wooden beach sun loungers side by side with turquoise cushions and a striped towel, under one round thatched straw beach parasol on a wooden pole between them.${MODEL}` },
  { id: 'hut-concept', kind: 'raw', size: '1024x1024', prompt: `A small tropical beach bar hut: four wooden posts, a steep, shaggy thatched palm-leaf roof, a bamboo counter with a few colourful bottles and two bar stools, open sides.${MODEL}` },
  { id: 'pirogue-concept', kind: 'raw', size: '1536x1024', prompt: `A traditional wooden fishing pirogue of Mauritius: a long, narrow open wooden boat with a pointed bow and stern, painted in bright colours – turquoise hull, yellow and red stripes along the gunwale, white inside – with two wooden benches and a coiled rope, empty, no mast.${MODEL}` },
];

await runAssets({ RAW, OUT, REF, ASSETS });
