// Client API. On Devvit, these hit the server endpoints. Standalone (npm run
// dev, screenshots, judges without a Reddit login), they fall back to an
// in-memory mock seeded with a few rival creatures so every screen has content.
// Same shapes either way, so the UI never knows the difference.

import {
  type Gene,
  type Genome,
  complementarity,
  dominantGenes,
} from "../shared/genome.js";
import {
  type Creature,
  type FeedKind,
  hatch,
  feed as feedPure,
  mate as matePure,
  currentHunger,
  mood as moodPure,
  canMate,
  lineageScore,
} from "../shared/creature.js";

export interface MateCard {
  creature: Creature;
  ownerName: string;
  seeking: Gene; // the complement it wants
}

const ON_DEVVIT = typeof window !== "undefined" && /devvit|reddit/.test(window.location.hostname);

function now() {
  return Date.now();
}

// ----------------------------- mock backend -------------------------------
// A tiny in-memory world so the standalone build is fully playable.

const ME = "u_me";
const MY_NAME = "you";

function seedRivals(): Creature[] {
  const mk = (id: string, name: string, diet: Gene[], gen: number, xp = 500): Creature => {
    let c = hatch({ id, ownerId: id, name, homeSub: "tamareddtchy", diet, now: now() - 86_400_000 });
    c = { ...c, xp, generation: gen };
    return c;
  };
  return [
    mk("u_athena", "Athena", ["knowledge", "knowledge", "lore", "craft"], 3),
    mk("u_brawn", "Brawn", ["vitality", "vitality", "social", "pulse"], 2),
    mk("u_jester", "Jester", ["mayhem", "mayhem", "fiction", "heart"], 4),
    mk("u_sage", "Sage", ["inner", "earth", "knowledge", "lore"], 2),
    mk("u_spark", "Spark", ["tech", "tech", "pulse", "mayhem"], 1),
  ];
}

const mock = {
  creatures: new Map<string, Creature>(),
  mine: [] as string[],
  seeded: false,
};

function ensureSeed() {
  if (mock.seeded) return;
  for (const r of seedRivals()) mock.creatures.set(r.id, r);
  mock.seeded = true;
}

// --------------------------------- API ------------------------------------

export interface State {
  me: { id: string; name: string };
  creatures: Creature[]; // the player's own creatures
  active: Creature | null;
  onboarded: boolean;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

// Seed the player with a ready-made creature. Used by ?demo=1 so the screenshot
// pipeline and a cold judge landing can reach every screen without clicking
// through onboarding first.
export function seedDemoPlayer() {
  ensureSeed();
  if (mock.mine.length) return;
  const t = now();
  let c = hatch({
    id: "mine_1",
    ownerId: ME,
    name: "Pixel",
    homeSub: "tamareddtchy",
    diet: ["knowledge", "tech", "lore", "earth"],
    now: t,
  });
  // A grown, Gen-2 adult, recently fed, with a developed genome so the 3D body
  // is interesting and the needs panel reads "thriving".
  c = {
    ...c,
    generation: 2,
    xp: 520,
    streak: 6,
    hunger: 22,
    lastFed: t,
    genome: {
      ...c.genome,
      knowledge: 140, vitality: 60, tech: 120, heart: 40,
      craft: 90, mayhem: 35, pulse: 30, lore: 95, inner: 80, social: 25,
      earth: 110, fiction: 30,
    },
  };
  mock.creatures.set(c.id, c);
  mock.mine.push(c.id);
}

export async function loadState(): Promise<State> {
  if (ON_DEVVIT) return post<State>("/api/state", {});
  ensureSeed();
  const mine = mock.mine.map((id) => mock.creatures.get(id)!).filter(Boolean);
  return {
    me: { id: ME, name: MY_NAME },
    creatures: mine,
    active: mine[0] ?? null,
    onboarded: mine.length > 0,
  };
}

export async function hatchCreature(name: string, diet: Gene[]): Promise<Creature> {
  if (ON_DEVVIT) return post<Creature>("/api/hatch", { name, diet });
  ensureSeed();
  const c = hatch({
    id: `mine_${mock.mine.length + 1}`,
    ownerId: ME,
    name,
    homeSub: "tamareddtchy",
    diet,
    now: now(),
  });
  mock.creatures.set(c.id, c);
  mock.mine.push(c.id);
  return c;
}

export async function feed(creatureId: string, gene: Gene, kind: FeedKind): Promise<Creature> {
  if (ON_DEVVIT) return post<Creature>("/api/feed", { creatureId, gene, kind });
  const c = mock.creatures.get(creatureId)!;
  const updated = feedPure(c, gene, kind, now());
  mock.creatures.set(creatureId, updated);
  return updated;
}

export async function mateMarket(myGenome: Creature): Promise<MateCard[]> {
  if (ON_DEVVIT) return post<MateCard[]>("/api/mate/market", { creatureId: myGenome.id });
  ensureSeed();
  // Rank rivals by how complementary they are to me, best first.
  const rivals = [...mock.creatures.values()].filter((c) => c.ownerId !== ME);
  return rivals
    .map((c) => ({
      creature: c,
      ownerName: c.name,
      seeking: dominant(c.genome),
      score: complementarity(myGenome.genome, c.genome),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ creature, ownerName, seeking }) => ({ creature, ownerName, seeking }));
}

export async function proposeMate(
  myId: string,
  partnerId: string,
  owner: "me" | "partner",
  childName: string,
): Promise<Creature> {
  if (ON_DEVVIT) return post<Creature>("/api/mate/propose", { myId, partnerId, owner, childName });
  // In the mock the partner always accepts (it is a demo) and the deal resolves.
  const a = mock.creatures.get(myId)!;
  const b = mock.creatures.get(partnerId)!;
  const ownerId = owner === "me" ? ME : b.ownerId;
  const { offspring, parentA } = matePure(a, b, ownerId, `mine_${mock.mine.length + 1}`, childName, now());
  mock.creatures.set(parentA.id, parentA);
  if (ownerId === ME) {
    mock.creatures.set(offspring.id, offspring);
    mock.mine.push(offspring.id);
  }
  return offspring;
}

export async function leaderboard(): Promise<{ name: string; score: number }[]> {
  if (ON_DEVVIT) return post<{ name: string; score: number }[]>("/api/leaderboard", {});
  ensureSeed();
  const byOwner = new Map<string, Creature[]>();
  for (const c of mock.creatures.values()) {
    const list = byOwner.get(c.ownerId) ?? [];
    list.push(c);
    byOwner.set(c.ownerId, list);
  }
  const rows = [...byOwner.entries()].map(([owner, cs]) => ({
    name: owner === ME ? "you" : cs[0].name,
    score: lineageScore(cs),
  }));
  return rows.sort((a, b) => b.score - a.score);
}

// re-exports so the UI does not import the shared layer twice
export { currentHunger, moodPure as mood, canMate };

function dominant(g: Genome): Gene {
  return dominantGenes(g)[0];
}
