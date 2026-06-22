// Devvit Web server. These endpoints back the client when the app runs on
// Reddit. All game logic is reused from src/shared (the exact same code the
// client and the unit tests run), so the rules can never drift between client
// and server. State lives in Devvit's Redis; identity and posting come from the
// Reddit API.
//
// This module imports @devvit/web/server, which is provided by the Devvit
// runtime at `devvit upload` time. It is intentionally not a local dependency:
// the standalone client (npm run dev) never loads this file, it uses the
// in-memory mock in src/client/api.ts instead.

import express from "express";
import {
  createServer,
  context,
  getServerPort,
  redis,
  reddit,
} from "@devvit/web/server";

import { type Gene } from "../shared/genome.js";
import {
  type Creature,
  type FeedKind,
  hatch,
  feed,
  mate,
  lineageScore,
  canMate,
} from "../shared/creature.js";

const app = express();
app.use(express.json());

// --------------------------------- storage --------------------------------
// One JSON blob per creature, plus a per-user set of owned ids and a per-sub
// leaderboard sorted set. Small and flat, exactly the shape Redis is good at.

const kCreature = (id: string) => `creature:${id}`;
const kUserCreatures = (userId: string) => `user:${userId}:creatures`;
const kBoard = (sub: string) => `board:${sub}`;
const kMates = (sub: string) => `mates:${sub}`;

async function getCreature(id: string): Promise<Creature | null> {
  const raw = await redis.get(kCreature(id));
  return raw ? (JSON.parse(raw) as Creature) : null;
}

async function putCreature(c: Creature): Promise<void> {
  await redis.set(kCreature(c.id), JSON.stringify(c));
}

async function ownedCreatures(userId: string): Promise<Creature[]> {
  const ids = await redis.zRange(kUserCreatures(userId), 0, -1);
  const out: Creature[] = [];
  for (const { member } of ids) {
    const c = await getCreature(member);
    if (c) out.push(c);
  }
  return out;
}

async function recomputeBoard(userId: string, sub: string, name: string) {
  const mine = await ownedCreatures(userId);
  await redis.zAdd(kBoard(sub), { member: name, score: lineageScore(mine) });
}

// ---------------------------------- helpers --------------------------------

async function whoAmI(): Promise<{ id: string; name: string }> {
  const username = await reddit.getCurrentUsername();
  const id = context.userId ?? `anon`;
  return { id, name: username ?? "redditor" };
}

function now() {
  return Date.now();
}

// Post a creature milestone image back to the subreddit. The client renders the
// creature to a PNG data URL and sends it here; we post it as an image. Every
// hatch, evolution, and birth farms its own marketing this way.
async function postMilestone(title: string, dataUrl: string) {
  const sub = context.subredditName;
  if (!sub) return;
  await reddit.submitPost({
    subredditName: sub,
    title,
    // Devvit accepts a media data URL for image posts.
    kind: "image",
    url: dataUrl,
  } as never);
}

// ---------------------------------- routes ---------------------------------

app.post("/api/state", async (_req, res) => {
  const me = await whoAmI();
  const creatures = await ownedCreatures(me.id);
  res.json({
    me,
    creatures,
    active: creatures[0] ?? null,
    onboarded: creatures.length > 0,
  });
});

app.post("/api/hatch", async (req, res) => {
  const me = await whoAmI();
  const { name, diet } = req.body as { name: string; diet: Gene[] };
  const sub = context.subredditName ?? "tamareddtchy";
  const c = hatch({
    id: `c_${me.id}_${now()}`,
    ownerId: me.id,
    name,
    homeSub: sub,
    diet,
    now: now(),
  });
  await putCreature(c);
  await redis.zAdd(kUserCreatures(me.id), { member: c.id, score: c.born });
  await recomputeBoard(me.id, sub, me.name);
  res.json(c);
});

app.post("/api/feed", async (req, res) => {
  const me = await whoAmI();
  const { creatureId, gene, kind } = req.body as {
    creatureId: string;
    gene: Gene;
    kind: FeedKind;
  };
  const c = await getCreature(creatureId);
  if (!c || c.ownerId !== me.id) return res.status(404).json({ error: "no creature" });
  const updated = feed(c, gene, kind, now());
  await putCreature(updated);
  await recomputeBoard(me.id, updated.homeSub, me.name);
  res.json(updated);
});

app.post("/api/mate/market", async (req, res) => {
  const me = await whoAmI();
  const { creatureId } = req.body as { creatureId: string };
  const mine = await getCreature(creatureId);
  const sub = context.subredditName ?? "tamareddtchy";
  if (!mine) return res.status(404).json({ error: "no creature" });
  // Open courtship cards posted by other players in this sub.
  const ids = await redis.zRange(kMates(sub), 0, -1);
  const cards = [];
  for (const { member } of ids) {
    const c = await getCreature(member);
    if (c && c.ownerId !== me.id) {
      cards.push({ creature: c, ownerName: c.name, seeking: c.genome });
    }
  }
  res.json(cards);
});

app.post("/api/mate/propose", async (req, res) => {
  const me = await whoAmI();
  const { myId, partnerId, owner, childName } = req.body as {
    myId: string;
    partnerId: string;
    owner: "me" | "partner";
    childName: string;
  };
  const a = await getCreature(myId);
  const b = await getCreature(partnerId);
  if (!a || !b) return res.status(404).json({ error: "missing parent" });
  if (!canMate(a, now()) || !canMate(b, now())) {
    return res.status(409).json({ error: "a parent is not ready (adult + off cooldown)" });
  }
  const ownerId = owner === "me" ? me.id : b.ownerId;
  const { offspring, parentA, parentB } = mate(
    a,
    b,
    ownerId,
    `c_${ownerId}_${now()}`,
    childName,
    now(),
  );
  await putCreature(parentA);
  await putCreature(parentB);
  await putCreature(offspring);
  await redis.zAdd(kUserCreatures(ownerId), { member: offspring.id, score: offspring.born });
  await recomputeBoard(me.id, offspring.homeSub, me.name);
  res.json(offspring);
});

app.post("/api/leaderboard", async (_req, res) => {
  const sub = context.subredditName ?? "tamareddtchy";
  const rows = await redis.zRange(kBoard(sub), 0, 19, { reverse: true, by: "score" });
  res.json(rows.map((r) => ({ name: r.member, score: Math.round(r.score) })));
});

// Post a rendered milestone image (called by the client after a hatch/evolve/birth).
app.post("/api/post", async (req, res) => {
  const { title, dataUrl } = req.body as { title: string; dataUrl: string };
  await postMilestone(title, dataUrl);
  res.json({ ok: true });
});

// The menu action ("Create a Tamareddtchy nursery") creates the interactive post.
app.post("/internal/menu/create-post", async (_req, res) => {
  const sub = context.subredditName;
  const post = await reddit.submitPost({
    subredditName: sub!,
    title: "Tamareddtchy: raise a creature that looks like your Reddit soul",
    // The web view post type defined in devvit.json.
    splash: { appDisplayName: "Tamareddtchy" },
  } as never);
  res.json({ navigateTo: post });
});

const server = createServer(app);
server.listen(getServerPort());
