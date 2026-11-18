// Style frames and model sheets: the visual target for the art rework (CONCEPT.md §9.6).
// Generated with the OpenAI image API by scripts/concepts/generate.mjs.

export const MOCKUP = 'screenshots/Vulkanrudern im isländischen Abenteuerland.png';
export const PANORAMA = 'screenshots/ChatGPT-Bild 18. Nov. 2026, 00_21_56.png';

export const STYLE = [
  'Art style: a premium stylised console racing/adventure game in the spirit of Mario Kart 8 –',
  'clean, readable shapes, saturated but natural colours, soft painterly textures, gentle stylisation, not photorealistic.',
  'Every element must be instantly recognisable. No text, no logos, no UI, no watermark.',
].join(' ');

const SCENE = [
  'Location: a wide Icelandic glacier lagoon / fjord, about 150 m wide.',
  'Left shore: angular, stepped basalt slopes and cliffs covered in bright green moss and grass, patches of snow higher up, two tall white waterfalls,',
  'fields of purple and blue lupine flowers (tall flower spikes) along the shore, and a group of Atlantic puffins (black back, white face and belly, big orange-red-yellow striped beak, orange feet) sitting on a mossy rock in the left foreground, clearly recognisable.',
  'Right side: a classic Icelandic glacier tongue that ends in the water as a wall of jagged blue and turquoise ice seracs; white and turquoise icebergs and small ice chunks drift in the water.',
  'Far distance: snow-capped mountains.',
].join(' ');

const CAMERA = [
  'Camera: a third-person chase camera about 2.5 m above the water and 6 m behind the stern of a racing single scull, looking forward in the direction of travel.',
  'The rower sits in the boat facing the camera – realistic rowing: rowers face the stern, so we see the rower\'s face and chest, not the back.',
  'The rower is an athletic adult in a red and white rowing unisuit, mid-stroke, legs bent, holding two long sculling oars with red-and-white blades that reach out wide over the water on both sides.',
  'The boat and rower sit in the lower centre and take about a third of the image height. Leave the bottom 12% of the image as open water (a UI bar goes there).',
].join(' ');

/** id → model, size, references, background, prompt */
export const ITEMS = [
  {
    id: 'frame-idyll',
    size: '1536x1024',
    refs: [MOCKUP, PANORAMA],
    prompt: `${CAMERA} ${SCENE} A calm volcano with a thin white steam plume sits far away on the horizon, slightly right of centre. Fresh morning light, blue sky with a few puffy clouds, calm turquoise water with gentle ripples and soft reflections.`,
  },
  {
    id: 'frame-eruption',
    size: '1536x1024',
    refs: [MOCKUP, PANORAMA],
    prompt: `${CAMERA} ${SCENE} The volcano on the horizon is now erupting: a lava fountain at the crater, bright glowing orange lava rivers flowing down its flanks into the sea with white steam clouds where lava meets the water, a huge dark ash plume lit orange from below. Several puffins take off and fly away from the rock. The sky is orange and smoky, the water rougher with white caps, icebergs rocking.`,
  },
  {
    id: 'sheet-rower',
    size: '1536x1024',
    refs: [MOCKUP],
    background: 'opaque',
    prompt: 'Character and prop model sheet on a plain light grey background for a 3D modeller. Top row: a racing single scull (long narrow white hull with a red stripe, two outriggers, sliding seat, foot stretcher, two sculling oars with red-and-white blades) in side view and top view. Bottom row: an athletic adult rower in a red and white rowing unisuit, short hair, sitting in the boat, shown in the four phases of a rowing stroke from the side – catch (knees bent, arms reaching forward to the stern), drive (legs pushing), finish (leaning back, hands at the chest), recovery – plus one front view facing the stern. Consistent proportions in every view, slightly stylised, friendly face.',
  },
  {
    // input for Tripo3D image-to-model: one clean full-body view in A-pose
    id: 'ref-rower-apose',
    size: '1024x1536',
    refs: ['assets/raw/concepts/sheet-rower.png'],
    prompt: 'Full-body character reference for 3D model generation: exactly the rower character from the reference sheet (athletic adult, short brown hair, friendly face, red and white rowing unisuit, white socks and light sneakers). Standing in a neutral A-pose: arms straight and angled down about 45 degrees away from the body, palms facing down, fingers together, legs straight and slightly apart. Front view, facing the camera, the whole body from head to feet in frame with some margin. Plain light grey background, soft even lighting, no cast shadows, no oars, no boat, no props.',
  },
  {
    // second version: closed fists, because the auto-rig has no finger bones to close open hands
    id: 'ref-rower-fists',
    size: '1024x1536',
    refs: ['assets/raw/concepts/ref-rower-apose.png'],
    prompt: 'Exactly the same character, outfit, proportions, pose and framing as the reference image, with one change: both hands are closed into compact loose fists as if gripping a horizontal bar – fingers curled tightly, thumbs tucked along the index fingers, backs of the hands facing outwards and slightly up, wrists straight. The hands are a natural, slightly small size. Neutral A-pose, front view, plain light grey background, soft even lighting, no shadows, no props.',
  },
  {
    // technique reference for the stroke animation
    id: 'stroke-front',
    size: '1536x1024',
    refs: ['assets/raw/concepts/ref-rower-fists.png', 'assets/raw/concepts/sheet-rower.png'],
    background: 'opaque',
    prompt: 'Rowing technique reference sheet, plain light grey background, four panels in a row labelled only by position (no text). The same athlete in a racing single scull, seen from directly behind the stern at chest height, so the sculler faces the viewer. Correct sculling technique, anatomically accurate: 1 the catch – shins vertical, body leaning forward from the hips, arms fully straight reaching forward, hands about shoulder-width apart; 2 the drive – legs pushing, arms still straight; 3 the finish – legs flat, body leaning slightly back, hands drawn in to the lower ribs, elbows pointing outwards and back past the body, forearms horizontal; 4 the recovery – arms straight again, body pivoted forward, knees starting to rise. In every panel the hands hold the ends of the oar handles in an overhand grip: palms facing down, knuckles up, fingers wrapped around the handle, thumbs on the end of the handle, wrists flat and in line with the forearms (not bent). Left hand slightly ahead of and above the right one where the handles overlap.',
  },
  {
    id: 'stroke-side',
    size: '1536x1024',
    refs: ['assets/raw/concepts/ref-rower-fists.png', 'assets/raw/concepts/sheet-rower.png'],
    background: 'opaque',
    prompt: 'Rowing technique reference sheet, plain light grey background, four panels in a row, no text. The same athlete in a racing single scull seen exactly from the side, boat moving to the left (the sculler faces right, towards the stern). Correct sculling technique: 1 catch – compressed, shins vertical, body angled forward about 30 degrees, arms straight, blades square and just entering the water behind the athlete; 2 drive – legs pushing, body still forward, arms straight, blades in the water; 3 finish – legs flat, body leaning back about 15 degrees, hands at the lower ribs, elbows behind the body, blades coming out; 4 recovery – hands away first, body forward, then sliding forward with knees rising, blades feathered flat above the water. Overhand grip on the handle ends, wrists flat in line with the forearms.',
  },
  {
    id: 'sheet-puffin',
    size: '1536x1024',
    refs: [MOCKUP],
    background: 'opaque',
    prompt: 'Creature model sheet on a plain light grey background for a 3D modeller: an Atlantic puffin, slightly stylised but anatomically recognisable (not a cartoon mascot) – black back and wings, white face disc and belly, big triangular beak striped orange-red, yellow and blue-grey, orange feet, small dark eye with a grey eye marking. Top row: turnaround – front, side, back, three-quarter view, standing. Bottom row: poses – sitting on a rock, looking around, waddling, taking off with wings raised, flying with fast wingbeats, gliding, carrying small silver fish in the beak.',
  },
  {
    id: 'sheet-ice',
    size: '1536x1024',
    refs: [MOCKUP, PANORAMA],
    background: 'opaque',
    prompt: 'Prop model sheet on a plain light grey background: glacier ice for a stylised game. A row of six floating icebergs from small chunks to a large berg, angular faceted shapes, snowy white tops, turquoise and deep blue sides with cracks and layers, each shown with its waterline and the slightly visible blue part under water. Below: a section of a glacier front – a wall of jagged blue ice seracs with crevasses and a snowy surface, seen from the water.',
  },
  {
    id: 'sheet-shore',
    size: '1536x1024',
    refs: [MOCKUP, PANORAMA],
    background: 'opaque',
    prompt: 'Environment prop sheet on a plain light grey background for an Icelandic shore in a stylised game: clumps of Nootka lupines (tall spikes of purple and blue flowers on green leafy stems, clearly lupines), mossy green angular basalt steps and hexagonal basalt columns, mossy boulders with a puffin burrow, a waterfall segment pouring over a basalt ledge into a foaming pool, snow patches on moss, tufts of grass. Each prop shown separately with a little space around it.',
  },
];
