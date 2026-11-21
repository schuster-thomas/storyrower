// Which sounds the game uses and where they come from.
//
// Every slot is filled from CC0 (public domain) recordings on Freesound – free for any use,
// no attribution required. `fetch.mjs` searches the Freesound API with the queries below and
// downloads the best-rated matches; `process.mjs` cuts them into game-ready Opus files.
//
//   kind     'oneshot' – short sounds; `variants` of them are cut (several per file when `slice`)
//            'loop'    – one seamless loop of `len` seconds, taken from the steadiest part
//   duration Freesound duration filter in seconds [min, max]
//   files    how many recordings to download (the best `variants` cuts are kept)
//   pin      Freesound ids to use instead of the search (listen on freesound.org/s/<id>/)
//   exclude  Freesound ids that turned out wrong
//   disabled no usable recording – the slot stays empty (the game skips it)
//   generated not on Freesound: made with scripts/audio/generate.mjs, picked by ear
//   must     the title or tags must contain one of these (sub)words
//   maxLen   longest one-shot cut in seconds
//   minLen   shortest cut (keeps the tail of sounds in a busy recording)
//   preRoll  single effects: at most this many seconds before the loudest moment (default 2.5)
//   whole    keep a finished, designed sound as it is (only silence trimmed)
//   stereo   keep stereo (ambience loops); everything else is folded to mono
//
// Files you add yourself to assets/raw/audio/<slot>/ (any format Blender reads: wav, ogg,
// mp3, flac) are processed too – e.g. from the Sonniss GDC bundles (royalty free, no attribution).
export const SOUNDS = {
  // ---- the stroke: only the blade going in and pushing water (no knocks, no drips) ----
  'oar-catch': {
    kind: 'oneshot', variants: 6, maxLen: 1.6, slice: true, files: 3, duration: [0.3, 40],
    // EpicWizard "Water_Paddle" lake field recordings; 316589 has a hollow knock in it
    pin: [316580, 316578, 316588, 316579, 316590, 316593],
    exclude: [316589],
    must: ['oar', 'paddl', 'rowing', 'splash'],
    queries: ['oar splash', 'paddle splash', 'rowing oar water'],
  },
  // drive and release cut from whole-boat recordings: mostly oar knocks – left out
  'oar-drive': {
    disabled: true, kind: 'oneshot', variants: 4, maxLen: 1.4, minLen: 0.8, slice: true, files: 2, duration: [1, 60],
    pin: [249707, 588307], // paddles rowing on a calm stream; rowing boat from inside
    must: ['oar', 'paddl', 'rowing', 'kayak', 'canoe'],
    queries: ['paddle stroke water', 'rowing boat oars', 'kayak paddling'],
  },
  'oar-release': {
    disabled: true, kind: 'oneshot', variants: 4, maxLen: 1.2, minLen: 0.4, slice: true, files: 2, duration: [0.3, 30],
    pin: [390391, 536188, 842162], // small splashes, drips
    must: ['drip', 'droplet', 'splash', 'oar', 'paddl'],
    queries: ['water drips', 'dripping water splash small'],
  },
  // nothing fitting in CC0 (only piano pedals and chairs); the generated ones were left out by ear
  rowlock: { kind: 'oneshot', variants: 4, maxLen: 0.8, slice: true, generated: true, disabled: true },

  // ---- ambience loops ----
  'water-calm': {
    kind: 'loop', len: 12, files: 1, duration: [14, 600], stereo: true,
    pin: [318064], // Water_Lapping_River
    must: ['lapping', 'lap', 'hull', 'boat', 'shore'],
    queries: ['water lapping boat', 'water lapping hull', 'lake water lapping'],
  },
  'water-fast': {
    kind: 'loop', len: 10, files: 1, duration: [12, 600], stereo: true,
    pin: [360631], // sailing boat bow wave, close
    must: ['boat', 'hull', 'wake', 'bow', 'rowing', 'kayak', 'canoe', 'sail'],
    queries: ['boat moving through water', 'boat bow wave', 'rowing boat water'],
  },
  river: {
    kind: 'loop', len: 16, files: 1, duration: [18, 900], stereo: true,
    pin: [588178], // Mountain River 002
    must: ['river', 'stream', 'creek', 'brook'],
    queries: ['river ambience', 'river flowing', 'stream water flowing'],
  },
  wind: {
    kind: 'loop', len: 16, files: 1, duration: [18, 900], stereo: true,
    pin: [117504], // winter wind, cold whistling
    must: ['wind'],
    queries: ['wind ambience', 'cold wind', 'wind howling'],
  },
  seabirds: {
    kind: 'loop', len: 20, files: 1, duration: [22, 900], stereo: true,
    pin: [510912], // seagulls, Lofoten
    must: ['gull', 'seabird', 'puffin', 'colony', 'kittiwake', 'tern'],
    queries: ['seabird colony', 'seagulls ambience', 'puffin colony'],
  },
  rumble: {
    kind: 'loop', len: 12, files: 1, duration: [14, 600], stereo: true,
    pin: [17785], // Earth-01, volcano rumble
    must: ['rumble', 'drone', 'volcan', 'lava', 'earth'],
    queries: ['deep rumble', 'volcano rumble', 'earth rumble'],
  },

  // ---- story effects ----
  gull: {
    kind: 'oneshot', variants: 4, maxLen: 1.6, slice: true, files: 2, duration: [0.3, 40],
    pin: [263786, 73497, 836859, 538016], // single gull calls, herring gull
    must: ['gull'],
    queries: ['seagull call', 'gull call', 'seagull'],
  },
  quake: {
    kind: 'oneshot', variants: 1, maxLen: 5, files: 1, duration: [3, 60],
    pin: [222521], // Cracking Earthquake
    must: ['earthquake', 'quake', 'tremor', 'rumble'],
    queries: ['earthquake', 'earthquake rumble'],
  },
  'ice-crack': {
    kind: 'oneshot', variants: 2, maxLen: 2.5, slice: true, files: 2, duration: [0.3, 30],
    pin: [262633, 262635, 177214], // Ice Crack 3/1, Ice Crack 8
    must: ['ice'],
    queries: ['ice crack', 'ice cracking'],
  },
  'ice-splash': {
    kind: 'oneshot', variants: 1, maxLen: 5, files: 1, duration: [1.5, 30],
    pin: [442773], // Big Water Splash
    must: ['splash'],
    queries: ['huge splash', 'big splash water', 'large splash'],
  },
  eruption: {
    kind: 'oneshot', variants: 1, maxLen: 6, preRoll: 0.3, files: 1, duration: [2, 60],
    pin: [710561], // Mount Yasur volcano (felixblume)
    must: ['volcan', 'eruption', 'explosion', 'blast'],
    queries: ['volcano eruption', 'big explosion rumble', 'explosion distant'],
  },
  wave: {
    kind: 'oneshot', variants: 1, maxLen: 7, files: 1, duration: [3, 60],
    pin: [376801], // Crashing Waves into Rocks 2
    must: ['wave', 'surf', 'tsunami', 'ocean'],
    queries: ['big wave crash', 'ocean wave crash', 'tsunami'],
  },
  'rock-splash': {
    kind: 'oneshot', variants: 3, maxLen: 2, slice: true, files: 2, duration: [0.3, 30],
    pin: [583348, 609942, 609941], // Rock Splash
    must: ['splash', 'plop', 'stone', 'rock'],
    queries: ['rock splash water', 'stone thrown into water', 'object falling into water'],
  },

  // ---- Tokyo Super Row: a Japanese garden on one bank, the city on the other ----
  city: {
    kind: 'loop', len: 20, files: 1, duration: [22, 900], stereo: true,
    pin: [580646], // urban ambience outside an apartment, sunny day – distant traffic, no voices
    must: ['city', 'traffic', 'urban', 'street', 'tokyo', 'downtown'],
    queries: ['distant city traffic ambience', 'tokyo city ambience', 'urban ambience distant traffic hum'],
  },
  'garden-birds': {
    kind: 'loop', len: 20, files: 1, duration: [22, 900], stereo: true,
    pin: [524526], // Japanese bush warbler (uguisu) in a city ambiance
    must: ['bird', 'warbler', 'uguisu', 'songbird', 'garden', 'park'],
    queries: ['japanese bush warbler', 'uguisu', 'japan park birds', 'garden birds spring morning'],
  },
  // no CC0 recording of a bamboo deer scarer on Freesound: generated (scripts/audio/generate.mjs)
  'shishi-odoshi': { kind: 'oneshot', variants: 2, maxLen: 3, whole: true, generated: true },
  'wind-chime': {
    kind: 'oneshot', variants: 2, maxLen: 4, minLen: 2.5, slice: true, files: 2, duration: [1, 60],
    pin: [501168, 867567], // a Japanese furin; glass chimes in a soft breeze
    exclude: [67112],
    must: ['chime', 'furin', 'bell'],
    queries: ['furin wind chime', 'japanese wind chime', 'glass wind chime'],
  },
  crow: {
    kind: 'oneshot', variants: 3, maxLen: 2, slice: true, files: 3, duration: [0.3, 40],
    pin: [361470, 813115, 741366], // single caws – the crows of Tokyo's parks
    must: ['crow', 'raven'],
    queries: ['crow caw', 'jungle crow', 'crow call'],
  },
  train: {
    kind: 'oneshot', variants: 1, maxLen: 9, files: 1, duration: [5, 90],
    must: ['train', 'railway', 'subway', 'metro'],
    queries: ['train passing distant', 'commuter train passing', 'train passing over bridge'],
  },

  // ---- Mauritius Shark Madness: a tropical lagoon, then a thunderstorm ----
  surf: {
    kind: 'loop', len: 20, files: 1, duration: [22, 900], stereo: true,
    pin: [848039], // gentle waves on a sand beach
    must: ['wave', 'surf', 'ocean', 'beach', 'sea', 'shore'],
    queries: ['tropical beach waves', 'gentle ocean waves beach', 'sea waves on sand beach'],
  },
  'tropical-birds': {
    kind: 'loop', len: 20, files: 1, duration: [22, 900], stereo: true,
    pin: [615746], // village weavers and other tropical birds on Réunion, Mauritius' neighbour
    must: ['bird', 'tropical', 'jungle', 'rainforest', 'island'],
    queries: ['tropical island birds', 'tropical birds morning', 'rainforest birds ambience'],
  },
  'palm-wind': {
    kind: 'loop', len: 16, files: 1, duration: [18, 900], stereo: true,
    pin: [423800], // wind through palm trees
    must: ['wind', 'palm', 'leaves', 'trees', 'storm'],
    queries: ['wind in palm trees', 'strong wind palm leaves', 'storm wind trees'],
  },
  rain: {
    kind: 'loop', len: 14, files: 1, duration: [16, 900], stereo: true,
    pin: [435221], // heavy rain, clean (no thunder in it – the game times its own)
    must: ['rain'],
    queries: ['heavy rain on water', 'tropical rain heavy', 'heavy rain storm'],
  },
  thunder: {
    kind: 'oneshot', variants: 3, maxLen: 8, minLen: 4, preRoll: 0.4, files: 3, duration: [4, 90],
    pin: [243614, 17054, 778363], // a lightning strike, a thunder clap, distant rumbling
    must: ['thunder', 'lightning'],
    queries: ['thunder crack close', 'thunder clap', 'thunder rumble'],
  },
  motorboat: {
    kind: 'oneshot', variants: 1, maxLen: 9, files: 1, duration: [5, 90],
    pin: [451402], // a boat engine passing by fast
    must: ['boat', 'motor', 'speedboat', 'engine'],
    queries: ['speedboat passing by', 'motorboat pass by', 'boat engine passing'],
  },

  // ---- generated with ElevenLabs (scripts/audio/generate.mjs) – no CC0 recording fits ----
  // puffin: generated calls came out as wind or as a lion – left out, the gulls stay
  puffin: { kind: 'oneshot', variants: 4, maxLen: 2, slice: true, generated: true, disabled: true },
  ash: { kind: 'loop', len: 10, stereo: true, generated: true },
  calving: { kind: 'oneshot', variants: 1, maxLen: 8, whole: true, generated: true },
  'tidal-wave': { kind: 'oneshot', variants: 1, maxLen: 9, whole: true, generated: true },
  escape: { kind: 'oneshot', variants: 1, maxLen: 4, whole: true, generated: true },
  sunset: { kind: 'oneshot', variants: 1, maxLen: 5, whole: true, generated: true },
};
