import { describe, it, expect } from "vitest";
import { buildCreature, creatureColors } from "./render.js";
import { emptyGenome } from "../shared/genome.js";

function g(parts: Record<string, number>) {
  return { ...emptyGenome(), ...parts };
}

describe("buildCreature", () => {
  it("produces all six body slots", () => {
    const { parts } = buildCreature(g({ knowledge: 100, vitality: 80 }), 1, 500);
    expect(parts.body).toBeDefined();
    expect(parts.head).toBeDefined();
    expect(parts.eyes.length).toBe(2);
    expect(parts.arms.children.length).toBeGreaterThan(0);
    expect(parts.legs.children.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same inputs", () => {
    const genome = g({ knowledge: 90, mayhem: 70, fiction: 40 });
    const a = buildCreature(genome, 2, 300);
    const b = buildCreature(genome, 2, 300);
    expect(a.group.children.length).toBe(b.group.children.length);
    expect(a.colors).toEqual(b.colors);
  });

  it("picks a single rooted base when Inner dominates, many legs when Social does", () => {
    const inner = buildCreature(g({ inner: 200 }), 1, 500);
    const social = buildCreature(g({ social: 200 }), 1, 500);
    expect(inner.parts.legs.children.length).toBe(1);
    expect(social.parts.legs.children.length).toBeGreaterThan(1);
  });

  it("colors come from the two dominant genes", () => {
    const colors = creatureColors(g({ heart: 200, craft: 150 }));
    expect(colors.primary).not.toBe(colors.secondary);
  });

  it("a higher generation deviates the geometry further from baseline", () => {
    const genome = g({ knowledge: 100, mayhem: 100 });
    // Compare summed vertex displacement of the torso blob across generations.
    const spread = (gen: number) => {
      const { parts } = buildCreature(genome, gen, 500);
      const pos = (parts.body.geometry as any).attributes.position;
      let r = 0;
      for (let i = 0; i < pos.count; i++) {
        r += Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      return r / pos.count;
    };
    // Higher generation = more chaos wobble = larger average radius deviation.
    expect(spread(5)).not.toBeCloseTo(spread(1), 3);
  });
});
