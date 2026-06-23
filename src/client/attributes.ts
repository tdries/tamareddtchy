// The attribute library: eyes, ears, horns, and hair, each a small family of
// builder functions plus a deterministic selector driven by the genome and the
// animal form. Keeping this out of render.ts so the library can grow wide without
// drowning the main build function.
//
// Every selector is a pure function of (genome, form, id), so a creature always
// looks the same, and breeding (which blends genome + form) shifts the picks
// smoothly. Builders take a small params object and return a THREE.Object3D the
// renderer parents onto the head.

import * as THREE from "three";
import { type Gene, type Genome, dominantGenes } from "../shared/genome.js";
import { type AnimalForm } from "./animals.js";

// ---- shared helpers -------------------------------------------------------

function mat(color: number, rough = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, envMapIntensity: 0.6 });
}
function shade(color: number, f: number): number {
  return new THREE.Color(color).multiplyScalar(f).getHex();
}
// stable 0..1 from a string
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
function pick<T>(arr: T[], t: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];
}

// =====================================================================
// EYES  (6 types) -- driven by the Tech/Heart pair (personality) + size
// =====================================================================

export type EyeType = "round" | "doe" | "sleepy" | "wide" | "visor" | "beady" | "angry" | "cyclops";
export const EYE_TYPES: EyeType[] = ["beady", "round", "doe", "wide", "sleepy", "visor", "angry", "cyclops"];

// One eye, built at the origin facing +Z. The renderer positions/mirrors a pair.
export function buildEye(type: EyeType, r: number): THREE.Group {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, envMapIntensity: 0.4 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.15 });

  const addGlint = (er: number) => {
    const glint = new THREE.Mesh(new THREE.SphereGeometry(er * 0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaaaaa }));
    glint.position.set(er * 0.28, er * 0.32, er * 0.8);
    g.add(glint);
  };

  switch (type) {
    case "beady": { // tiny shiny dot eyes
      const e = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 16, 16), pupilMat);
      g.add(e); addGlint(r * 0.55); break;
    }
    case "round": { // classic white + pupil
      const w = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 22), whiteMat);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 16), pupilMat);
      p.position.z = r * 0.6; g.add(w, p); addGlint(r); break;
    }
    case "doe": { // big, tall, warm
      const w = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 22, 22), whiteMat);
      w.scale.y = 1.25;
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 16, 16), pupilMat);
      p.position.z = r * 0.7; p.position.y = -r * 0.1; g.add(w, p); addGlint(r * 1.15); break;
    }
    case "wide": { // big and bulging
      const w = new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 22, 22), whiteMat);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 16, 16), pupilMat);
      p.position.z = r * 0.95; g.add(w, p); addGlint(r * 1.3); break;
    }
    case "sleepy": { // half-lidded: a squashed white with a lid
      const w = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 22), whiteMat);
      w.scale.y = 0.6;
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 16), pupilMat);
      p.position.z = r * 0.6; p.scale.y = 0.6; g.add(w, p); break;
    }
    case "visor": { // tech: a glowing bar instead of round eyes (built as one wide eye)
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.45, r * 1.1, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x66ffcc, emissive: 0x1aa37a, emissiveIntensity: 1.2, roughness: 0.2 }));
      bar.rotation.z = Math.PI / 2; bar.position.z = r * 0.2; g.add(bar); break;
    }
    case "angry": { // a round eye with an angled brow ridge over it
      const w = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 22), whiteMat);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 16), pupilMat);
      p.position.z = r * 0.6;
      const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r * 0.4, r * 0.4),
        new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.5 }));
      brow.position.set(0, r * 0.85, r * 0.6); brow.rotation.z = -0.35;
      g.add(w, p, brow); addGlint(r); break;
    }
    case "cyclops": { // a single big central eye (renderer overlaps the pair)
      const w = new THREE.Mesh(new THREE.SphereGeometry(r * 1.5, 24, 24), whiteMat);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 18, 18), pupilMat);
      p.position.z = r * 1.1; g.add(w, p); addGlint(r * 1.5); break;
    }
  }
  return g;
}

export function selectEye(genome: Genome): EyeType {
  // Tech end -> visor/beady; Heart end -> doe/wide; middle -> round/sleepy.
  // Mayhem-heavy creatures get an angry brow; fiction-heavy ones rarely a cyclops.
  const tech = genome.tech, heart = genome.heart;
  const sum = tech + heart;
  const warm = sum === 0 ? 0.5 : heart / sum; // 0 tech .. 1 heart
  const top = dominantGenes(genome)[0];
  if (top === "mayhem") return "angry";
  if (top === "fiction" && genome.fiction > 140) return "cyclops";
  if (warm > 0.72) return "doe";
  if (warm > 0.58) return "wide";
  if (warm < 0.28) return "visor";
  if (warm < 0.42) return "beady";
  return sum > 120 ? "round" : "sleepy";
}

// =====================================================================
// MOUTH (6 types) -- driven by Tech/Heart (expression) + dominant gene
// =====================================================================

export type MouthType = "smile" | "grin" | "frown" | "open" | "fang" | "beak";
export const MOUTH_TYPES: MouthType[] = ["smile", "grin", "frown", "open", "fang", "beak"];

// Built at origin facing +Z, sized by `w`. The renderer positions it on the face.
export function buildMouth(type: MouthType, w: number): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a1820, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const arc = (a: number, tube = 0.03) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(w, tube, 10, 24, a), dark);
    m.rotation.z = -Math.PI / 2 - a / 2; return m;
  };
  switch (type) {
    case "smile": g.add(arc(Math.PI * 0.8)); break;
    case "grin": { // wide smile + a row of teeth
      g.add(arc(Math.PI * 1.0, 0.04));
      for (let i = -2; i <= 2; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, w * 0.18, 0.05), white); t.position.set(i * w * 0.32, w * 0.1, 0.02); g.add(t); }
      break;
    }
    case "frown": { const m = arc(Math.PI * 0.7); m.rotation.z = Math.PI / 2 + (Math.PI * 0.7) / 2; m.position.y = -w * 0.3; g.add(m); break; }
    case "open": { const o = new THREE.Mesh(new THREE.SphereGeometry(w * 0.6, 16, 16), dark); o.scale.set(1, 0.7, 0.5); g.add(o); break; }
    case "fang": { // grin with two pointy fangs
      g.add(arc(Math.PI * 0.9));
      for (const dx of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(w * 0.12, w * 0.4, 6), white); f.position.set(dx * w * 0.4, -w * 0.2, 0.03); f.rotation.x = Math.PI; g.add(f); }
      break;
    }
    case "beak": { const b = new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, w * 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xe0a23a, roughness: 0.5 })); b.rotation.x = Math.PI / 2; g.add(b); break; }
  }
  return g;
}

export function selectMouth(genome: Genome): MouthType {
  const top = dominantGenes(genome)[0];
  if (top === "mayhem") return "fang";
  if (top === "heart") return "grin";
  if (top === "pulse" || top === "vitality") return "open";
  if (top === "tech") return "beak";
  const tech = genome.tech, heart = genome.heart;
  const warm = tech + heart === 0 ? 0.5 : heart / (tech + heart);
  return warm < 0.35 ? "frown" : "smile";
}

// =====================================================================
// NOSE (5 types) -- driven by the animal form + dominant gene
// =====================================================================

export type NoseType = "button" | "snout" | "beak" | "trunk" | "flat";
export const NOSE_TYPES: NoseType[] = ["button", "snout", "beak", "trunk", "flat"];

export function buildNose(type: NoseType, r: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  switch (type) {
    case "button": { const n = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), m); n.scale.z = 1.2; g.add(n); break; }
    case "snout": { const n = new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 14, 14), m); n.scale.set(1.3, 0.8, 1.4); g.add(n); break; }
    case "beak": { const n = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xe0a23a, roughness: 0.5 })); n.rotation.x = Math.PI / 2; g.add(n); break; }
    case "trunk": { // a drooping segmented trunk (elephant)
      let parent: THREE.Object3D = g;
      for (let i = 0; i < 4; i++) { const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r * (0.8 - i * 0.12), r * 0.5, 4, 8), m); seg.position.set(0, -r * 0.5, i === 0 ? r : 0); if (i > 0) seg.position.y = -r * 0.6; parent.add(seg); parent = seg; } break;
    }
    case "flat": { const n = new THREE.Mesh(new THREE.BoxGeometry(r * 1.4, r * 0.8, r * 0.5), m); g.add(n); break; }
  }
  return g;
}

export function selectNose(genome: Genome, form: AnimalForm): NoseType {
  if (form.headLong > 0.85) return "trunk"; // elephant-ish
  if (form.headLong > 0.6) return "snout"; // muzzle animals
  if (form.snoutWide > 0.85) return "flat"; // hippo/croc broad
  if (dominantGenes(genome)[0] === "tech") return "beak";
  return "button";
}

// =====================================================================
// EARS  (6 types) -- driven mainly by the animal form
// =====================================================================

export type EarType = "none" | "round" | "pointed" | "floppy" | "tall" | "tufted";
export const EAR_TYPES: EarType[] = ["none", "round", "floppy", "pointed", "tall", "tufted"];

export function buildEars(type: EarType, headSize: number, color: number): THREE.Group {
  const g = new THREE.Group();
  if (type === "none") return g;
  const m = mat(shade(color, 0.92));
  for (const side of [-1, 1]) {
    let ear: THREE.Mesh;
    switch (type) {
      case "round":
        ear = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.32, 14, 14), m);
        ear.scale.set(1, 1, 0.5); break;
      case "floppy":
        ear = new THREE.Mesh(new THREE.CapsuleGeometry(headSize * 0.16, headSize * 0.6, 6, 10), m);
        ear.rotation.z = side * 0.5; ear.rotation.x = 0.3; break;
      case "pointed":
        ear = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.22, headSize * 0.55, 10), m); break;
      case "tall":
        ear = new THREE.Mesh(new THREE.CapsuleGeometry(headSize * 0.1, headSize * 0.9, 6, 10), m); break;
      case "tufted":
        ear = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.16, headSize * 0.45, 8), m); break;
      default:
        ear = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.25, 12, 12), m);
    }
    // Sit ears up on the crown, clear of the head sphere so they are not
    // swallowed: high y, well out in x, and lifted by their own height.
    ear.position.set(side * headSize * 0.78, headSize * 1.0, 0);
    if (type === "pointed" || type === "tall" || type === "tufted") ear.rotation.z = side * 0.18;
    g.add(ear);
    if (type === "tufted") { // little fur tuft tip
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.07, 8, 8), mat(shade(color, 1.3)));
      tuft.position.set(side * headSize * 0.78, headSize * 1.3, 0); g.add(tuft);
    }
  }
  return g;
}

export function selectEar(form: AnimalForm): EarType {
  if (form.earSize < 0.25) return "none";
  if (form.earTall > 0.8) return form.earSize > 0.7 ? "tall" : "pointed";
  if (form.earTall > 0.5) return form.earSize > 0.7 ? "tufted" : "pointed";
  return form.earSize > 0.7 ? "floppy" : "round";
}

// =====================================================================
// HORNS  (5 types incl none) -- driven by the Craft/Mayhem (order/chaos) pair
// =====================================================================

export type HornType = "none" | "nub" | "curved" | "straight" | "antlers";
export const HORN_TYPES: HornType[] = ["none", "nub", "straight", "curved", "antlers"];

export function buildHorns(type: HornType, headSize: number, color: number): THREE.Group {
  const g = new THREE.Group();
  if (type === "none") return g;
  const m = mat(shade(color, 0.7), 0.45);
  for (const side of [-1, 1]) {
    let horn: THREE.Object3D;
    switch (type) {
      case "nub":
        horn = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.12, 10, 10), m); break;
      case "straight":
        horn = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.09, headSize * 0.5, 10), m); break;
      case "curved": {
        horn = new THREE.Mesh(new THREE.TorusGeometry(headSize * 0.18, headSize * 0.05, 8, 16, Math.PI * 1.1), m);
        horn.rotation.z = side * 0.4; break;
      }
      case "antlers": {
        // a small branched antler: a stem + two prongs
        const stem = new THREE.Group();
        const main = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.05, headSize * 0.5, 8), m);
        const p1 = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.03, headSize * 0.25, 6), m);
        p1.position.set(headSize * 0.1, headSize * 0.18, 0); p1.rotation.z = -0.7;
        const p2 = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.03, headSize * 0.2, 6), m);
        p2.position.set(-headSize * 0.06, headSize * 0.1, 0); p2.rotation.z = 0.6;
        stem.add(main, p1, p2); horn = stem; break;
      }
      default:
        horn = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.1, headSize * 0.4, 8), m);
    }
    // Horns sprout from the crown, lifted clear of the head sphere.
    horn.position.set(side * headSize * 0.45, headSize * 1.05, 0);
    if (type !== "curved") horn.rotation.z += side * 0.15;
    g.add(horn);
  }
  return g;
}

export function selectHorn(genome: Genome): HornType {
  // Chaos (mayhem) end grows wild antlers/curves; order (craft) end is bare or nubs.
  const craft = genome.craft, mayhem = genome.mayhem;
  const sum = craft + mayhem;
  if (sum < 40) return "none";
  const chaos = mayhem / sum; // 0 order .. 1 chaos
  if (chaos > 0.7) return "antlers";
  if (chaos > 0.5) return "curved";
  if (chaos > 0.35) return "straight";
  return "nub";
}

// =====================================================================
// HAIR  (8 types) -- driven by animal form + dominant gene, id for variety
// =====================================================================

export type HairType = "none" | "tuft" | "mohawk" | "mane" | "shaggy" | "spikes" | "curls" | "topknot";
export const HAIR_TYPES: HairType[] = ["none", "tuft", "mohawk", "mane", "shaggy", "spikes", "curls", "topknot"];

export function buildHair(type: HairType, headSize: number, color: number): THREE.Group {
  const g = new THREE.Group();
  if (type === "none") return g;
  const m = mat(color, 0.8);
  const top = headSize * 0.85;
  const tuftAt = (x: number, y: number, z: number, s: number, rot = 0) => {
    const t = new THREE.Mesh(new THREE.ConeGeometry(s * 0.5, s, 7), m);
    t.position.set(x, y, z); t.rotation.x = rot; g.add(t);
  };
  switch (type) {
    case "tuft": tuftAt(0, top, 0.05, headSize * 0.4, -0.2); break;
    case "mohawk":
      for (let i = 0; i < 5; i++) tuftAt(0, top + Math.sin(i) * 0.02, headSize * (0.3 - i * 0.14), headSize * (0.5 - i * 0.05)); break;
    case "spikes":
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        tuftAt(Math.cos(a) * headSize * 0.4, top * 0.9, Math.sin(a) * headSize * 0.4, headSize * 0.35);
      } break;
    case "curls":
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const c = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.14, 10, 10), m);
        c.position.set(Math.cos(a) * headSize * 0.42, top, Math.sin(a) * headSize * 0.42); g.add(c);
      } break;
    case "topknot": {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.22, 12, 12), m);
      knot.position.set(0, top + headSize * 0.18, 0); g.add(knot);
      tuftAt(0, top, 0, headSize * 0.2); break;
    }
    case "mane":
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * (0.15 + (i / 10) * 0.7);
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(headSize * 0.08, headSize * 0.4, 5, 8), m);
        seg.position.set(Math.cos(a) * headSize * 0.7, Math.sin(a) * headSize * 0.4, -headSize * 0.5);
        seg.rotation.z = a - Math.PI / 2; g.add(seg);
      } break;
    case "shaggy":
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const strand = new THREE.Mesh(new THREE.CapsuleGeometry(headSize * 0.05, headSize * 0.45, 4, 6), m);
        strand.position.set(Math.cos(a) * headSize * 0.55, top * 0.7, Math.sin(a) * headSize * 0.55);
        strand.rotation.z = Math.cos(a) * 0.5; strand.rotation.x = Math.sin(a) * 0.5; g.add(strand);
      } break;
  }
  return g;
}

export function selectHair(genome: Genome, form: AnimalForm, id: string): HairType {
  const dom = dominantGenes(genome)[0];
  const h = hash01(id + "#hair");
  // A few genes strongly imply a hairstyle; otherwise vary by id within a set
  // chosen by the animal's vibe.
  if (dom === "mayhem") return h < 0.5 ? "mohawk" : "spikes";
  if (dom === "vitality" || dom === "social") return "mane";
  if (dom === "heart") return h < 0.5 ? "curls" : "tuft";
  if (dom === "inner") return "topknot";
  if (form.legThick > 1.4) return "shaggy"; // big beasts
  // default spread by id
  return pick<HairType>(["none", "tuft", "shaggy", "curls", "mohawk"], h);
}

// One call to resolve every attribute for a creature.
export interface CreatureAttributes {
  eye: EyeType;
  ear: EarType;
  horn: HornType;
  hair: HairType;
  mouth: MouthType;
  nose: NoseType;
}
export function resolveAttributes(genome: Genome, form: AnimalForm, id: string): CreatureAttributes {
  return {
    eye: selectEye(genome),
    ear: selectEar(form),
    horn: selectHorn(genome),
    hair: selectHair(genome, form, id),
    mouth: selectMouth(genome),
    nose: selectNose(genome, form),
  };
}

// re-export for callers that want the gene type
export type { Gene };
