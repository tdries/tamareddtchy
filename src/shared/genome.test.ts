import { describe, it, expect } from "vitest";
import {
  GENES,
  PAIRS,
  emptyGenome,
  scoreGenetics,
  blend,
  complement,
  complementarity,
  dominantGenes,
} from "./genome.js";
import {
  hatch,
  feed,
  mate,
  stage,
  currentHunger,
  lineageScore,
  generationWeight,
  HUNGER_PER_HOUR,
  type Creature,
} from "./creature.js";

const NOW = 1_700_000_000_000;

function genomeFrom(parts: Record<string, number>) {
  return { ...emptyGenome(), ...parts };
}

describe("genome basics", () => {
  it("has 12 genes in 6 pairs, each gene in exactly one pair", () => {
    expect(GENES.length).toBe(12);
    expect(PAIRS.length).toBe(6);
    const seen = new Set<string>();
    for (const [a, b] of PAIRS) {
      seen.add(a);
      seen.add(b);
      expect(complement(a)).toBe(b);
      expect(complement(b)).toBe(a);
    }
    expect(seen.size).toBe(12);
  });
});

describe("scoreGenetics", () => {
  it("scores an empty genome at 0", () => {
    expect(scoreGenetics(emptyGenome())).toBe(0);
  });

  it("rewards a broadly-developed genome over a one-sided grinder", () => {
    // One-sided: huge on three genes, nothing on their opposites. This is what
    // a lonely grinder or an inbred line looks like.
    const oneSided = genomeFrom({ knowledge: 200, tech: 180, craft: 160 });
    // Broadly developed: both sides of several pairs filled in (what crossing
    // distant gene pools produces). Same total magnitude.
    const developed = genomeFrom({
      knowledge: 90, vitality: 90, tech: 90, heart: 90, craft: 90, mayhem: 90,
    });
    expect(scoreGenetics(developed)).toBeGreaterThan(scoreGenetics(oneSided));
  });

  it("rewards more magnitude up to saturation", () => {
    const small = genomeFrom({ knowledge: 30 });
    const big = genomeFrom({ knowledge: 120 });
    expect(scoreGenetics(big)).toBeGreaterThan(scoreGenetics(small));
  });
});

describe("blend rewards complementary parents (the central balance claim)", () => {
  it("a child of opposites beats a child of similars", () => {
    // Complementary: one parent all A-side genes, the other all B-side genes.
    const aSide = genomeFrom({ knowledge: 120, tech: 120, craft: 120, pulse: 120, inner: 120, earth: 120 });
    const bSide = genomeFrom({ vitality: 120, heart: 120, mayhem: 120, lore: 120, social: 120, fiction: 120 });
    const complementaryChild = blend(aSide, bSide);

    // Similar: two parents that look almost the same.
    const sim1 = genomeFrom({ knowledge: 120, tech: 120, craft: 120 });
    const sim2 = genomeFrom({ knowledge: 115, tech: 125, craft: 118 });
    const similarChild = blend(sim1, sim2);

    expect(scoreGenetics(complementaryChild)).toBeGreaterThan(
      scoreGenetics(similarChild),
    );
  });

  it("complementarity is high for opposites and low for twins", () => {
    const a = genomeFrom({ knowledge: 100, tech: 100 });
    const opposite = genomeFrom({ vitality: 100, heart: 100 });
    const twin = genomeFrom({ knowledge: 100, tech: 100 });
    expect(complementarity(a, opposite)).toBeGreaterThan(
      complementarity(a, twin),
    );
  });
});

describe("hunger decay", () => {
  it("increases monotonically with time and saturates at 100", () => {
    const c = hatch({ id: "c1", ownerId: "u1", name: "Pix", homeSub: "test", diet: ["tech"], now: NOW });
    const h0 = currentHunger(c, NOW);
    const h1 = currentHunger(c, NOW + 3_600_000); // +1h
    const h2 = currentHunger(c, NOW + 7_200_000); // +2h
    expect(h1).toBeCloseTo(h0 + HUNGER_PER_HOUR, 5);
    expect(h2).toBeGreaterThan(h1);
    expect(currentHunger(c, NOW + 1000 * 3_600_000)).toBe(100);
  });
});

describe("feeding", () => {
  it("adds gene points, restores hunger, and grows xp", () => {
    let c = hatch({ id: "c1", ownerId: "u1", name: "Pix", homeSub: "test", diet: ["tech"], now: NOW });
    const before = c.genome.knowledge;
    c = feed(c, "knowledge", "create", NOW + 1000);
    expect(c.genome.knowledge).toBe(before + 15);
    expect(c.xp).toBeGreaterThan(20);
    expect(c.hunger).toBeLessThanOrEqual(20);
  });

  it("extends the streak the next day and resets it after a gap", () => {
    let c = hatch({ id: "c1", ownerId: "u1", name: "Pix", homeSub: "test", diet: ["tech"], now: NOW });
    expect(c.streak).toBe(1);
    c = feed(c, "tech", "read", NOW + 24 * 3_600_000); // next day
    expect(c.streak).toBe(2);
    c = feed(c, "tech", "read", NOW + 24 * 3_600_000 + 5 * 24 * 3_600_000); // big gap
    expect(c.streak).toBe(1);
  });
});

describe("stage thresholds", () => {
  it("walks egg -> blob -> child -> adult by xp", () => {
    expect(stage(0)).toBe("egg");
    expect(stage(50)).toBe("blob");
    expect(stage(200)).toBe("child");
    expect(stage(500)).toBe("adult");
  });
});

function adult(id: string, genome: Record<string, number>, generation = 1): Creature {
  return {
    id, ownerId: "u", name: id, homeSub: "test",
    genome: genomeFrom(genome), generation, xp: 500, hunger: 10,
    lastFed: NOW, matedUntil: 0, streak: 1, born: NOW, parents: null,
  };
}

describe("mating economy", () => {
  it("offspring generation is max(parents)+1", () => {
    const a = adult("a", { knowledge: 100 }, 5);
    const b = adult("b", { vitality: 100 }, 1);
    const { offspring } = mate(a, b, "u", "kid", "Kid", NOW);
    expect(offspring.generation).toBe(6);
  });

  it("both parents take the hunger hit and a cooldown", () => {
    const a = adult("a", { knowledge: 100 }, 2);
    const b = adult("b", { vitality: 100 }, 2);
    const { parentA, parentB } = mate(a, b, "u", "kid", "Kid", NOW);
    expect(parentA.matedUntil).toBeGreaterThan(NOW);
    expect(parentB.matedUntil).toBeGreaterThan(NOW);
    expect(parentA.hunger).toBeGreaterThan(a.hunger);
  });

  it("assigns the single offspring to the negotiated owner", () => {
    const a = adult("a", { knowledge: 100 }, 1);
    const b = adult("b", { vitality: 100 }, 1);
    const { offspring } = mate(a, b, "winner", "kid", "Kid", NOW);
    expect(offspring.ownerId).toBe("winner");
    expect(offspring.parents).toEqual(["a", "b"]);
  });
});

describe("lineageScore rewards depth and breadth", () => {
  it("a deeper generation is worth more than a shallow one", () => {
    expect(generationWeight(3)).toBeGreaterThan(generationWeight(1));
  });

  it("more viable offspring raises the score", () => {
    const base = adult("a", { knowledge: 120, vitality: 120 });
    const child1: Creature = { ...adult("c1", { knowledge: 120, vitality: 120 }, 2), parents: ["a", "x"] };
    const child2: Creature = { ...adult("c2", { tech: 120, heart: 120 }, 2), parents: ["a", "y"] };
    const oneKid = lineageScore([base, child1]);
    const twoKids = lineageScore([base, child1, child2]);
    expect(twoKids).toBeGreaterThan(oneKid);
  });
});
