// Painted backdrop layers for the Iceland level. Generated with the OpenAI image API,
// using the original UI mock-up as style reference (scripts/backdrops/generate.mjs).

export const STYLE = [
  'Stylised painterly video-game art in exactly the style, palette and lighting of the reference image:',
  'bright, friendly, high-quality console game look (like a premium stylised kart or adventure game),',
  'soft painterly shading, clean readable shapes, rich but natural colours, gentle atmospheric depth.',
  'Isolated element on a fully transparent background. No text, no logos, no UI, no people, no boats, no frame or border.',
].join(' ');

/** id → prompt, size, how it is used in the game */
export const LAYERS = [
  {
    id: 'mountains',
    size: '1536x1024',
    prompt: 'A long, wide panoramic ridge of Icelandic mountains seen from far away: dark volcanic rock with large snow caps and glaciers, a few soft mist bands at their base. The ridge spans the full width and fills the lower 55% of the image; everything above the peaks is transparent. The bottom edge is a straight horizontal line of distant hazy slopes so it can sit on the horizon.',
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
    id: 'cliff-waterfalls',
    size: '1536x1024',
    prompt: 'A riverside cliff section seen from the side: tall dark basalt column cliffs covered with bright green moss on top, two elegant waterfalls pouring down into white mist, a small rainbow in the spray, purple lupine flowers and grass at the foot of the cliff. The cliff spans the full width; its bottom edge is a straight horizontal line of grass and flowers. Transparent sky above.',
  },
  {
    id: 'cliff-green',
    size: '1536x1024',
    prompt: 'A riverside hillside seen from the side: rolling bright green mossy hills with a few dark lava rocks and small basalt outcrops, scattered purple lupine flowers, a puffin colony suggested by tiny white dots on a ledge. Spans the full width; bottom edge is a straight horizontal line of grass. Transparent sky above.',
  },
  {
    id: 'iceberg-a',
    size: '1024x1024',
    prompt: 'A single floating iceberg chunk, angular glacier ice in white and turquoise blue with subtle cracks, flat waterline at the bottom edge, as seen from water level. Transparent background.',
  },
  {
    id: 'iceberg-b',
    size: '1024x1024',
    prompt: 'A cluster of three small floating ice floes and a medium iceberg, white and turquoise glacier ice, flat waterline at the bottom edge, as seen from water level. Transparent background.',
  },
  {
    id: 'tidal-wave',
    size: '1536x1024',
    prompt: 'A massive towering tidal wave seen from the front, curling over at the top, deep teal-blue water with bright white foam and spray along the crest, spanning the full width. The bottom edge is a straight horizontal line of churning white foam. Transparent background above and around the wave.',
  },
];
