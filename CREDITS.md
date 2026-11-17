# Credits

## 3D models
- **Stylized Nature MegaKit** (free standard version) by **Quaternius** – <https://quaternius.com/packs/stylizednaturemegakit.html>
  License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Thank you!
  Used: rocks, pebbles, grass, flowers (recoloured lupines), bushes, pines, a common tree; rocks re-materialled as icebergs.
  Bundled into `src/assets/models/nature.glb` by `scripts/models/build.mjs`.

## Painted backdrops
- Mountains, volcano (calm/erupting) and the tidal wave in `src/assets/backdrops/` were generated for this project with the OpenAI image API (`gpt-image-1.5`), using the project's own UI mock-up as style reference. Prompts: `scripts/backdrops/spec.mjs`.

## Libraries
- [three.js](https://threejs.org) (MIT), including its glTF loader, meshopt decoder and post-processing passes.
- Build tooling: Vite, Vitest, TypeScript, sharp, glTF Transform.
