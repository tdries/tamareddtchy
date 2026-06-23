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
import { resolveAttributes, buildEye, buildEars, buildHorns, buildHair, buildMouth, buildNose } from "./attributes.js";
import { type PartName, partsReady, getPart, getCreatureMesh } from "./parts.js";

// A plain, no-frills silhouette used when no animal form is supplied (tests, and
// any caller that does not resolve a form). Roughly a generic round critter.
const NEUTRAL_FORM: AnimalForm = {
  name: "Neutral", bodyLong: 1.1, bodyTall: 1.0, neck: 0.2, headLong: 0.3,
  earSize: 0.5, earTall: 0.5, legLen: 1.0, legThick: 1.0, tail: 0.4, hump: 0.1, snoutWide: 0.4,
};

// Twelve MAXIMALLY DISTINCT hard colors, one per gene: hues spread evenly around
// the wheel so every gene reads as its own clear block, no two genes look alike.
export const GENE_COLOR: Record<Gene, number> = {
  knowledge: 0x2563eb, // hue 220 blue
  tech: 0x7c3aed, // hue 265 violet
  fiction: 0xc026d3, // hue 295 magenta
  heart: 0xec4899, // hue 330 pink
  mayhem: 0xef4444, // hue 0 red
  pulse: 0xf97316, // hue 25 orange
  lore: 0xb45309, // hue 30/dark amber-brown (distinct from pulse by value)
  social: 0xfde047, // hue 52 bright yellow
  craft: 0x84cc16, // hue 85 lime
  vitality: 0x22c55e, // hue 142 green
  earth: 0x14b8a6, // hue 172 teal-green
  inner: 0x06b6d4, // hue 190 cyan
};

const STAGE_SCALE: Record<Stage, number> = {
  egg: 0.55,
  blob: 0.78,
  child: 0.92,
  adult: 1.1,
};

export interface CreatureColors {
  body: number; // dominant gene: the main coat
  belly: number; // 2nd gene: a symmetric chest/belly panel
  markings: number; // 3rd gene: paired cheek patches + a back stripe
  limbs: number; // 4th gene: hands/feet/lower legs
  accent: number; // 5th gene: ear/horn/hair tips
}

// Genes become AESTHETIC, SYMMETRIC color zones, not scattered spots. The
// dominant gene owns the body; the next strongest genes each own a specific,
// mirror-symmetric region (belly panel, cheek patches + back stripe, limb tips,
// accent tips). A blue-dominant creature with red second reads as blue with a
// red belly: clean, designed, readable. Because the zones map to the ordered
// dominant genes, breeding (which blends genomes) cleanly crosses the colors:
// the child's body/belly/markings are the blended-genome's ordered genes.
export function creatureColors(genome: Genome): CreatureColors {
  const dom = dominantGenes(genome);
  const at = (i: number) => GENE_COLOR[dom[Math.min(i, dom.length - 1)]];
  return { body: at(0), belly: at(1), markings: at(2), limbs: at(3), accent: at(4) };
}

// Pull a sculpted GLB part's geometry (Blender-made), scaled into the same
// radius convention the procedural icosphere uses, or null if the library is not
// loaded / the part is missing. Merged into a single BufferGeometry so it drops
// straight into a Mesh and every downstream .scale/.add/.geometry keeps working.
function sculptGeo(part: PartName | undefined, radius: number): THREE.BufferGeometry | null {
  if (!part || !partsReady()) return null;
  const obj = getPart(part);
  if (!obj) return null;
  obj.updateMatrixWorld(true);
  let found: THREE.BufferGeometry | null = null;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !found) {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld); // bake the normalize transform in
      found = g;
    }
  });
  if (!found) return null;
  // normalize() made the part unit-sized (max dim 1); scale to ~2*radius so it
  // matches an icosphere of `radius`.
  (found as THREE.BufferGeometry).scale(radius * 2, radius * 2, radius * 2);
  (found as THREE.BufferGeometry).computeVertexNormals();
  return found;
}

// A soft, organic body part. Uses the SCULPTED Blender geometry when the part
// library is loaded (rich, organic surface); otherwise falls back to a smooth
// icosphere dented with low-frequency noise so the game always renders even if
// assets are slow or missing. Returns a Mesh either way, so all positioning,
// scaling, child-attachment, and animation code is unchanged.
function blob(radius: number, detail: number, color: number, wobble = 0, part?: PartName): THREE.Mesh {
  const sculpted = sculptGeo(part, radius);
  if (sculpted) return new THREE.Mesh(sculpted, skinMaterial(color));

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

// Clean, smooth skin. No fur. The environment map gives the sheen; a faint
// emissive keeps shadowed sides from going pure black.
function skinMaterial(color: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.0,
    emissive: c.clone().multiplyScalar(0.04),
    emissiveIntensity: 0.4,
    envMapIntensity: 0.6,
  });
}

// A symmetric belly/chest panel in the 2nd gene's color, faired onto the front
// of a body blob. Mirror-symmetric and designed, not scattered.
function addBelly(body: THREE.Mesh, color: number): void {
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 24, 24),
    skinMaterial(color),
  );
  belly.scale.set(0.7, 0.9, 0.55);
  belly.position.set(0, -0.12, 0.5);
  body.add(belly);
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
    eyes: THREE.Object3D[];
    mouth: THREE.Object3D;
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
  id = "anon",
  meshName?: string,
): BuildResult {
  const colors = creatureColors(genome);
  const attrs = resolveAttributes(genome, form, id);
  const group = new THREE.Group();
  const s = STAGE_SCALE[stage(xp)];
  // Generation mutation: stronger now so a Gen-10 is visibly wilder than a Gen-1.
  const mutate = Math.min(2.4, (generation - 1) * 0.27);

  // If this creature has an image-to-3D mesh (Modly/Hunyuan3D output, cleaned via
  // ingest_modly.py), render THAT as the whole body, with only the expressive
  // face overlaid, and skip the procedural assembly. Falls through to procedural
  // when the mesh is absent or not yet loaded.
  if (meshName) {
    const aiMesh = getCreatureMesh(meshName);
    if (aiMesh) {
      aiMesh.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      aiMesh.scale.setScalar(2.2); // normalized unit mesh -> creature size
      aiMesh.position.y = -0.2;
      group.add(aiMesh);
      const headGroupAI = new THREE.Group();
      group.add(headGroupAI);
      group.scale.setScalar(s);
      return {
        group,
        parts: { body: aiMesh as unknown as THREE.Mesh, head: headGroupAI, eyes: [], mouth: headGroupAI, arms: new THREE.Group(), legs: new THREE.Group(), tail: new THREE.Group() },
        colors,
      };
    }
  }

  // --- Torso (pair: craft / mayhem, shaped by the animal form). ---
  const torsoLean = lean(genome, "craft", "mayhem"); // + = order, - = chaos
  const chaos = (0.5 - torsoLean / 2) * 0.7 + mutate * 0.5;
  const bodyPart: PartName = form.bodyLong > 1.4 ? "body-long" : form.bodyTall > 1.2 ? "body-tall" : "body-round";
  const body = blob(1, 5, colors.body, chaos, bodyPart);
  body.scale.set(1, (1.05 - torsoLean * 0.12) * form.bodyTall, form.bodyLong);
  addBelly(body, colors.belly); // symmetric belly panel in the 2nd gene's color
  if (form.hump > 0.2) {
    const hump = blob(0.55 * form.hump + 0.3, 4, colors.body, 0.2);
    hump.position.set(0, 0.45, -0.2 * form.bodyLong);
    hump.scale.set(1.1, 0.8, 1);
    group.add(hump);
  }
  // A symmetric back stripe in the 3rd gene's color (marking).
  const stripe = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.1, 1.1 * form.bodyLong, 6, 10),
    skinMaterial(colors.markings),
  );
  stripe.rotation.x = Math.PI / 2;
  stripe.position.set(0, 0.5, -0.05);
  body.add(stripe);
  group.add(body);

  // --- Neck (giraffe/horse/deer): lifts and forwards the head. ---
  const neckLen = form.neck * 1.1;
  if (neckLen > 0.05) {
    const neck = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, neckLen, 6, 12),
      skinMaterial(colors.body),
    );
    neck.position.set(0, 0.9 + neckLen * 0.4, 0.15);
    neck.rotation.x = -0.25;
    group.add(neck);
  }

  // --- Head (pair: knowledge / vitality), lengthened into a snout by the form. ---
  const headGroup = new THREE.Group();
  const headLean = lean(genome, "knowledge", "vitality");
  const headSize = 0.5 + magnitude(genome, "knowledge", "vitality") * 0.22 + (headLean > 0 ? 0.1 : 0);
  const headPart: PartName = form.headLong > 0.6 ? "head-long" : headLean > 0 ? "head-dome" : "head-round";
  const head = blob(headSize, 4, colors.body, 0.12 + mutate * 0.3, headPart);
  head.scale.y = headLean > 0 ? 1.12 : 0.92; // domed vs sleek
  head.scale.z = 1 + form.headLong * 0.9; // snout/muzzle length
  headGroup.add(head);

  // Snout cap for long-muzzle animals (croc, horse, elephant), tinted darker.
  if (form.headLong > 0.5) {
    const snout = new THREE.Mesh(
      new THREE.CapsuleGeometry(headSize * (0.34 + form.snoutWide * 0.22), headSize * form.headLong, 6, 12),
      skinMaterial(shade(colors.body, 0.92)),
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.08, headSize * (0.7 + form.headLong * 0.5));
    headGroup.add(snout);
  }

  // Symmetric cheek patches in the 3rd gene's color (markings).
  for (const dx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.3, 14, 14), skinMaterial(colors.markings));
    cheek.scale.set(0.9, 0.7, 0.4);
    cheek.position.set(dx * headSize * 0.6, -headSize * 0.1, headSize * 0.55);
    headGroup.add(cheek);
  }

  // Ears, horns, hair: from the attribute library, accent-colored tips.
  headGroup.add(buildEars(attrs.ear, headSize, colors.body));
  headGroup.add(buildHorns(attrs.horn, headSize, colors.accent));
  headGroup.add(buildHair(attrs.hair, headSize, colors.accent));

  // Sit the head on the neck (or directly on the torso), slightly forward.
  headGroup.position.set(0, 1.05 + neckLen * 0.85, 0.12 + neckLen * 0.25);

  // --- Face: eyes (from the library), nose, mouth. ---
  const eyeLean = lean(genome, "tech", "heart"); // + tech, - heart
  const warm = (1 - eyeLean) / 2; // 0 = full tech, 1 = full heart
  const eyeR = 0.17 + warm * 0.08;
  const headDepth = headSize * head.scale.z;
  const snoutTipZ = headDepth + headSize * form.headLong * 0.5;
  const eyeZ = headDepth * 0.78;
  const eyeY = (0.18 + form.headLong * 0.12) * headSize * 2;
  const eyes: THREE.Object3D[] = [];
  for (const dx of [-0.3, 0.3]) {
    const eye = buildEye(attrs.eye, eyeR);
    eye.position.set(dx * headSize * 1.5, eyeY, eyeZ);
    headGroup.add(eye);
    eyes.push(eye);
  }

  // Nose: from the library (button / snout / beak / trunk / flat), at the tip.
  const noseR = (0.1 + warm * 0.05) * 1.1;
  const noseY = (-0.06 - form.headLong * 0.08) * headSize * 2;
  const nose = buildNose(attrs.nose, noseR, shade(colors.markings, 0.85));
  nose.position.set(0, noseY, snoutTipZ);
  headGroup.add(nose);

  // Mouth: from the library (smile / grin / frown / open / fang / beak).
  const mouth = buildMouth(attrs.mouth, 0.12 + warm * 0.1);
  mouth.position.set(0, noseY - 0.13 - warm * 0.03, snoutTipZ - 0.02);
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
      skinMaterial(colors.body),
    );
    shoulder.add(socket);
    const upper = limbSegment(armReach * 0.55, armThick, colors.limbs);
    const elbow = new THREE.Group();
    elbow.position.y = -armReach * 0.5;
    const fore = limbSegment(armReach * 0.5, armThick * 0.85, colors.limbs);
    fore.position.y = -armReach * 0.25;
    const hand = paw(armThick * 1.5, 3, shade(colors.limbs, 0.9));
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
      skinMaterial(colors.body),
    );
    hip.add(socket);
    const thigh = limbSegment(legLen * 0.55, legThick, colors.limbs);
    const knee = new THREE.Group();
    knee.position.y = -legLen * 0.5;
    const shin = limbSegment(legLen * 0.5, legThick * 0.85, colors.limbs);
    shin.position.y = -legLen * 0.25;
    const foot = paw(legThick * 1.5, 3, shade(colors.limbs, 0.82), footType(form));
    foot.position.set(0, -legLen * 0.5, legThick * 0.5);
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
        skinMaterial(colors.limbs),
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

type FootType = "paw" | "hoof" | "claw";

// Decide a foot style from the animal form: heavy hoofed grazers, clawed
// predators/birds, soft paws for the rest.
function footType(form: AnimalForm): FootType {
  if (form.bodyLong > 1.45 && form.legLen > 1.3) return "hoof"; // horse/zebra/giraffe
  if (form.earTall > 0.7 && form.legThick < 1.0) return "claw"; // foxy/cat predators
  return "paw";
}

// A foot/hand in one of three styles, so limbs end in something characterful.
function paw(r: number, toes: number, color: number, type: FootType = "paw"): THREE.Group {
  const g = new THREE.Group();
  if (type === "hoof") {
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.1, r * 1.0, 10), skinMaterial(shade(color, 0.7)));
    g.add(hoof);
    return g;
  }
  const pad = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), skinMaterial(color));
  pad.scale.set(1.1, 0.7, 1.2);
  g.add(pad);
  const n = type === "claw" ? 3 : toes;
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) / Math.max(1, n);
    if (type === "claw") {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.7, 6), skinMaterial(shade(color, 0.6)));
      claw.position.set(t * r * 1.3, -r * 0.1, r * 1.1); claw.rotation.x = Math.PI / 2.2;
      g.add(claw);
    } else {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 10, 10), skinMaterial(shade(color, 0.9)));
      toe.position.set(t * r * 1.4, -r * 0.1, r * 0.9);
      g.add(toe);
    }
  }
  return g;
}
