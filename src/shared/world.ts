// The living-world simulation: a small, emergent agent sim that is the seed of
// the full Creatures-style architecture (genome -> internal chemistry -> action).
// Phase 1 keeps the "chemistry" to three drives and the "controller" to a tiny
// hand-wired drive->action selector; later phases replace these in place with a
// real concentration vector and a learned neural controller (see the design doc).
//
// Pure: no THREE, no DOM, no clock reads. Time and randomness are passed in, so
// the whole sim runs deterministically in Node tests. The renderer (worldScene)
// reads agent positions each frame; it never drives logic.

import { type Creature, mate, canMate } from "./creature.js";

export interface Vec2 { x: number; z: number; }

// An agent is a creature placed in the world with a body in motion and an
// internal state. The internal state is the minimal "chemistry": three drives
// that decay/grow over time. Behavior emerges from which drive dominates.
export interface Agent {
  creature: Creature;
  pos: Vec2;
  vel: Vec2;
  // drives (0..1): the chemistry. higher = more pressure.
  hunger: number; // rises over time; eating lowers it
  social: number; // rises when alone; meeting others lowers it
  energy: number; // falls with motion; rests recover it
  intent: Intent; // current chosen action (the controller output)
  target: number | null; // index of focus (food or agent), the attention output
  matedAt: number; // last breed time, for a cooldown
}

export type Intent = "wander" | "seekFood" | "seekMate" | "rest";

export interface Food { pos: Vec2; }

export interface WorldEvent {
  type: "ate" | "bred";
  a: number; // agent index
  b?: number; // partner index (bred)
  offspring?: Creature; // bred
  pos: Vec2;
}

const SPEED = 1.4;
const ARENA = 9; // half-extent of the square arena
const EAT_DIST = 0.9;
const MATE_DIST = 1.1;
const MATE_COOLDOWN = 8000; // ms between an agent's breeds in-world

// Deterministic pseudo-random from an integer seed, so the sim is reproducible.
// Returns 0..1 and a next seed.
function rng(seed: number): [number, number] {
  const s = (seed * 1103515245 + 12345) & 0x7fffffff;
  return [s / 0x7fffffff, s];
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.z - b.z); }

// The controller: pick the action from the dominant drive. This is the one place
// Phase 3 swaps in a learned neural net; for now it is the obvious hand-wired
// policy (high hunger -> eat, else high social -> mate-seek, else low energy ->
// rest, else wander). Kept tiny and explicit so the upgrade path is clear.
function chooseIntent(a: Agent): Intent {
  if (a.energy < 0.15) return "rest";
  if (a.hunger > 0.6) return "seekFood";
  if (a.social > 0.6 && a.hunger < 0.5) return "seekMate";
  return "wander";
}

function nearest<T extends { pos: Vec2 }>(from: Vec2, items: T[], skip = -1): number {
  let best = -1, bestD = Infinity;
  items.forEach((it, i) => {
    if (i === skip) return;
    const d = dist(from, it.pos);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Steer `a` toward a point at full speed.
function seek(a: Agent, target: Vec2): void {
  const dx = target.x - a.pos.x, dz = target.z - a.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  a.vel.x = (dx / len) * SPEED;
  a.vel.z = (dz / len) * SPEED;
}

// Advance the whole world one step. dt in seconds, now in ms. Mutates agents and
// food in place and returns the events that happened this step (for the renderer
// and for posting milestones). `seed` varies the wander each call.
export function stepWorld(
  agents: Agent[],
  food: Food[],
  dt: number,
  now: number,
  seed: number,
  makeOffspringId: () => string,
): WorldEvent[] {
  const events: WorldEvent[] = [];
  let s = seed;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];

    // --- chemistry: drives decay/grow ---
    a.hunger = clamp01(a.hunger + dt * 0.04);
    const others = agents.length - 1;
    // social rises when few others are near, falls when company is close
    const near = agents.filter((o, j) => j !== i && dist(a.pos, o.pos) < 3).length;
    a.social = clamp01(a.social + dt * (near > 0 ? -0.08 : 0.05) * (others ? 1 : 0));
    const moving = Math.hypot(a.vel.x, a.vel.z) > 0.1;
    a.energy = clamp01(a.energy + dt * (moving ? -0.03 : 0.06));

    // --- controller: choose intent + target ---
    a.intent = chooseIntent(a);
    a.target = null;

    if (a.intent === "rest") {
      a.vel.x *= 0.8; a.vel.z *= 0.8;
    } else if (a.intent === "seekFood" && food.length) {
      const fi = nearest(a.pos, food);
      a.target = fi;
      seek(a, food[fi].pos);
      if (dist(a.pos, food[fi].pos) < EAT_DIST) {
        a.hunger = clamp01(a.hunger - 0.6);
        a.energy = clamp01(a.energy + 0.2);
        const pos = food[fi].pos;
        food.splice(fi, 1);
        events.push({ type: "ate", a: i, pos });
      }
    } else if (a.intent === "seekMate") {
      // seek the nearest fellow ADULT that is also off cooldown
      const mi = nearestMate(agents, i, now);
      if (mi >= 0) {
        a.target = mi;
        seek(a, agents[mi].pos);
      } else {
        wander(a, s); [, s] = rng(s);
      }
    } else {
      wander(a, s); [, s] = rng(s);
    }

    // separation: gently push apart so they do not stack
    for (let j = 0; j < agents.length; j++) {
      if (j === i) continue;
      const d = dist(a.pos, agents[j].pos);
      if (d > 0 && d < 1.2) {
        a.vel.x += (a.pos.x - agents[j].pos.x) / d * 0.4;
        a.vel.z += (a.pos.z - agents[j].pos.z) / d * 0.4;
      }
    }

    // integrate + keep inside the arena
    a.pos.x = Math.max(-ARENA, Math.min(ARENA, a.pos.x + a.vel.x * dt));
    a.pos.z = Math.max(-ARENA, Math.min(ARENA, a.pos.z + a.vel.z * dt));
  }

  // --- breeding: two adults that meet, both off cooldown, low hunger ---
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i], b = agents[j];
      if (dist(a.pos, b.pos) > MATE_DIST) continue;
      if (!readyToMate(a, now) || !readyToMate(b, now)) continue;
      const owner = a.creature.ownerId; // proposer keeps it; tunable later
      const offspring = mate(
        a.creature, b.creature, owner, makeOffspringId(), `${a.creature.name} Jr`, now,
      ).offspring;
      a.matedAt = now; b.matedAt = now;
      a.social = 0.2; b.social = 0.2; a.hunger = clamp01(a.hunger + 0.3); b.hunger = clamp01(b.hunger + 0.3);
      events.push({ type: "bred", a: i, b: j, offspring, pos: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 } });
    }
  }

  return events;
}

function readyToMate(a: Agent, now: number): boolean {
  return canMate(a.creature, now) && now - a.matedAt > MATE_COOLDOWN && a.hunger < 0.6;
}

function nearestMate(agents: Agent[], self: number, now: number): number {
  let best = -1, bestD = Infinity;
  for (let j = 0; j < agents.length; j++) {
    if (j === self) continue;
    if (!readyToMate(agents[j], now)) continue;
    const d = dist(agents[self].pos, agents[j].pos);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

// Wander: nudge the velocity by a small seeded random turn, capped to speed.
function wander(a: Agent, seed: number): void {
  const [r] = rng(seed);
  const ang = r * Math.PI * 2;
  a.vel.x += Math.cos(ang) * 0.3;
  a.vel.z += Math.sin(ang) * 0.3;
  const len = Math.hypot(a.vel.x, a.vel.z) || 1;
  if (len > SPEED) { a.vel.x = a.vel.x / len * SPEED; a.vel.z = a.vel.z / len * SPEED; }
}

// Place an agent for a creature at a seeded position in the arena.
export function spawnAgent(creature: Creature, seed: number): Agent {
  const [rx, s1] = rng(seed);
  const [rz] = rng(s1);
  return {
    creature,
    pos: { x: (rx - 0.5) * ARENA * 1.6, z: (rz - 0.5) * ARENA * 1.6 },
    vel: { x: 0, z: 0 },
    hunger: rx * 0.4, social: rz * 0.5, energy: 0.7 + rx * 0.3,
    intent: "wander", target: null, matedAt: 0,
  };
}

export function scatterFood(count: number, seed: number): Food[] {
  const food: Food[] = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    let rx: number, rz: number;
    [rx, s] = rng(s); [rz, s] = rng(s);
    food.push({ pos: { x: (rx - 0.5) * ARENA * 1.7, z: (rz - 0.5) * ARENA * 1.7 } });
  }
  return food;
}

export { ARENA };
