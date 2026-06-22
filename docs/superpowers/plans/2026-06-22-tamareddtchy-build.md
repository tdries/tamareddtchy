# Tamareddtchy: Implementation Plan

Build order. Each step leaves something runnable. Pure logic first (testable in Node), then render, then UI, then the Devvit server seam.

## 1. Project scaffold
- `package.json` (Vite client build + vitest), `tsconfig.json`, `.gitignore`, `vite.config.ts`.
- `devvit.json` describing the app: post entry, server entry, menu action to create a post.
- Dirs: `src/shared` (pure logic), `src/client` (Three.js + UI), `src/server` (Devvit handlers), `docs/`.

## 2. Pure game logic (`src/shared`) + tests
- `genome.ts`: GENES (12), PAIRS (6), `emptyGenome`, `scoreGenetics`, `dominantGenes`, `complement`, `blend(a,b)`, `lineageScore`, hunger `decay`.
- `creature.ts`: types, `hatch(seed)`, `feed(creature, category, kind)`, growth `stage(xp)`, `canMate`, `mate(a,b,ownerId)` returning offspring with generation = max+1, cooldown.
- `genome.test.ts`: balance+magnitude scoring, complementary blend beats similar blend, generation math, lineageScore rewards depth+breadth, decay monotonic.

## 3. Procedural 3D render (`src/client/render.ts`)
- Three.js scene: lights, camera, turntable + drag.
- `buildCreature(genome, generation, xp, hunger)` -> THREE.Group. 6 slots, each a blobby mesh whose variant = pair balance, size = pair magnitude. Palette from top-2 genes. Generation deviates geometry from baseline. Stage scales rig.
- Idle animation: breathe, blink, bob; droop when hungry; bounce on feed.
- `render.test.ts`: deterministic structure, all slots present, generation deviation (uses three in node, asserts group structure not pixels).

## 4. Client UI (`src/client`)
- `index.html`, `main.ts`, `style.css`. Screens: onboarding (pick diet), nursery (the creature + needs + feed buttons), genome card, mating market, leaderboard.
- Talks to server via small fetch helpers; falls back to an in-memory mock store when not on Devvit, so it runs standalone (`npm run dev`) for the demo and screenshots.

## 5. Devvit server (`src/server`)
- `index.ts`: HTTP endpoints (`/api/creature`, `/api/feed`, `/api/mate/...`, `/api/leaderboard`) using `@devvit/web/server` Redis + Reddit. Reuses `src/shared` for all logic.
- Milestone auto-post helper (hatch / evolve / birth) builds an image post.
- `main.tsx` post + menu wiring per devvit.json.

## 6. Docs + submission (later phases)
- README (4 required sections + screenshots + demo embed), screenshots, deck, manual, Devpost copy.

## Risk notes
- Devvit CLI + Reddit login are Tim-owned credential steps; build + test + standalone demo do not need them. The app is structured so `devvit upload` / `devvit playtest` is the only gap to a live post.
- Three.js is the one heavy dep; everything else is stdlib / Vite / vitest.
