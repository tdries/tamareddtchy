# Image-to-3D creature pipeline (Modly / Hunyuan3D) runbook

Turn a Pixar-style creature image into a game-ready 3D creature. The expensive
art is generated offline; the game loads the result. This keeps the live
genome/breeding/world mechanics while giving creatures AI-sculpted quality.

## The flow

```
hero image (you)  ->  Modly image-to-3D (local, Apple Silicon)  ->  raw .glb
   ->  ingest_modly.py (Blender: clean/center/decimate/export)
   ->  src/client/public/assets/creatures/<name>.glb
   ->  game loads it as the creature body (face overlaid, tinted optional)
```

## What you do

1. Install Modly from its Releases (https://github.com/lightningpixel/modly),
   let it download a model. Start with Hunyuan3D (quality leader) or TripoSG
   (faster). It runs on your M4 Pro GPU, no CUDA needed.
2. Make or get a hero creature image (the reference style: groomed fur, big eyes,
   clean white background works best for image-to-3D).
3. In Modly, generate a mesh from the image and export a `.glb`.
4. Drop it in `assets/incoming/` (e.g. `assets/incoming/fox.glb`).
5. Run the ingest:
   ```
   /Applications/Blender.app/Contents/MacOS/Blender --background \
     --python scripts/blender/ingest_modly.py -- assets/incoming/fox.glb fox 6000
   ```
   This writes `src/client/public/assets/creatures/fox.glb` (centered, scaled to
   the creature convention, decimated to ~6000 tris for the iframe, texture kept).

## What the game does (already wired)

- `parts.ts loadCreatureMesh(name)` loads `/assets/creatures/<name>.glb`.
- `buildCreature(..., meshName)` renders that mesh as the whole body when present,
  falling back to the procedural creature if the mesh is missing or still loading.
- To assign a mesh to creatures, pass the mesh name through `setCreature`'s last
  arg. (Next step: map an animal archetype -> its mesh name, so e.g. all "Fox"
  creatures use fox.glb, tinted per genome. One small table when the meshes exist.)

## Tips

- Image-to-3D likes a single clear subject on a plain background, front-facing.
- Keep target tris modest (4000-8000); the mate market shows several at once.
- The ingest keeps whatever color/texture the AI mesh baked in. If you want the
  genome to recolor it, we add a tint pass (currently AI meshes render as-is).
- One mesh per archetype is enough; the genome still drives scale, attributes,
  and (later) tint, so creatures stay varied without a mesh per genome.
