// Procedural creature geometry. The body is GROWN from the genome: there are no
// model files. Every body slot maps to exactly one gene-pair (see the spec), its
// variant chosen by which side of the pair dominates and its size by the pair's
// magnitude. Generation pushes the whole rig further from the baseline blob so
// lineage depth is visible at a glance.
//
// buildCreature is pure (THREE.Group in, no DOM, no WebGL) so it is unit-testable
// in Node. The scene/animation lives in scene.ts.

import * as THREE from "three";
import { type Gene, type Genome, dominantGenes } from "../shared/genome.js";
import { type Stage, stage } from "../shared/creature.js";
import { type AnimalForm } from "./animals.js";

// A plain, no-frills silhouette used when no animal form is supplied (tests, and
// any caller that does not resolve a form). Roughly a generic round critter.
const NEUTRAL_FORM: AnimalForm = {
  name: "Neutral", bodyLong: 1.1, bodyTall: 1.0, neck: 0.2, headLong: 0.3,
  earSize: 0.5, earTall: 0.5, legLen: 1.0, legThick: 1.0, tail: 0.4, hump: 0.1, snoutWide: 0.4,
};

// Candy palette, one hue per gene. Top-two genes set the creature's colors.
const GENE_COLOR: Record<Gene, number> = {
  knowledge: 0x5b8cff, // cool blue
  vitality: 0x2fd07a, // green
  tech: 0x8a5bff, // violet
  heart: 0xff6f9c, // pink
  craft: 0xffaf45, // amber
  mayhem: 0xff4d4d, // red
  pulse: 0xff7a3c, // orange
  lore: 0xc9a24b, // gold
  inner: 0x57c7d4, // teal
  social: 0xffd23f, // yellow
  earth: 0x6fae5f, // leaf
  fiction: 0xb05bff, // purple
};

const STAGE_SCALE: Record<Stage, number> = {
  egg: 0.55,
  blob: 0.78,
  child: 0.92,
  adult: 1.1,
};

export interface CreatureColors {
  primary: number;
  secondary: number;
}

export function creatureColors(genome: Genome): CreatureColors {
  const [a, b] = dominantGenes(genome);
  return { primary: GENE_COLOR[a], secondary: GENE_COLOR[b ?? a] };
}

// A soft, organic blob: a smooth icosphere we dent with low-frequency, spatially
// coherent noise so it reads as gooey lumps, not spikes. Reused for every body
// part so the whole creature looks like one squishy material.
function blob(radius: number, detail: number, color: number, wobble = 0): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  if (wobble > 0) {
    const pos = geo.attributes.position;
    const amp = Math.min(0.22, wobble * 0.16); // damped: lumps, never thorns
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Sum of a few low-frequency sine bands keyed on POSITION (not index), so
      // neighbouring vertices move together into smooth bulges.
      const d =
        Math.sin(x * 1.7 + 0.5) * Math.cos(y * 1.9) +
        Math.sin(y * 2.3 + 1.3) * Math.cos(z * 1.5) +
        Math.sin(z * 1.6 + 2.1) * Math.cos(x * 2.0);
      const n = 1 + (d / 3) * amp;
      pos.setXYZ(i, x * n, y * n, z * n);
    }
    pos.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, skinMaterial(color));
}

// Darken or lighten a hex color by a factor (1 = same, <1 darker, >1 lighter).
function shade(color: number, factor: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(factor);
  return c.getHex();
}

// Blend two hex colors, t = 0 keeps a, t = 1 gives b.
function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

// A small tiling noise texture used as a roughness map, so the skin has a fine
// fuzzy/velvety micro-surface (fake fur) instead of a uniform plastic sheen.
// Generated once on a canvas; no asset file, works offline. Falls back to null
// in non-DOM contexts (tests), where materials just render smooth.
let FUZZ_TEX: THREE.Texture | null | undefined;
function fuzzTexture(): THREE.Texture | null {
  if (FUZZ_TEX !== undefined) return FUZZ_TEX;
  if (typeof document === "undefined") { FUZZ_TEX = null; return null; }
  const n = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    // Fine speckle: each texel a slightly different roughness, biased high.
    const v = 150 + Math.floor((Math.sin(i * 12.9898) * 43758.5453 % 1) * 105);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  FUZZ_TEX = tex;
  return tex;
}

// Fur alpha texture: sparse soft dots that act as strand tips. Each fur shell
// samples this with rising alpha cutoff so only the densest "strands" survive in
// the outer shells, giving a tapered, fuzzy coat. Generated once on a canvas.
let FUR_TEX: THREE.Texture | null | undefined;
function furTexture(): THREE.Texture | null {
  if (FUR_TEX !== undefined) return FUR_TEX;
  if (typeof document === "undefined") { FUR_TEX = null; return null; }
  const n = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, n, n);
  // Scatter many tiny soft dots (strand cross-sections). Deterministic positions.
  for (let i = 0; i < 2600; i++) {
    const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * n;
    const y = (Math.sin(i * 47.3 + 2.1) * 0.5 + 0.5) * n;
    const r = 0.7 + (Math.sin(i * 12.9) * 0.5 + 0.5) * 1.1;
    const a = 0.5 + (Math.sin(i * 5.5) * 0.5 + 0.5) * 0.5;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  FUR_TEX = tex;
  return tex;
}

// Wrap a body mesh in concentric fur shells: copies of its geometry pushed out
// along the normals, each sampling the fur alpha with a rising cutoff so strands
// taper to points. This is real shell-based fur, the soft fuzzy coat reads as
// actual strands rather than a texture. Kept to a modest shell count so it stays
// performant in the Devvit web view.
const FUR_SHELLS = 10;
function addFur(mesh: THREE.Mesh, color: number, length = 0.12): void {
  const tex = furTexture();
  if (!tex) return; // no DOM (tests): skip fur
  const base = new THREE.Color(color);
  for (let s = 1; s <= FUR_SHELLS; s++) {
    const f = s / FUR_SHELLS; // 0..1 outward
    const shell = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.7 + f * 0.3),
        roughness: 0.95,
        metalness: 0,
        alphaMap: tex,
        transparent: true,
        alphaTest: 0.02 + f * 0.5, // outer shells keep only the densest strands
        depthWrite: false,
      }),
    );
    // Shell is a child of the mesh, so it already inherits the mesh's scale;
    // inflate it slightly (uniformly in local space) to push strands outward.
    shell.scale.setScalar(1 + f * length);
    shell.castShadow = false;
    mesh.add(shell);
  }
}

// Soft, velvety "furry pet" skin. The fuzz roughness map breaks up the sheen so
// it reads as soft fur, not plastic. We rely on the environment map + lights for
// brightness rather than emissive, so the creature does not glow from within and
// wash out (a faint emissive only keeps shadowed sides from going pure black).
function skinMaterial(color: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const emissive = c.clone().multiplyScalar(0.04);
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82, // soft, fur-like
    metalness: 0.0,
    roughnessMap: fuzzTexture() ?? undefined,
    emissive,
    emissiveIntensity: 0.4,
    flatShading: false,
    envMapIntensity: 0.55,
  });
}

// Within-pair lean in [-1, 1]; positive favors the A (first) gene of the pair.
function lean(genome: Genome, a: Gene, b: Gene): number {
  const sum = genome[a] + genome[b];
  if (sum === 0) return 0;
  return (genome[a] - genome[b]) / sum;
}

// Pair magnitude, normalized to roughly 0..1, drives how prominent a slot is.
function magnitude(genome: Genome, a: Gene, b: Gene): number {
  return Math.min(1, (genome[a] + genome[b]) / 240);
}

export interface BuildResult {
  group: THREE.Group;
  // Named handles the animator wants to drive each frame.
  parts: {
    body: THREE.Mesh;
    head: THREE.Group;
    eyes: THREE.Mesh[];
    mouth: THREE.Mesh;
    arms: THREE.Group; // children are shoulder pivots (userData.side, .elbow)
    legs: THREE.Group; // children are hip pivots (userData.knee, .i)
    tail: THREE.Group;
  };
  colors: CreatureColors;
}

// Build the whole creature. The animal `form` gives the silhouette (ears, snout,
// proportions, tail, limb style); the genome tints and details it; generation
// mutates it further from baseline.
export function buildCreature(
  genome: Genome,
  generation: number,
  xp: number,
  form: AnimalForm = NEUTRAL_FORM,
): BuildResult {
  const colors = creatureColors(genome);
  const group = new THREE.Group();
  const s = STAGE_SCALE[stage(xp)];
  // Generation mutation: stronger now so a Gen-10 is visibly wilder than a Gen-1.
  const mutate = Math.min(2.4, (generation - 1) * 0.27);

  // The earth/fiction "attribute" color used to fly around the head as motes.
  // Now we fold it into the limbs/details instead (see accent below), so the
  // gene still shows up, just on the body where it reads cleanly.
  const accLean = lean(genome, "earth", "fiction");
  const accentColor = accLean >= 0 ? GENE_COLOR.earth : GENE_COLOR.fiction;
  const limbColor = mix(colors.secondary, accentColor, 0.35);

  // --- Torso (pair: craft / mayhem, shaped by the animal form). ---
  const torsoLean = lean(genome, "craft", "mayhem"); // + = order, - = chaos
  const chaos = (0.5 - torsoLean / 2) * 0.7 + mutate * 0.5;
  const body = blob(1, 5, colors.primary, chaos);
  // Animal proportions: elongate (horse/croc), heighten, and hump the back.
  body.scale.set(1, (1.05 - torsoLean * 0.12) * form.bodyTall, form.bodyLong);
  addFur(body, colors.primary, 0.14);
  if (form.hump > 0.2) {
    const hump = blob(0.55 * form.hump + 0.3, 4, colors.primary, 0.2);
    hump.position.set(0, 0.45, -0.2 * form.bodyLong);
    hump.scale.set(1.1, 0.8, 1);
    group.add(hump);
  }
  group.add(body);

  // --- Neck (giraffe/horse/deer): lifts and forwards the head. ---
  const neckLen = form.neck * 1.1;
  if (neckLen > 0.05) {
    const neck = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, neckLen, 6, 12),
      skinMaterial(colors.primary),
    );
    neck.position.set(0, 0.9 + neckLen * 0.4, 0.15);
    neck.rotation.x = -0.25;
    group.add(neck);
  }

  // --- Head (pair: knowledge / vitality), lengthened into a snout by the form. ---
  const headGroup = new THREE.Group();
  const headLean = lean(genome, "knowledge", "vitality");
  const headSize = 0.5 + magnitude(genome, "knowledge", "vitality") * 0.22 + (headLean > 0 ? 0.1 : 0);
  const head = blob(headSize, 4, colors.primary, 0.12 + mutate * 0.3);
  head.scale.y = headLean > 0 ? 1.12 : 0.92; // domed vs sleek
  head.scale.z = 1 + form.headLong * 0.9; // snout/muzzle length
  addFur(head, colors.primary, 0.1);
  headGroup.add(head);

  // Snout cap for long-muzzle animals (croc, horse, elephant), tinted darker.
  if (form.headLong > 0.5) {
    const snout = new THREE.Mesh(
      new THREE.CapsuleGeometry(headSize * (0.34 + form.snoutWide * 0.22), headSize * form.headLong, 6, 12),
      skinMaterial(shade(colors.primary, 0.92)),
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.08, headSize * (0.7 + form.headLong * 0.5));
    headGroup.add(snout);
  }

  // Ears: two of them, size and pointiness from the form.
  if (form.earSize > 0.15) {
    for (const dx of [-1, 1]) {
      const earH = 0.2 + form.earSize * 0.45;
      const ear = new THREE.Mesh(
        form.earTall > 0.5
          ? new THREE.ConeGeometry(0.13 * form.earSize + 0.05, earH, 10)
          : new THREE.SphereGeometry(0.12 + form.earSize * 0.14, 12, 12),
        skinMaterial(shade(colors.primary, 0.95)),
      );
      ear.position.set(dx * (0.28 + form.earSize * 0.1), headSize * (0.7 + form.earTall * 0.2), -0.05);
      ear.rotation.z = dx * (0.2 - form.earTall * 0.15);
      if (form.earTall <= 0.5) ear.scale.set(1, 0.7, 0.6); // floppy/round
      headGroup.add(ear);
    }
  }

  // Sit the head on the neck (or directly on the torso), slightly forward.
  headGroup.position.set(0, 1.05 + neckLen * 0.85, 0.12 + neckLen * 0.25);

  // --- Face: eyes, nose, mouth (all the pair: tech / heart). ---
  // Critical: the head is stretched in z by the snout (head.scale.z), so the
  // face must be placed against the ACTUAL front surface, not the unstretched
  // radius, or it sinks inside the head. Eyes sit on the upper-front of the round
  // part of the head; the nose and mouth sit out at the snout tip.
  const eyeLean = lean(genome, "tech", "heart"); // + tech, - heart
  const warm = (1 - eyeLean) / 2; // 0 = full tech, 1 = full heart
  const eyeR = 0.13 + warm * 0.11; // heart = big doe eyes
  const headDepth = headSize * head.scale.z; // true half-depth of the head in z
  const snoutTipZ = headDepth + headSize * form.headLong * 0.5;
  // Eyes sit proud on the upper-front of the head dome. Use the stretched depth
  // so they land on the visible surface, not buried inside an elongated head.
  const eyeZ = headDepth * 0.72;
  const eyeY = 0.16 + form.headLong * 0.12; // higher on long-muzzle faces
  const eyes: THREE.Mesh[] = [];
  for (const dx of [-0.26, 0.26]) {
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0 }),
    );
    white.position.set(dx, eyeY, eyeZ);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR * 0.55, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.2 }),
    );
    pupil.position.set(dx, eyeY, eyeZ + eyeR * 0.62);
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR * 0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888 }),
    );
    glint.position.set(dx + eyeR * 0.2, eyeY + eyeR * 0.25, eyeZ + eyeR * 0.7);
    headGroup.add(white, pupil, glint);
    eyes.push(white);
  }

  // Nose: ALWAYS a visible button, out at the snout tip (or face front for round
  // heads). Warm (heart) makes it bigger and rounder.
  const noseR = 0.08 + warm * 0.05;
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(noseR, 14, 14),
    skinMaterial(shade(colors.secondary, 0.8)),
  );
  const noseY = -0.05 - form.headLong * 0.08;
  nose.position.set(0, noseY, snoutTipZ);
  nose.scale.z = 1.2;
  headGroup.add(nose);

  // Mouth: ALWAYS visible. A thick rounded smile arc built from a partial torus.
  // A full torus' arc starts at angle 0 going counter-clockwise, so to get a
  // symmetric upturned smile we rotate so the arc's midpoint faces straight down.
  const mouthWide = 0.11 + warm * 0.12;
  const arc = Math.PI * (0.45 + warm * 0.7); // gentle curve to a wide grin
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(mouthWide, 0.028, 12, 28, arc),
    new THREE.MeshStandardMaterial({ color: 0x3a1820, roughness: 0.45 }),
  );
  // Just under the nose at the snout tip, sitting proud of the surface.
  mouth.position.set(0, noseY - 0.12 - warm * 0.03, snoutTipZ - 0.02);
  // Rotate the open side up: center the arc at the bottom (-Y) of the torus.
  mouth.rotation.z = -Math.PI / 2 - arc / 2;
  headGroup.add(mouth);

  group.add(headGroup);

  // --- Arms: two big, two-segment limbs the animator can flex at the shoulder
  // and elbow. Length/thickness scale with the pulse/lore pair AND the animal
  // form, so every creature has substantial, articulated arms. Each arm is a
  // group (shoulder pivot) holding an upper arm group (elbow pivot) holding a
  // forearm, so scene.ts can swing them naturally. ---
  const armGroup = new THREE.Group();
  const armReach = (0.62 + magnitude(genome, "pulse", "lore") * 0.5) * (0.9 + form.legLen * 0.25);
  const armThick = 0.13 * (0.85 + form.legThick * 0.4);
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group();
    // Sit the shoulder ON the body surface (just inside radius 1), so the arm
    // grows out of the body rather than floating beside it.
    shoulder.position.set(side * 0.78, 0.34, 0.12);
    // Socket: a body-colored blob that fairs the limb smoothly into the torso.
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(armThick * 2.1, 14, 14),
      skinMaterial(colors.primary),
    );
    shoulder.add(socket);
    const upper = limbSegment(armReach * 0.55, armThick, limbColor);
    const elbow = new THREE.Group();
    elbow.position.y = -armReach * 0.5;
    const fore = limbSegment(armReach * 0.5, armThick * 0.85, limbColor);
    fore.position.y = -armReach * 0.25;
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(armThick * 1.5, 12, 12),
      skinMaterial(limbColor),
    );
    hand.position.y = -armReach * 0.5;
    elbow.add(fore, hand);
    upper.add(elbow);
    shoulder.add(upper);
    shoulder.rotation.z = side * (0.42 + mutate * 0.12);
    shoulder.userData = { side, elbow };
    armGroup.add(shoulder);
  }
  group.add(armGroup);

  // --- Legs: two (or four, for clearly quadruped animals) big two-segment legs,
  // also articulated (hip + knee) and sized by inner/social and the form. ---
  const legGroup = new THREE.Group();
  const quad = form.bodyLong > 1.35 && form.neck < 0.8; // horse/cow/croc stance
  const legLen = (0.7 + magnitude(genome, "inner", "social") * 0.4) * form.legLen;
  const legThick = 0.16 * form.legThick;
  const legXs = quad
    ? [-0.5, 0.5, -0.5, 0.5]
    : [-0.42, 0.42];
  const legZs = quad
    ? [0.55 * form.bodyLong, 0.55 * form.bodyLong, -0.55 * form.bodyLong, -0.55 * form.bodyLong]
    : [0.1, 0.1];
  legXs.forEach((lx, i) => {
    const hip = new THREE.Group();
    // Tuck the hip up into the lower body so the leg emerges from it.
    hip.position.set(lx, -0.82, legZs[i]);
    // Hip socket blob, body-colored, to integrate the leg into the torso.
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(legThick * 2.0, 14, 14),
      skinMaterial(colors.primary),
    );
    hip.add(socket);
    const thigh = limbSegment(legLen * 0.55, legThick, limbColor);
    const knee = new THREE.Group();
    knee.position.y = -legLen * 0.5;
    const shin = limbSegment(legLen * 0.5, legThick * 0.85, limbColor);
    shin.position.y = -legLen * 0.25;
    const foot = new THREE.Mesh(
      new THREE.SphereGeometry(legThick * 1.4, 12, 12),
      skinMaterial(shade(limbColor, 0.85)),
    );
    foot.position.set(0, -legLen * 0.5, legThick * 0.6);
    foot.scale.set(1, 0.7, 1.4);
    knee.add(shin, foot);
    thigh.add(knee);
    hip.add(thigh);
    hip.userData = { knee, i };
    legGroup.add(hip);
  });
  group.add(legGroup);

  // --- Tail: a tapering segmented tail for animals that have one. ---
  const tailGroup = new THREE.Group();
  if (form.tail > 0.2) {
    const segs = 3 + Math.round(form.tail * 3);
    let parent: THREE.Object3D = tailGroup;
    for (let i = 0; i < segs; i++) {
      const r = (0.12 - i * 0.012) * (0.8 + form.legThick * 0.3);
      const seg = new THREE.Mesh(
        new THREE.CapsuleGeometry(Math.max(0.03, r), 0.18, 4, 8),
        skinMaterial(limbColor),
      );
      seg.position.y = -0.16;
      seg.userData = { tailSeg: i };
      parent.add(seg);
      parent = seg;
    }
    tailGroup.position.set(0, -0.1, -0.85 * form.bodyLong);
    tailGroup.rotation.x = 0.6;
    group.add(tailGroup);
  }

  group.scale.setScalar(s);
  return {
    group,
    parts: { body, head: headGroup, eyes, mouth, arms: armGroup, legs: legGroup, tail: tailGroup },
    colors,
  };
}

// One tapered limb segment (a capsule), pivoting from its TOP so a parent group
// rotation swings it like a real joint.
function limbSegment(len: number, thick: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(thick, len, 6, 12),
    skinMaterial(color),
  );
  m.position.y = -len / 2; // hang below the pivot
  g.add(m);
  return g;
}
