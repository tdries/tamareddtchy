import { describe, it, expect } from "vitest";
import { emptyGenome } from "./genome.js";
import { type Creature } from "./creature.js";
import { stepWorld, spawnAgent, scatterFood, type Agent, type Food } from "./world.js";

const NOW = 1_700_000_000_000;

function adult(id: string, parts: Record<string, number>): Creature {
  return {
    id, ownerId: "u_" + id, name: id, homeSub: "test",
    genome: { ...emptyGenome(), ...parts }, generation: 1, xp: 600,
    hunger: 10, lastFed: NOW, matedUntil: 0, streak: 1, born: NOW, parents: null,
  };
}

function place(c: Creature, x: number, z: number): Agent {
  const a = spawnAgent(c, 1);
  a.pos = { x, z }; a.vel = { x: 0, z: 0 };
  return a;
}

let kid = 0;
const newId = () => `kid_${kid++}`;

describe("world sim", () => {
  it("hunger rises over time", () => {
    const a = place(adult("a", { knowledge: 100 }), 0, 0);
    a.hunger = 0.2;
    stepWorld([a], [], 1, NOW, 7, newId);
    expect(a.hunger).toBeGreaterThan(0.2);
  });

  it("a hungry agent moves toward food and eats it", () => {
    const a = place(adult("a", { knowledge: 100 }), 0, 0);
    a.hunger = 0.9; // very hungry -> seekFood
    const food: Food[] = [{ pos: { x: 2, z: 0 } }];
    let ate = false;
    for (let t = 0; t < 60 && food.length; t++) {
      const ev = stepWorld([a], food, 0.2, NOW + t * 200, 7 + t, newId);
      if (ev.some((e) => e.type === "ate")) ate = true;
    }
    expect(ate).toBe(true);
    expect(a.hunger).toBeLessThan(0.9); // eating lowered hunger
  });

  it("two ready adults that meet produce an offspring", () => {
    const a = place(adult("a", { knowledge: 120, tech: 100 }), 0, 0);
    const b = place(adult("b", { vitality: 120, heart: 100 }), 0.5, 0);
    a.hunger = 0.2; b.hunger = 0.2; a.social = 0.9; b.social = 0.9;
    const events = stepWorld([a, b], [], 0.2, NOW, 7, newId);
    const bred = events.find((e) => e.type === "bred");
    expect(bred).toBeDefined();
    expect(bred!.offspring).toBeDefined();
    expect(bred!.offspring!.parents).toEqual(["a", "b"]);
  });

  it("agents stay inside the arena", () => {
    const a = place(adult("a", { mayhem: 200 }), 8.5, 8.5);
    for (let t = 0; t < 50; t++) stepWorld([a], [], 0.3, NOW + t * 300, t, newId);
    expect(Math.abs(a.pos.x)).toBeLessThanOrEqual(9.001);
    expect(Math.abs(a.pos.z)).toBeLessThanOrEqual(9.001);
  });

  it("scatterFood produces the requested count deterministically", () => {
    const f1 = scatterFood(8, 42);
    const f2 = scatterFood(8, 42);
    expect(f1.length).toBe(8);
    expect(f1[3].pos).toEqual(f2[3].pos); // deterministic
  });
});
