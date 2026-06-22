// Creature lifecycle: hatch, feed, grow, mate. Pure functions over plain data so
// the same logic runs in the browser, on the Devvit server, and in Node tests.
// Time is always passed in (never read from the clock here) so tests are
// deterministic and the server can compute decay lazily.

import {
  type Gene,
  type Genome,
  blend,
  emptyGenome,
  scoreGenetics,
} from "./genome.js";

export type Stage = "egg" | "blob" | "child" | "adult";
export type FeedKind = "read" | "engage" | "create";

export interface Creature {
  id: string;
  ownerId: string;
  name: string;
  homeSub: string;
  genome: Genome;
  generation: number; // 1 for a hatched starter; max(parents)+1 when bred
  xp: number; // total nurture, drives growth stage
  hunger: number; // 0..100, higher is hungrier; decays UP with time
  lastFed: number; // epoch ms
  matedUntil: number; // epoch ms; cannot mate again before this
  streak: number; // consecutive days fed
  born: number; // epoch ms
  parents: [string, string] | null;
}

export const HUNGER_PER_HOUR = 4; // ~25h to go from full to starving
export const MATE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const MATE_HUNGER_COST = 45;

const FEED_GENE_POINTS: Record<FeedKind, number> = {
  read: 3,
  engage: 7,
  create: 15,
};
const FEED_HUNGER_RESTORE: Record<FeedKind, number> = {
  read: 6,
  engage: 12,
  create: 20,
};

// Growth stage from accumulated xp.
export function stage(xp: number): Stage {
  if (xp < 40) return "egg";
  if (xp < 150) return "blob";
  if (xp < 400) return "child";
  return "adult";
}

// Current hunger given the clock. Lazy: we never write hunger on a timer, we
// recompute it from lastFed whenever we read the creature.
export function currentHunger(c: Creature, now: number): number {
  const hours = Math.max(0, (now - c.lastFed) / 3_600_000);
  return Math.min(100, c.hunger + hours * HUNGER_PER_HOUR);
}

// A neglected creature droops; the render reads this.
export function mood(c: Creature, now: number): "happy" | "ok" | "sad" {
  const h = currentHunger(c, now);
  if (h < 35) return "happy";
  if (h < 70) return "ok";
  return "sad";
}

let idCounter = 0;
// Deterministic-ish id without Date.now/Math.random (both banned in some
// sandboxes and bad for tests). Caller can override for real uniqueness.
export function makeId(prefix: string, salt: string | number): string {
  idCounter += 1;
  return `${prefix}_${salt}_${idCounter}`;
}

export interface HatchInput {
  id: string;
  ownerId: string;
  name: string;
  homeSub: string;
  diet: Gene[]; // genes the player self-declared at onboarding
  now: number;
}

// Seed a brand-new Gen-1 creature from the onboarding diet so it looks like the
// player from minute one instead of starting blank.
export function hatch(input: HatchInput): Creature {
  const genome = emptyGenome();
  for (const gene of input.diet) genome[gene] += 18;
  return {
    id: input.id,
    ownerId: input.ownerId,
    name: input.name,
    homeSub: input.homeSub,
    genome,
    generation: 1,
    xp: 20,
    hunger: 20,
    lastFed: input.now,
    matedUntil: 0,
    streak: 1,
    born: input.now,
    parents: null,
  };
}

// One day in ms, for streak bookkeeping.
const DAY_MS = 24 * 60 * 60 * 1000;

// Feeding is any in-app Reddit activity tagged to a category. It restores
// hunger, adds gene points, adds xp, and maintains the daily streak.
export function feed(
  c: Creature,
  gene: Gene,
  kind: FeedKind,
  now: number,
): Creature {
  const hungerNow = currentHunger(c, now);
  const restored = Math.max(0, hungerNow - FEED_HUNGER_RESTORE[kind]);
  const points = FEED_GENE_POINTS[kind];

  // Streak: same day keeps it, next day extends it, a gap resets it.
  const daysSince = Math.floor((now - c.lastFed) / DAY_MS);
  let streak = c.streak;
  if (daysSince === 1) streak += 1;
  else if (daysSince > 1) streak = 1;

  return {
    ...c,
    genome: { ...c.genome, [gene]: c.genome[gene] + points },
    xp: c.xp + points,
    hunger: restored,
    lastFed: now,
    streak,
  };
}

export function canMate(c: Creature, now: number): boolean {
  return now >= c.matedUntil && stage(c.xp) === "adult";
}

export interface MateResult {
  offspring: Creature;
  parentA: Creature;
  parentB: Creature;
}

// Mate two adult creatures. Produces exactly ONE offspring assigned to ownerId
// (the negotiated owner). Both parents take the hunger hit and the cooldown.
// generation = max(parents) + 1: pairing with a higher-gen partner pulls the
// lineage forward, which is why an advanced partner has leverage in the deal.
export function mate(
  a: Creature,
  b: Creature,
  ownerId: string,
  offspringId: string,
  childName: string,
  now: number,
): MateResult {
  const genome = blend(a.genome, b.genome);
  const offspring: Creature = {
    id: offspringId,
    ownerId,
    name: childName,
    homeSub: a.homeSub,
    genome,
    generation: Math.max(a.generation, b.generation) + 1,
    xp: 20,
    hunger: 25,
    lastFed: now,
    matedUntil: 0,
    streak: 1,
    born: now,
    parents: [a.id, b.id],
  };
  const spend = (c: Creature): Creature => ({
    ...c,
    hunger: Math.min(100, currentHunger(c, now) + MATE_HUNGER_COST),
    lastFed: now,
    matedUntil: now + MATE_COOLDOWN_MS,
  });
  return { offspring, parentA: spend(a), parentB: spend(b) };
}

// Lineage score: the headline success metric. Rewards three things at once so no
// single-track strategy dominates:
//   depth   - deeper generations are worth exponentially more
//   quality - complementary, distinctive genomes score high (inbred ones do not)
//   breadth - every viable offspring you have produced adds a flat bonus
export function generationWeight(generation: number): number {
  return Math.pow(1.6, generation - 1); // Gen1=1, Gen2=1.6, Gen3=2.56, ...
}

const OFFSPRING_BONUS = 25;
const VIABLE_QUALITY = 35; // a child below this is "inbred", does not count as viable

export function isViable(c: Creature): boolean {
  return scoreGenetics(c.genome) >= VIABLE_QUALITY;
}

export function lineageScore(creatures: Creature[]): number {
  let score = 0;
  let viableOffspring = 0;
  for (const c of creatures) {
    score += scoreGenetics(c.genome) * generationWeight(c.generation);
    if (c.parents && isViable(c)) viableOffspring += 1;
  }
  return Math.round(score + viableOffspring * OFFSPRING_BONUS);
}
