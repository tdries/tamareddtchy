# Image-to-3D creature pipeline: design + feasibility

Date: 2026-06-23

## The goal

Creatures should look like the Pixar-quality reference (groomed fur, soft
lighting, characterful), while STILL being real-time 3D that lives in the world,
animates, and breeds. The chosen approach: generate a high-quality IMAGE per
creature archetype, convert that image into a real 3D mesh (image-to-3D), and use
those meshes in the live game.

## Why our hand-built real-time creatures fall short of the reference

The reference is a pre-rendered / AI image: per-strand fur, ray-traced
subsurface skin, offline lighting, minutes per frame. Our live renderer is a few
thousand polygons rasterized in a mobile iframe at 60fps. No texture trick on
low-poly blobs reaches that image. The fix is to bring AI-sculpted geometry +
baked high-quality textures INTO the real-time engine, not to keep hand-modeling.

## The pipeline (offline bake -> live assembly)

1. ART (offline, per archetype, NOT per genome):
   a. Generate a hero image of each creature archetype with an image model
      (the reference style). ~20 animal base looks, plus part close-ups.
   b. Image-to-3D: convert each image to a GLB mesh with TripoSR / InstantMesh /
      DreamGaussian. Output: a textured GLB (albedo + normal baked in).
   c. Clean + decimate + UV in Blender (headless, already proven here), export a
      lightweight GLB to the part/creature library.
2. RUNTIME (live, in the game, unchanged mechanic):
   The genome picks the archetype + assembles/tints/scales the baked GLB parts,
   blends on breeding, animates, and drops them in the 3D world. Same system we
   already ship; only the source geometry/textures get the AI-quality upgrade.

This keeps determinism and breeding (the genome still drives everything) while
the EXPENSIVE art is baked once, offline.

## Feasibility on this machine (the real constraint)

- Hardware: Apple M4 Pro, 48GB, NO CUDA. TripoSR / InstantMesh / DreamGaussian
  are CUDA-first; they do not run cleanly on Apple Silicon. Options:
  - Run the image-to-3D step on a cloud GPU (one-off batch, ~cents-to-dollars
    for ~20 archetypes), download the GLBs, finish in local Blender. RECOMMENDED.
  - Or use a hosted image-to-3D API (Tripo/Meshy/Replicate) for the batch.
  - Image generation itself: diffusers is installed but torch is not wired; SDXL
    on MPS is possible but slow. A hosted image model is simpler for the hero art.
- Either way, the heavy generation is OFFLINE and ONE-TIME (per archetype), then
  the assets are committed and the game loads them. No per-user GPU, no live cost.

## What stays free / local

- Blender cleanup, decimate, UV, GLB export: free, local, already working.
- The entire runtime (assembly, tint, breeding, world, animation): free, local.
- Only the image-gen + image-to-3D BATCH needs a GPU or a hosted run, and only
  once per archetype.

## Honest expectation setting

- The final IN-GAME creature will look like a polished mobile game (Animal
  Crossing / Fall Guys tier), markedly better than today, because the geometry +
  textures are AI-quality. It will NOT be the exact reference frame, that frame
  is an offline hero render; real-time always trades some of that away. But the
  gap closes dramatically.

## Decision needed from Tim

- Where the offline batch runs: cloud GPU (I script it, you run/approve) vs a
  hosted API (needs your key) vs you run a local CUDA box.
- Until then: I show the best ACHIEVABLE real-time look now (shell-groom fur +
  soft/toon lighting on the current creatures) as the concrete near-term target.
