// Animal form archetypes. Each creature is born as one of 20 animal silhouettes
// (dog, cat, horse, ...), which gives instant gen-1 variety on top of the genome.
// The archetype is a set of shape parameters that the renderer reads to grow
// ears, a snout, a tail, a neck, and the limb proportions. Offspring BLEND their
// parents' archetypes (interpolate the parameters), so a dog x horse child is a
// genuine hybrid silhouette, matching the gene-mixing theme.
//
// Pure data + math: no Three.js here, so it stays trivially testable.

export interface AnimalForm {
  name: string;
  bodyLong: number; // 1 = round, >1 = elongated torso (horse, croc)
  bodyTall: number; // height stretch of the torso
  neck: number; // 0 = none, 1 = long (giraffe)
  headLong: number; // snout length (0 round face, 1 long muzzle)
  earSize: number; // 0..1
  earTall: number; // 0 = round/floppy, 1 = tall pointed
  legLen: number; // limb length multiplier
  legThick: number; // limb thickness multiplier
  tail: number; // 0 none, 1 long
  hump: number; // shoulder/back hump (camel-ish, gorilla, bison)
  snoutWide: number; // broad muzzle (hippo, croc, bear) vs fine (fox, deer)
}

// 20 archetypes. Numbers are deliberately readable: this is art direction.
export const ANIMALS: AnimalForm[] = [
  { name: "Dog",         bodyLong: 1.3, bodyTall: 1.0, neck: 0.2, headLong: 0.6, earSize: 0.6, earTall: 0.3, legLen: 1.0, legThick: 1.0, tail: 0.7, hump: 0.1, snoutWide: 0.5 },
  { name: "Cat",         bodyLong: 1.2, bodyTall: 0.95, neck: 0.2, headLong: 0.3, earSize: 0.7, earTall: 0.9, legLen: 0.95, legThick: 0.8, tail: 0.9, hump: 0.0, snoutWide: 0.3 },
  { name: "Horse",       bodyLong: 1.5, bodyTall: 1.1, neck: 0.7, headLong: 0.9, earSize: 0.5, earTall: 0.7, legLen: 1.5, legThick: 0.9, tail: 0.8, hump: 0.1, snoutWide: 0.4 },
  { name: "Cow",         bodyLong: 1.5, bodyTall: 1.0, neck: 0.3, headLong: 0.7, earSize: 0.6, earTall: 0.3, legLen: 1.1, legThick: 1.2, tail: 0.6, hump: 0.2, snoutWide: 0.7 },
  { name: "Sheep",       bodyLong: 1.2, bodyTall: 1.1, neck: 0.2, headLong: 0.5, earSize: 0.6, earTall: 0.2, legLen: 0.9, legThick: 1.0, tail: 0.2, hump: 0.3, snoutWide: 0.5 },
  { name: "Lion",        bodyLong: 1.35, bodyTall: 1.05, neck: 0.3, headLong: 0.4, earSize: 0.5, earTall: 0.4, legLen: 1.1, legThick: 1.2, tail: 0.7, hump: 0.3, snoutWide: 0.6 },
  { name: "Tiger",       bodyLong: 1.45, bodyTall: 1.0, neck: 0.3, headLong: 0.45, earSize: 0.5, earTall: 0.5, legLen: 1.1, legThick: 1.1, tail: 0.9, hump: 0.2, snoutWide: 0.6 },
  { name: "Elephant",    bodyLong: 1.4, bodyTall: 1.3, neck: 0.2, headLong: 1.0, earSize: 1.0, earTall: 0.1, legLen: 1.2, legThick: 1.6, tail: 0.4, hump: 0.2, snoutWide: 0.9 },
  { name: "Giraffe",     bodyLong: 1.2, bodyTall: 1.2, neck: 1.0, headLong: 0.7, earSize: 0.4, earTall: 0.6, legLen: 1.7, legThick: 0.8, tail: 0.5, hump: 0.1, snoutWide: 0.4 },
  { name: "Zebra",       bodyLong: 1.5, bodyTall: 1.1, neck: 0.6, headLong: 0.85, earSize: 0.5, earTall: 0.7, legLen: 1.45, legThick: 0.9, tail: 0.7, hump: 0.1, snoutWide: 0.4 },
  { name: "Bear",        bodyLong: 1.3, bodyTall: 1.2, neck: 0.1, headLong: 0.5, earSize: 0.5, earTall: 0.3, legLen: 0.9, legThick: 1.5, tail: 0.1, hump: 0.4, snoutWide: 0.7 },
  { name: "Wolf",        bodyLong: 1.4, bodyTall: 1.0, neck: 0.3, headLong: 0.7, earSize: 0.6, earTall: 0.8, legLen: 1.2, legThick: 0.95, tail: 0.9, hump: 0.2, snoutWide: 0.45 },
  { name: "Fox",         bodyLong: 1.3, bodyTall: 0.9, neck: 0.2, headLong: 0.8, earSize: 0.8, earTall: 0.95, legLen: 1.0, legThick: 0.7, tail: 1.0, hump: 0.0, snoutWide: 0.3 },
  { name: "Deer",        bodyLong: 1.25, bodyTall: 1.1, neck: 0.6, headLong: 0.7, earSize: 0.7, earTall: 0.7, legLen: 1.5, legThick: 0.7, tail: 0.3, hump: 0.1, snoutWide: 0.35 },
  { name: "Kangaroo",    bodyLong: 1.1, bodyTall: 1.3, neck: 0.3, headLong: 0.6, earSize: 0.8, earTall: 0.9, legLen: 1.4, legThick: 1.3, tail: 1.0, hump: 0.2, snoutWide: 0.4 },
  { name: "Monkey",      bodyLong: 1.1, bodyTall: 1.0, neck: 0.2, headLong: 0.3, earSize: 0.7, earTall: 0.2, legLen: 1.1, legThick: 0.8, tail: 1.0, hump: 0.1, snoutWide: 0.4 },
  { name: "Gorilla",     bodyLong: 1.2, bodyTall: 1.25, neck: 0.0, headLong: 0.35, earSize: 0.4, earTall: 0.2, legLen: 0.85, legThick: 1.7, tail: 0.0, hump: 0.6, snoutWide: 0.7 },
  { name: "Hippopotamus",bodyLong: 1.6, bodyTall: 1.05, neck: 0.0, headLong: 0.6, earSize: 0.4, earTall: 0.2, legLen: 0.75, legThick: 1.7, tail: 0.2, hump: 0.1, snoutWide: 1.0 },
  { name: "Rhinoceros",  bodyLong: 1.55, bodyTall: 1.1, neck: 0.1, headLong: 0.7, earSize: 0.4, earTall: 0.4, legLen: 0.85, legThick: 1.6, tail: 0.3, hump: 0.3, snoutWide: 0.85 },
  { name: "Crocodile",   bodyLong: 1.9, bodyTall: 0.8, neck: 0.1, headLong: 1.0, earSize: 0.2, earTall: 0.2, legLen: 0.7, legThick: 1.0, tail: 1.0, hump: 0.0, snoutWide: 0.8 },
];

// Stable 0..1 hash from a string id (no Math.random: a creature's animal never
// changes between renders).
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// The animal a creature is born as, picked deterministically from its id.
export function animalForId(id: string): AnimalForm {
  return ANIMALS[Math.floor(hash01(id + "#animal") * ANIMALS.length) % ANIMALS.length];
}

// Linear interpolate two forms. Used so an offspring is a hybrid of its parents'
// silhouettes (dog ears easing toward horse body, etc.).
export function blendForms(a: AnimalForm, b: AnimalForm, t = 0.5): AnimalForm {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    name: t < 0.5 ? `${a.name}-${b.name}` : `${b.name}-${a.name}`,
    bodyLong: lerp(a.bodyLong, b.bodyLong),
    bodyTall: lerp(a.bodyTall, b.bodyTall),
    neck: lerp(a.neck, b.neck),
    headLong: lerp(a.headLong, b.headLong),
    earSize: lerp(a.earSize, b.earSize),
    earTall: lerp(a.earTall, b.earTall),
    legLen: lerp(a.legLen, b.legLen),
    legThick: lerp(a.legThick, b.legThick),
    tail: lerp(a.tail, b.tail),
    hump: lerp(a.hump, b.hump),
    snoutWide: lerp(a.snoutWide, b.snoutWide),
  };
}

// Resolve the form for a creature: if it has parents, blend their two forms;
// otherwise use its own id-derived form. parentIds are the creature.parents.
export function formForCreature(id: string, parents: [string, string] | null): AnimalForm {
  if (!parents) return animalForId(id);
  const a = animalForId(parents[0]);
  const b = animalForId(parents[1]);
  // Mix ratio is stable per child so the hybrid is consistent.
  const t = 0.35 + hash01(id + "#mix") * 0.3; // 0.35..0.65, near-even hybrid
  return blendForms(a, b, t);
}
