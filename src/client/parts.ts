// Sculpted-part cache. Loads the Blender GLB part library ONCE at startup, then
// hands out synchronous clones so buildCreature can stay synchronous (the whole
// animation loop depends on that). If a part is missing or the library has not
// loaded yet, getPart returns null and the renderer falls back to a primitive,
// so the game never breaks on a slow/failed asset load.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Every part GLB shipped in /assets/parts. Uncompressed (no Draco) so loading is
// just a fetch + parse, no worker/decoder needed in the iframe.
export const PART_FILES = [
  "body-round", "body-long", "body-tall",
  "head-round", "head-long", "head-dome",
  "ear-round", "ear-tall", "ear-floppy",
  "horn-straight", "horn-curved", "horn-antler",
  "limb-default",
] as const;
export type PartName = (typeof PART_FILES)[number];

// Each loaded part is normalized to a unit reference (max dimension = 1, centered
// at origin) so the renderer can scale/position it predictably regardless of the
// raw Blender export size.
const sources = new Map<string, THREE.Object3D>();
let loaded = false;

export function partsReady(): boolean {
  return loaded;
}

// Kick off loading all parts. Resolves when every part is in the cache.
export function preloadParts(base = "/assets/parts"): Promise<void> {
  const loader = new GLTFLoader();
  return Promise.all(
    PART_FILES.map(
      (name) =>
        new Promise<void>((resolve) => {
          loader.load(
            `${base}/${name}.glb`,
            (g) => {
              sources.set(name, normalize(g.scene));
              resolve();
            },
            undefined,
            () => resolve(), // tolerate a missing part; renderer falls back
          );
        }),
    ),
  ).then(() => {
    loaded = true;
  });
}

// Normalize a loaded part to a unit reference: recenter at origin, scale so the
// largest dimension is 1. Returns a group the renderer can clone, position, and
// scale predictably regardless of the raw Blender export size.
function normalize(root: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const max = Math.max(size.x, size.y, size.z) || 1;
  root.position.sub(center);
  const wrap = new THREE.Group();
  wrap.add(root);
  wrap.scale.setScalar(1 / max);
  return wrap;
}

// Synchronous clone of a cached part as a fresh mesh-bearing group, or null if
// the part is not loaded. The renderer owns positioning, scaling, and material.
export function getPart(name: PartName): THREE.Object3D | null {
  const src = sources.get(name);
  if (!src) return null;
  return src.clone(true);
}

// ----------------------------- creature meshes -----------------------------
// Full-creature GLBs produced by the image-to-3D pipeline (Modly etc.) and
// cleaned via scripts/blender/ingest_modly.py into /assets/creatures. These are
// whole sculpted bodies, used in place of the procedural assembly when present.
// Loaded on demand by name (data-driven: any creature can have one or not).

const creatureSources = new Map<string, THREE.Object3D | null>();

// Begin loading a creature mesh by name. Resolves whether it loaded or not.
export function loadCreatureMesh(name: string, base = "/assets/creatures"): Promise<void> {
  if (creatureSources.has(name)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    new GLTFLoader().load(
      `${base}/${name}.glb`,
      (g) => { creatureSources.set(name, normalize(g.scene)); resolve(); },
      undefined,
      () => { creatureSources.set(name, null); resolve(); }, // mark "tried, absent"
    );
  });
}

// Synchronous clone of a loaded creature mesh, or null if not present/loaded.
export function getCreatureMesh(name: string): THREE.Object3D | null {
  const src = creatureSources.get(name);
  return src ? src.clone(true) : null;
}
