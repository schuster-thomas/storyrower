# Credits

## 3D models
- **Stylized Nature MegaKit** (free standard version) by **Quaternius** – <https://quaternius.com/packs/stylizednaturemegakit.html>
  License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Thank you!
  Used: rocks, pebbles, grass, flowers (recoloured lupines), bushes, pines, a common tree; rocks re-materialled as icebergs.
  Bundled into `src/assets/models/nature.glb` by `scripts/models/build.mjs`.

## Scanned rocks, textures and sky
- **Poly Haven** – <https://polyhaven.com>, all assets [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Thank you!
  Models: coastal_cliff_01, rock_face_01, rock_face_02, mountainside, boulder_01, rock_moss_set_01.
  Textures: mossy_rock, rock_face, sparse_grass, aerial_grass_rock, lichen_rock. HDRIs: kloofendal_48d_partly_cloudy_puresky, qwantani_morning_puresky.
  Composed and light-baked into the river section `src/assets/sections/fjord.glb` by `scripts/blender/section_fjord.py`.

## Painted backdrops
- Mountains, volcano (calm/erupting) and the tidal wave in `src/assets/backdrops/` were generated for this project with the OpenAI image API (`gpt-image-1.5`), using the project's own UI mock-up as style reference. Prompts: `scripts/backdrops/spec.mjs`.

## Libraries
- [three.js](https://threejs.org) (MIT), including its glTF loader, meshopt decoder and post-processing passes.
- Build tooling: Vite, Vitest, TypeScript, sharp, glTF Transform, Blender (section building and light baking).
