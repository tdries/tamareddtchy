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

// A soft, organic blob: an icosphere we can dent. Reused for every body part so
// the whole creature reads as one squishy material.
function blob(radius: number, detail: number, color: number, wobble = 0): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  if (wobble > 0) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + (pseudoNoise(i) - 0.5) * wobble;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    flatShading: false,
  });
  return new THREE.Mesh(geo, mat);
}

// Deterministic per-vertex jitter (no Math.random: keeps render reproducible and
// testable). Cheap hash -> 0..1.
function pseudoNoise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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
  const body = blob(1, 4, colors.primary, chaos);
  body.scale.set(1, 1.05 - torsoLean * 0.15, 1);
  group.add(body);

  // --- Head (pair: knowledge / vitality). Mind = big domed head, body = sleek. ---
  const headGroup = new THREE.Group();
  const headLean = lean(genome, "knowledge", "vitality");
  const headSize = 0.55 + magnitude(genome, "knowledge", "vitality") * 0.25 + (headLean > 0 ? 0.12 : 0);
  const head = blob(headSize, 3, colors.primary, 0.15 + mutate * 0.3);
  head.scale.y = headLean > 0 ? 1.15 : 0.92; // domed vs sleek
  headGroup.add(head);
  headGroup.position.set(0, 1.05, 0);

  // --- Eyes / face (pair: tech / heart). Tech = small visor eyes, heart = big. ---
  const eyeLean = lean(genome, "tech", "heart"); // + tech, - heart
  const eyeR = eyeLean < 0 ? 0.22 : 0.13; // heart = big doe eyes
  const eyes: THREE.Mesh[] = [];
  for (const dx of [-0.22, 0.22]) {
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
    );
    white.position.set(dx, 0.02, headSize * 0.82);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(eyeR * 0.55, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x161616 }),
    );
    pupil.position.set(dx, 0.02, headSize * 0.82 + eyeR * 0.6);
    headGroup.add(white, pupil);
    eyes.push(white);
  }
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

  // --- Accessory / aura (pair: earth / fiction). Real = leaf/star, dream = hat. ---
  const accGroup = new THREE.Group();
  const accLean = lean(genome, "earth", "fiction"); // + earth, - fiction
  const accMag = magnitude(genome, "earth", "fiction");
  if (accMag > 0.12) {
    if (accLean >= 0) {
      // Earth: little orbiting leaves/stars
      const n = 3 + Math.round(accMag * 3);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const star = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.12),
          new THREE.MeshStandardMaterial({ color: GENE_COLOR.earth, emissive: 0x224411, roughness: 0.4 }),
        );
        star.position.set(Math.cos(ang) * 1.5, 1.3, Math.sin(ang) * 1.5);
        accGroup.add(star);
      }
    } else {
      // Fiction: a wizard hat / cape
      const hat = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.9, 16),
        new THREE.MeshStandardMaterial({ color: GENE_COLOR.fiction, roughness: 0.4, emissive: 0x1a0033 }),
      );
      hat.position.set(0, 1.05 + headSize, 0);
      accGroup.add(hat);
    }
  }
  group.add(accGroup);

  group.scale.setScalar(s);
  return {
    group,
    parts: { body, head: headGroup, eyes, arms: armGroup, legs: legGroup, accessory: accGroup },
    colors,
  };
}
