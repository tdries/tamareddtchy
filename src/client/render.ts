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

// Soft, slightly translucent "squishy pet" skin. A touch of emissive in the
// body color fakes subsurface glow; low roughness gives a wet, alive sheen.
function skinMaterial(color: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const emissive = c.clone().multiplyScalar(0.18);
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.0,
    emissive,
    flatShading: false,
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
    arms: THREE.Group;
    legs: THREE.Group;
    accessory: THREE.Group;
  };
  colors: CreatureColors;
}

// Build the whole creature. Mutation strength grows with generation.
export function buildCreature(
  genome: Genome,
  generation: number,
  xp: number,
): BuildResult {
  const colors = creatureColors(genome);
  const group = new THREE.Group();
  const s = STAGE_SCALE[stage(xp)];
  // Each generation past the first deviates the body further from baseline.
  const mutate = Math.min(1.4, (generation - 1) * 0.22);

  // --- Torso (pair: craft / mayhem). Order = tidy sphere, chaos = lumpy blob. ---
  const torsoLean = lean(genome, "craft", "mayhem"); // + = order, - = chaos
  const chaos = (0.5 - torsoLean / 2) * 0.9 + mutate * 0.5;
  const body = blob(1, 5, colors.primary, chaos); // higher detail = gooier
  body.scale.set(1, 1.05 - torsoLean * 0.15, 1);
  group.add(body);

  // --- Head (pair: knowledge / vitality). Mind = big domed head, body = sleek. ---
  const headGroup = new THREE.Group();
  const headLean = lean(genome, "knowledge", "vitality");
  const headSize = 0.55 + magnitude(genome, "knowledge", "vitality") * 0.25 + (headLean > 0 ? 0.12 : 0);
  const head = blob(headSize, 4, colors.primary, 0.15 + mutate * 0.3);
  head.scale.y = headLean > 0 ? 1.15 : 0.92; // domed vs sleek
  headGroup.add(head);
  // Sit the head above and slightly forward of the torso so the face is never
  // occluded by the body's lumps.
  headGroup.position.set(0, 1.15, 0.12);

  // --- Face: eyes, nose, mouth (all the pair: tech / heart). ---
  // Tech leans toward a small, cool, deadpan visor face; Heart leans toward big
  // warm eyes, a button nose, and a wide smile. Nose and mouth are sub-features
  // of the same pair, so the face reads as one coherent expression.
  const eyeLean = lean(genome, "tech", "heart"); // + tech, - heart
  const warm = (1 - eyeLean) / 2; // 0 = full tech, 1 = full heart
  const eyeR = 0.13 + warm * 0.11; // heart = big doe eyes
  const faceZ = headSize * 0.82;
  const eyes: THREE.Mesh[] = [];
  for (const dx of [-0.22, 0.22]) {
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0 }),
    );
    white.position.set(dx, 0.04, faceZ);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR * 0.55, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.2 }),
    );
    pupil.position.set(dx, 0.04, faceZ + eyeR * 0.62);
    // tiny catchlight for the "alive" look
    const glint = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR * 0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888 }),
    );
    glint.position.set(dx + eyeR * 0.2, 0.04 + eyeR * 0.25, faceZ + eyeR * 0.7);
    headGroup.add(white, pupil, glint);
    eyes.push(white);
  }

  // Nose: a small button (heart) shrinking to almost nothing (tech).
  const noseR = 0.04 + warm * 0.06;
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(noseR, 12, 12),
    skinMaterial(colors.secondary),
  );
  nose.position.set(0, -0.06, faceZ + 0.04);
  headGroup.add(nose);

  // Mouth: a torus arc. Heart = wide upward smile; tech = small flat line.
  const smile = -0.4 + warm * 1.2; // controls how curved/wide
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.08 + warm * 0.1, 0.022, 8, 16, Math.PI * (0.6 + warm * 0.8)),
    new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.5 }),
  );
  mouth.position.set(0, -0.2 - warm * 0.04, faceZ);
  mouth.rotation.z = Math.PI + (smile < 0 ? Math.PI : 0); // flip for frown vs smile
  headGroup.add(mouth);

  group.add(headGroup);

  // --- Arms (pair: pulse / lore). Now = antenna arms, forever = scroll arms. ---
  const armGroup = new THREE.Group();
  const armLean = lean(genome, "pulse", "lore");
  const armCount = armLean > 0.3 ? 2 : armLean < -0.3 ? 2 : 2;
  const armLen = 0.5 + magnitude(genome, "pulse", "lore") * 0.4;
  for (let i = 0; i < armCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, armLen, 4, 8),
      new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.5 }),
    );
    arm.position.set(side * 0.95, 0.1, 0);
    arm.rotation.z = side * (0.6 + mutate * 0.2);
    armGroup.add(arm);
  }
  group.add(armGroup);

  // --- Legs (pair: inner / social). Self = single rooted base, world = many. ---
  const legGroup = new THREE.Group();
  const legLean = lean(genome, "inner", "social"); // + inner, - social
  const legCount = legLean > 0.25 ? 1 : Math.min(6, 2 + Math.round(magnitude(genome, "inner", "social") * 4));
  if (legCount === 1) {
    const base = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.6 }),
    );
    base.position.y = -1.15;
    legGroup.add(base);
  } else {
    for (let i = 0; i < legCount; i++) {
      const ang = (i / legCount) * Math.PI * 2;
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.07, 0.35, 4, 8),
        new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.6 }),
      );
      leg.position.set(Math.cos(ang) * 0.55, -1.1, Math.sin(ang) * 0.4);
      legGroup.add(leg);
    }
  }
  group.add(legGroup);

  // --- Attributes / aura (pair: earth / fiction). Real = orbiting nature motes
  // and little horns; dream = wizard hat plus a glowing magic orb. The number of
  // attributes scales with the pair magnitude, so a developed creature is more
  // decorated. Generation adds extra motes on top, so prestige is visible. ---
  const accGroup = new THREE.Group();
  const accLean = lean(genome, "earth", "fiction"); // + earth, - fiction
  const accMag = magnitude(genome, "earth", "fiction");
  if (accMag > 0.12) {
    if (accLean >= 0) {
      // Earth: glowing orbiting motes + two little nub horns.
      const n = 3 + Math.round(accMag * 3) + Math.round(mutate * 2);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const star = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.1, 0),
          new THREE.MeshStandardMaterial({ color: GENE_COLOR.earth, emissive: 0x2e5a1c, emissiveIntensity: 0.8, roughness: 0.35 }),
        );
        star.position.set(Math.cos(ang) * 1.5, 1.2 + Math.sin(ang * 2) * 0.2, Math.sin(ang) * 1.5);
        accGroup.add(star);
      }
      for (const dx of [-0.22, 0.22]) {
        const horn = new THREE.Mesh(
          new THREE.ConeGeometry(0.06, 0.22, 10),
          skinMaterial(colors.secondary),
        );
        horn.position.set(dx, 1.05 + headSize * 0.85, 0);
        accGroup.add(horn);
      }
    } else {
      // Fiction: a wizard hat plus a floating glowing orb.
      const hat = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.9, 20),
        new THREE.MeshStandardMaterial({ color: GENE_COLOR.fiction, roughness: 0.35, emissive: 0x2a0a55, emissiveIntensity: 0.7 }),
      );
      hat.position.set(0, 1.05 + headSize, 0);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: GENE_COLOR.fiction, emissiveIntensity: 1.4, roughness: 0.1 }),
      );
      orb.position.set(0.9, 0.9, 0.3);
      accGroup.add(hat, orb);
    }
  }
  group.add(accGroup);

  group.scale.setScalar(s);
  return {
    group,
    parts: { body, head: headGroup, eyes, mouth, arms: armGroup, legs: legGroup, accessory: accGroup },
    colors,
  };
}
