# Tamareddtchy Living World: design + A-Life roadmap

Date: 2026-06-23

## Goal

A 3D space where a subreddit's creatures coexist, wander, interact, and breed.
Behavior should feel emergent, not scripted. The long-term target is the
Creatures (1996) architecture the brief describes: genome -> internal chemistry
-> neural controller -> learning, with drives and reproduction. We build that in
phases so each phase ships and the early ones seed the later ones.

## How Creatures (1996) actually did it (reference)

Steve Grand's Norns ran a per-tick loop of three coupled subsystems, exactly the
brief's architecture:
- Genome: a string of "genes" (in CAOS) specifying biochemistry, brain wiring,
  receptors/emitters, instincts, appearance. Mutated + recombined on breeding.
- Biochemistry: ~256 chemical concentrations updated each tick by reactions
  (A+B -> C at a rate), emitters (a body/world condition raises a chemical), and
  receptors (a chemical drives an organ or a brain input). Half-life decay on
  every chemical. Drives (hunger, fear, ...) are chemicals surfaced via receptors.
- Brain: lobes of neurons with dendrites; a perception lobe, a concept/decision
  lobe, reinforcement via reward/punishment chemicals strengthening recently
  active dendrites (eligibility trace). Actions chosen winner-take-all.
The key property: nobody scripts "if hungry, eat." Hunger is a chemical, eating
lowers it, reinforcement wires the association, behavior emerges.

## Phasing

### Phase 1 (this pass): lightweight emergent world  -- SHIPS NOW
A real 3D arena with multiple creatures driven by a small drive + steering sim
that is structured as a SEED of the full chemistry, not a throwaway:
- Each agent has a tiny "internal state" vector {hunger, social, energy} that
  decays/grows over time (this is the chemistry, minimal).
- Drives create pressure: high hunger -> seek food; high social -> approach
  another creature; low social -> wander. (This is the receptor->action path,
  minimal, hand-wired for now where the full system would learn it.)
- Steering: seek/wander/separate (Reynolds-style) turns drive into motion.
- Breeding: two adults that meet with low hunger + high social mood mate on
  contact, producing offspring via the existing blend() (genome) + blendForms().
- The arena is the subreddit's population: the player's creatures + rivals.
  Visitors from other subs can be dropped in to mate (cross-community hook).
Deterministic where it can be (no Math.random; seeded), so it is testable.

### Phase 2 (later): real biochemistry
Replace the 3-var state with a concentration vector + reactions + emitters +
receptors + half-life decay, genome-parameterized. Drives become chemicals.

### Phase 3 (later): neural controller + learning
A small lobed network: perception -> association (AND of conditions) -> decision
(winner-take-all) with reinforcement (eligibility trace + reward/punishment),
genome-wired. Behavior becomes learned, not hand-wired.

### Phase 4 (later): full lifecycle
Aging stages, hormones gating reproduction, compartments/organs with failure,
pathogen/immune chemistry, death conditions.

## Architecture (phase 1)

- `src/shared/world.ts` (pure, tested): the agent + sim. Types: `Agent`
  (creature + position + velocity + internal state + mood). Functions:
  `stepWorld(agents, food, dt, now) -> events` advances drives, steering,
  collisions, and emits `bred`/`ate` events. No THREE, no DOM: runs in Node
  tests. This is the seed of the chemistry+controller; keeping it pure means
  phases 2-3 slot in here without touching rendering.
- `src/client/worldScene.ts`: a Three.js arena (ground plane, soft sky, food
  pickups) that renders an Agent list by reusing buildCreature per creature,
  and drives positions from the sim each frame. Camera orbits the arena.
- Client UI: a "World" tab showing the living arena, with a readout of what is
  happening (who is seeking, who bred).

## Devvit feasibility (the "mind-boggling 3D world" question)

Hard ceiling: the world renders in a Devvit web view (an iframe) on desktop AND
mobile. So:
- Keep it to ~6-12 visible creatures at once (each is a few hundred polys);
  cull/LOD if a sub has more. Procedural geometry keeps payload tiny.
- One shared ground + sky + a few props, instanced. No heavy textures.
- The sim is cheap (drives + steering over a dozen agents). It is the rendering
  that bounds us, not the simulation, which is exactly why the deeper A-Life
  phases are feasible later: chemistry/brains are CPU-cheap at this agent count.
- "Mind-boggling" comes from emergence + identity (every creature unique, real
  relationships forming), not from graphics horsepower we do not have in the
  iframe. Lean into that.

## Out of scope (phase 1)

- Real cross-subreddit networking (Phase 1 drops in rivals locally; the server
  population sync is a later wiring task).
- The neural net and real chemistry (phases 2-3).
- Pathogens/immune/organs (phase 4).

## Style

No em dashes. Inherited project rule.
