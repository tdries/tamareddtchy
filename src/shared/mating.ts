// The mating request lifecycle. A mate is not instant: it is proposed, accepted,
// then gestates for real time, and only then resolves to success or failure.
// Success is probabilistic and driven by how complementary the two genomes are:
// perfect opposites almost always succeed, and the further from a perfect
// opposite gene pool, the lower the odds, so a poor match becomes a frequency
// game. Pure functions; time and the random roll are always passed in so this is
// fully testable in Node.

import { type Genome, complementarity } from "./genome.js";

export type MateStatus =
  | "pending" // proposed, waiting on the other user to accept
  | "incubating" // accepted, gestation timer running
  | "hatched" // succeeded, offspring created
  | "failed" // gestation finished but the roll failed, no offspring
  | "declined"; // the other user said no

export interface MateRequest {
  id: string;
  fromUserId: string; // proposer
  fromCreatureId: string;
  toUserId: string; // partner being asked
  toCreatureId: string;
  ownerOnSuccess: string; // negotiated: who keeps the single offspring
  tradeNote: string; // free-text deal terms (social enforcement)
  status: MateStatus;
  successChance: number; // 0..1, fixed at acceptance from complementarity
  createdAt: number;
  acceptedAt: number | null;
  readyAt: number | null; // when gestation completes
  resolvedAt: number | null;
}

// Real gestation. This is a full game, not a demo: a mate takes hours, which is
// the return-visit hook. You propose, you come back later to see if it took.
export const GESTATION_MS = 6 * 60 * 60 * 1000; // 6 hours

// Map complementarity (0..1) to a success probability. Perfect opposites are
// near-certain; similar pairs drop off steeply so bad matches need many tries.
// floor keeps even a poor match barely possible (the frequency game), ceiling
// keeps even a perfect match honest.
export function successChance(a: Genome, b: Genome): number {
  const comp = complementarity(a, b); // 0..1, high = good opposites
  // Curve: square it so the middle sags, then clamp into [0.08, 0.97].
  const raw = Math.pow(comp, 1.6);
  return Math.max(0.08, Math.min(0.97, raw));
}

// Create a pending request. Probability is computed now but only locked in at
// acceptance (the partner could grow between propose and accept).
export function propose(
  id: string,
  fromUserId: string,
  fromCreatureId: string,
  toUserId: string,
  toCreatureId: string,
  ownerOnSuccess: string,
  tradeNote: string,
  now: number,
): MateRequest {
  return {
    id,
    fromUserId,
    fromCreatureId,
    toUserId,
    toCreatureId,
    ownerOnSuccess,
    tradeNote,
    status: "pending",
    successChance: 0,
    createdAt: now,
    acceptedAt: null,
    readyAt: null,
    resolvedAt: null,
  };
}

// The partner accepts. Locks the success chance from the two live genomes and
// starts the gestation clock.
export function accept(
  req: MateRequest,
  fromGenome: Genome,
  toGenome: Genome,
  now: number,
): MateRequest {
  return {
    ...req,
    status: "incubating",
    successChance: successChance(fromGenome, toGenome),
    acceptedAt: now,
    readyAt: now + GESTATION_MS,
  };
}

export function decline(req: MateRequest): MateRequest {
  return { ...req, status: "declined" };
}

export function isReady(req: MateRequest, now: number): boolean {
  return req.status === "incubating" && req.readyAt !== null && now >= req.readyAt;
}

// Fraction of gestation elapsed, 0..1, for a progress bar.
export function gestationProgress(req: MateRequest, now: number): number {
  if (req.status !== "incubating" || req.acceptedAt === null || req.readyAt === null) {
    return req.status === "hatched" || req.status === "failed" ? 1 : 0;
  }
  const span = req.readyAt - req.acceptedAt;
  return Math.max(0, Math.min(1, (now - req.acceptedAt) / span));
}

// Resolve a ready request. `roll` is a 0..1 value the caller supplies (server
// rng, or a fixed value in tests). Succeeds when the roll lands under the
// locked-in success chance.
export function resolve(
  req: MateRequest,
  roll: number,
  now: number,
): { req: MateRequest; success: boolean } {
  const success = roll < req.successChance;
  return {
    req: { ...req, status: success ? "hatched" : "failed", resolvedAt: now },
    success,
  };
}
