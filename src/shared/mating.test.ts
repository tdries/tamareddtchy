import { describe, it, expect } from "vitest";
import { emptyGenome } from "./genome.js";
import {
  successChance,
  propose,
  accept,
  decline,
  resolve,
  isReady,
  gestationProgress,
  GESTATION_MS,
} from "./mating.js";

const NOW = 1_700_000_000_000;
const g = (parts: Record<string, number>) => ({ ...emptyGenome(), ...parts });

// Perfect opposites: one all A-side, the other all B-side.
const aSide = g({ knowledge: 120, tech: 120, craft: 120, pulse: 120, inner: 120, earth: 120 });
const bSide = g({ vitality: 120, heart: 120, mayhem: 120, lore: 120, social: 120, fiction: 120 });
const twin = g({ knowledge: 120, tech: 120, craft: 120, pulse: 120, inner: 120, earth: 120 });

describe("successChance", () => {
  it("is high for perfect opposites and low for twins", () => {
    expect(successChance(aSide, bSide)).toBeGreaterThan(successChance(aSide, twin));
  });

  it("stays within [0.08, 0.97] so nothing is guaranteed or impossible", () => {
    expect(successChance(aSide, bSide)).toBeLessThanOrEqual(0.97);
    expect(successChance(aSide, twin)).toBeGreaterThanOrEqual(0.08);
  });
});

describe("request lifecycle", () => {
  it("proposes pending, accepts into incubating with a gestation deadline", () => {
    let req = propose("r1", "u1", "c1", "u2", "c2", "u1", "you take the kid", NOW);
    expect(req.status).toBe("pending");
    req = accept(req, aSide, bSide, NOW);
    expect(req.status).toBe("incubating");
    expect(req.readyAt).toBe(NOW + GESTATION_MS);
    expect(req.successChance).toBeGreaterThan(0);
  });

  it("is not ready until the gestation timer elapses", () => {
    let req = accept(propose("r", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, bSide, NOW);
    expect(isReady(req, NOW + 1000)).toBe(false);
    expect(isReady(req, NOW + GESTATION_MS)).toBe(true);
  });

  it("reports gestation progress 0..1", () => {
    const req = accept(propose("r", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, bSide, NOW);
    expect(gestationProgress(req, NOW)).toBeCloseTo(0, 2);
    expect(gestationProgress(req, NOW + GESTATION_MS / 2)).toBeCloseTo(0.5, 1);
    expect(gestationProgress(req, NOW + GESTATION_MS)).toBeCloseTo(1, 2);
  });

  it("can be declined", () => {
    const req = decline(propose("r", "u1", "c1", "u2", "c2", "u1", "", NOW));
    expect(req.status).toBe("declined");
  });
});

describe("resolve is a probability roll", () => {
  it("succeeds when the roll lands under the success chance", () => {
    const req = accept(propose("r", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, bSide, NOW);
    const lucky = resolve(req, 0.01, NOW + GESTATION_MS);
    expect(lucky.success).toBe(true);
    expect(lucky.req.status).toBe("hatched");
  });

  it("fails when the roll exceeds the success chance", () => {
    // Twins: low chance. A high roll should fail.
    const req = accept(propose("r", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, twin, NOW);
    const unlucky = resolve(req, 0.99, NOW + GESTATION_MS);
    expect(unlucky.success).toBe(false);
    expect(unlucky.req.status).toBe("failed");
  });

  it("frequency game: opposites succeed far more often than twins over many rolls", () => {
    const oppReq = accept(propose("o", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, bSide, NOW);
    const twinReq = accept(propose("t", "u1", "c1", "u2", "c2", "u1", "", NOW), aSide, twin, NOW);
    let oppWins = 0, twinWins = 0;
    for (let i = 0; i < 100; i++) {
      const roll = i / 100; // even spread of rolls
      if (resolve(oppReq, roll, NOW).success) oppWins++;
      if (resolve(twinReq, roll, NOW).success) twinWins++;
    }
    expect(oppWins).toBeGreaterThan(twinWins);
    expect(twinWins).toBeGreaterThan(0); // still possible, just rarer
  });
});
