# Credits

## 3D models
- **Stylized Nature MegaKit** (free standard version) by **Quaternius** – <https://quaternius.com/packs/stylizednaturemegakit.html>
  License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Thank you!
  Used in the game: rocks (shore boulders, and re-materialled as icebergs). Bundled into `src/assets/models/nature.glb` by `scripts/models/build.mjs`.
- **Puffins:** generated for this project with [Tripo3D](https://www.tripo3d.ai) (image-to-model) from the project's puffin model sheet and a flight-pose reference made with the OpenAI image API; oriented and scaled by `scripts/blender/puffin.py`.
- **Rower:** generated for this project with [Tripo3D](https://www.tripo3d.ai) (image-to-model and auto-rigging) from a reference image made with the OpenAI image API; posed and animated in Blender by `scripts/blender/boat_rower.py`.
- **Racing scull and oars:** modelled from scratch by `scripts/blender/boat.py`.

## Painted backdrops and concept art
- The mountain panorama in `src/assets/backdrops/`, the painted river banks, volcano, icebergs, rocks, lupines and ash puffs in `src/assets/painted/`, and the style frames and model sheets in `docs/art/`, were generated for this project with the OpenAI image API (`gpt-image-1.5`, `gpt-image-2`), using the project's own UI mock-up as style reference. Prompts: `scripts/backdrops/spec.mjs`, `scripts/concepts/spec.mjs`.

## Earlier experiments (no longer in the game)
- **Poly Haven** scans, textures and HDRIs (CC0) were used for the first photo-scanned river section (`scripts/blender/section_fjord.py`), dropped in the art rework.

## Libraries
- [three.js](https://threejs.org) (MIT), including its glTF loader, meshopt decoder and post-processing passes.
- Build tooling: Vite, Vitest, TypeScript, sharp, glTF Transform, Blender (boat building, rigging and baking).
