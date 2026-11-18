// Painted backdrop layers for the Iceland level. Generated with the OpenAI image API,
// using the original UI mock-up as style reference (scripts/backdrops/generate.mjs).

export const STYLE = [
  'Stylised painterly video-game art in exactly the style, palette and lighting of the reference image:',
  'bright, friendly, high-quality console game look (like a premium stylised kart or adventure game),',
  'soft painterly shading, clean readable shapes, rich but natural colours, gentle atmospheric depth.',
  'Isolated element on a fully transparent background. No text, no logos, no UI, no people, no boats, no frame or border.',
].join(' ');

/** Style of the art rework (CONCEPT.md §9.6): the approved style frame is the reference. */
export const STYLE_V2 = [
  'Stylised video-game background art in exactly the style, palette and light of the reference image',
  '(a premium stylised console game in the spirit of Mario Kart 8: clean readable shapes, saturated natural colours, soft painterly textures).',
  'Isolated element on a perfectly flat, uniform, pure magenta (#FF00FF) background – no gradients, no shadows, no magenta anywhere in the subject.',
  'No text, no logos, no UI, no people, no boats, no frame or border.',
].join(' ');

/** id → prompt, size, how it is used in the game. `chroma` layers use gpt-image-2 on magenta and are keyed out. */
export const LAYERS = [
  {
    id: 'far-mountains',
    size: '3072x1024',
    chroma: true,
    cropBottom: 0.13, // the model painted a strip of water below the slopes
    ref: 'assets/raw/concepts/frame-idyll.png',
    prompt: 'A very wide panoramic ridge of Icelandic mountains far away at the end of a fjord, seen from water level: jagged dark volcanic peaks with large snow fields, green mossy lower slopes on the left half, and on the right half a vast white-blue glacier ice cap flowing down between the peaks. A lower, hazier gap in the middle where the fjord continues. Soft atmospheric haze at the base. The ridge fills the lower 60% of the image; everything above the peaks is the flat magenta background. The bottom edge is a straight horizontal line of distant hazy slopes so it can sit on the horizon.',
  },
  {
    id: 'volcano-calm',
    size: '1024x1024',
    prompt: 'A single large Icelandic stratovolcano seen from a distance, centred, broad dark slopes streaked with old lava and a little snow, a thin harmless plume of white steam rising from the crater. The base of the volcano runs straight along the bottom edge of the image. Transparent sky.',
  },
  {
    id: 'volcano-erupting',
    size: '1024x1024',
    prompt: 'The same Icelandic stratovolcano, centred, now violently erupting: bright orange glowing lava fountain at the crater, glowing lava rivers running down the slopes, a huge billowing dark grey ash plume lit orange from below rising to the top of the image. The base of the volcano runs straight along the bottom edge. Transparent background around the volcano and plume.',
  },
  {
    id: 'tidal-wave',
    size: '1536x1024',
    prompt: 'A massive towering tidal wave seen from the front, curling over at the top, deep teal-blue water with bright white foam and spray along the crest, spanning the full width. The bottom edge is a straight horizontal line of churning white foam. Transparent background above and around the wave.',
  },
];
