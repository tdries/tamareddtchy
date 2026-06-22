# Tamareddtchy: Design Spec

Date: 2026-06-22
Hackathon: Reddit's Games with a Hook (Devvit Web). Event period June 17 to July 15, 2026.
Status: approved, ready for implementation plan.

## One line

A virtual pet whose body is a living 3D readout of your Reddit personality, and whose only path to "good genetics" is mating with a redditor whose interests are the opposite of yours.

## The hook

Tamagotchi nostalgia plus Reddit identity plus genetics. You raise a creature. The creature looks like how you spend your Reddit life. To win you must find someone unlike you, because in biology good genetics come from crossing distant gene pools. The game turns "find your opposite" into the win condition, and it turns the subreddit into the dating market.

It hits all four scoring categories of the hackathon:

- Best Hook: daily need-loop plus "did my creature evolve, did my mate request get answered".
- Retention Mechanics: hunger decay, streaks, daily creature-of-the-day, mating that needs a return visit to resolve.
- User Contributions: every milestone emits a shareable image post; the creature is the content.
- Reddit-y: the game mechanic literally is upvoting, commenting, and cross-community rivalry.

## The genome (core data model)

The creature is a pure function of a 12-gene genome. The genome is the only persisted creature state. Anatomy, palette, and growth stage are all derived, never stored.

The 12 genes are arranged as 6 complementary opposite-pairs. The pairs are the spine of the whole design: they drive the body, and they define what "opposite gene pool" means for mating.

| Gene pair | Gene A | Gene B | Example subreddits |
|---|---|---|---|
| Mind vs Body | Knowledge | Vitality | science, askscience, todayilearned / fitness, food, outdoors |
| Logic vs Feeling | Tech | Heart | programming, technology, gaming / relationships, aww, MadeMeSmile |
| Order vs Chaos | Craft | Mayhem | DIY, art, woodworking / funny, memes, chaosgaming |
| Now vs Forever | Pulse | Lore | news, sports, worldnews / history, books, mythology |
| Self vs World | Inner | Social | meditation, GetMotivated, journaling / AskReddit, politics, community |
| Real vs Dream | Earth | Fiction | NatureIsCool, space, EarthPorn / movies, scifi, fantasy |

A user owns many creatures, not one. Each creature is its own record.

Persisted creature state, the entire shape:

```
id:         string       // creature id
genome:     { knowledge, vitality, tech, heart, craft, mayhem,
              pulse, lore, inner, social, earth, fiction }  // 12 non-negative ints
generation: int          // 1 for a hatched starter; max(parents)+1 when bred
xp:         int          // total nurture, drives growth stage
hunger:     int          // 0..100, decays with real time, Tamagotchi need-loop
lastFed:    number       // epoch ms, used to compute decay lazily on read
matedUntil: number       // epoch ms; creature cannot mate again until then (cooldown)
streak:     int          // consecutive days with at least one feed
name:       string
ownerId:    string       // reddit user id (t2_...)
homeSub:    string       // subreddit the creature was born in
born:       number       // epoch ms
parents:    [string,string] | null   // parent creature ids if bred
```

There is no stored body. `render(genome, generation, xp, hunger) -> sceneGraph` is pure and lives client-side. `generation` is a render input: higher generations deviate further from the baseline blob (more mutation, ornamentation, extra geometry), so lineage depth is visible at a glance. `scoreGenetics(genome) -> number` is pure and shared client and server.

## Anatomy is a deterministic 3D render of the genome

Procedural Three.js. No model files. Each of the 6 body slots is owned by exactly one gene-pair. The pair's balance (which side dominates) picks the shape variant; the pair's total magnitude picks size and prominence. Cute blobby Tamagotchi art direction: soft rounded organic blobs built from blended spheres / metaball-style unions, big eyes, bright candy palette, bouncy.

| Body slot | Driven by pair | A-dominant | B-dominant | Balanced |
|---|---|---|---|---|
| Head | Knowledge / Vitality | big domed brain-head, glasses | sleek athletic head, headband | proportioned |
| Eyes / face | Tech / Heart | visor / pixel eyes | big warm doe eyes | two-tone |
| Body / torso | Craft / Mayhem | tidy geometric shell | lumpy asymmetric blob | patchwork |
| Arms | Pulse / Lore | antenna / device arms | scroll / quill arms | mixed |
| Legs | Inner / Social | single rooted lotus base | many little running legs | standard pair |
| Accessory / aura | Earth / Fiction | leaf / star aura | wizard hat / cape | faint aura |

Whole-genome derivations:

- Palette: the two highest genes blend into the material colors and emissive.
- Stage: total xp picks egg, blob, child, adult. Stage scales the whole rig and unlocks geometry detail.
- Generation: a separate prestige axis from stage. Each generation pushes the geometry further from the default (stronger deformation, extra appendages, richer aura). A Gen-1 reads as a plain blob; a Gen-5 reads as a dramatically mutated, ornate creature. Prestige is visible without reading a number.

"Alive": a render loop with idle breathing (scale pulse), blinking, gentle bob. Reacts to feeding (bounce) and hunger (droop, dimmed palette). Auto-rotate turntable plus drag-to-rotate. Runs inside the Devvit web view on desktop and mobile, so geometry stays low-poly and there is no asset download beyond the JS bundle.

## Activity to genes

Reddit does not hand a Devvit app a user's full cross-Reddit history, so the genome grows from two honest, demoable sources, with a clean onboarding seed.

1. In-app actions (always real). READ a category-tagged feed item, CREATE a post, or ENGAGE (comment / vote) inside the app, and points flow into that category's gene. READ is small, ENGAGE medium, CREATE large. This is the Tamagotchi feeding action.
2. Self-declared diet (instant onboarding). On first run the player picks the categories they actually frequent. That seeds the genome so the creature looks like them from minute one instead of starting blank.

ponytail: deliberately not scraping a user's global Reddit history. It is not reliably exposed to a Devvit app and faking it would be dishonest in the demo. The two sources above are real and sufficient. Upgrade path: if Reddit exposes richer per-user signals later, add a third feed source without touching the genome shape.

## The need-loop

`hunger` decays with real time, computed lazily from `lastFed` on every read (no background writes needed). Feeding (any in-app activity) restores hunger and adds gene points and xp. Neglect makes the creature visibly droop and stalls growth. One feed per day extends `streak`. Streak and hunger are the daily retention pressure.

## Mating, the economy and the killer hook

Each creature has a dominant gene profile (its top genes). Good genetics means high total magnitude and high pair-balance, scored so that a child of complementary parents beats a child of similar parents.

Mating is a deal between two users, not a symmetric merge. Exactly one offspring is produced and exactly one user owns it. Who owns it, and what is traded for it, is negotiated, and that negotiation is the core strategy layer.

### Cost of mating (the climb tradeoff)

A creature that mates takes a large hunger hit and enters a multi-day cooldown (`matedUntil`) before it can mate again. No new currency. Climbing the generation ladder therefore costs real nurture time: to reach a high generation you must repeatedly raise creatures back up and wait out cooldowns. This is the tradeoff that makes "should I mate this creature now" a real decision.

### The deal (who gets the kid)

Courtship is public, not a private DM. Wanting to mate drops a "seeking complement" card into the subreddit: "this Gen-3 Knowledge-dominant creature seeks a Vitality-dominant partner." The comment section becomes the dating market.

A mate proposal is a deal with explicit terms:
- which two creatures pair,
- who receives the single offspring,
- optional trade terms in plain text ("you take the kid, I keep first pick on the next one" or "kid is mine, I owe you a Gen-2").

The other user accepts, declines, or counters. On accept, one offspring is created and assigned to the agreed owner. ponytail: trade terms are recorded as free text on the deal, not auto-enforced game state. Enforcement is social, the way real Reddit deals already work. Upgrade path: structured escrow if it ever needs teeth.

### Generation dynamics (asymmetric pairings)

- Offspring `generation` = max(parentA.generation, parentB.generation) + 1. So pairing up costs the lower-gen partner little and pulls the lineage forward.
- Gen-1 x Gen-1 produces a Gen-2 with a plain-ish body: low risk, low prestige, a starter move.
- Gen-3 x Gen-3 produces a Gen-4 with strong deviation: both partners invested heavily, high prestige, and both will want the kid, so the deal is hard-fought.
- Gen-5 x Gen-1: the offspring is Gen-6 and inherits advanced-generation traits the Gen-1 holder could never reach alone. The Gen-5 holder is contributing the scarce, expensive side of the cross, so the default deal favors them: they have the leverage to claim the kid or demand a steep trade. The Gen-1 holder pays up because they are buying access to an advanced lineage. This asymmetry is intended and is where the trading game lives.

### Genetics quality

On accept, offspring genome is a blend that rewards opposition. `scoreGenetics` of the child is high when parents were complementary, low (visibly busted, comedic "ugly baby") when parents were too similar. Inbreeding is allowed and funny, not blocked.

The offspring is a brand-new creature rendered by the same function, and its birth auto-posts to the subreddit.

## Win condition and leaderboard

Success is a lineage score, blending three axes so no single-track strategy dominates:

```
lineageScore(user) = sum over the user's creatures of
    geneticsQuality(creature) * generationWeight(creature.generation)
  + offspringBonus * (number of viable offspring the user has produced)
```

- Climbing deep (high generation) is rewarded by `generationWeight`.
- Breeding wide (many viable offspring) is rewarded by `offspringBonus`.
- Inbred / low-quality creatures contribute little via `geneticsQuality`.

Leaderboard ranks users by `lineageScore` per subreddit. The headline goal a player chases: own a deep, high-quality lineage and a healthy brood, which forces both the daily nurture loop and the cross-community mating hunt.

## Virality: every action farms its own marketing

Unifying principle: every meaningful action emits a shareable image post back into the subreddit. Two reused primitives only: render-creature-to-image and post-image-to-subreddit.

1. Self-posting milestones. Hatching, evolving to adult, and birth announcements auto-generate an image post.
2. Public courtship cards (above): mating drama lives in the comments.
3. Genome card. A shareable "what's your build" image of the 12 genes, the Spotify-Wrapped reflex, identity-flavored so Reddit argues about it.
4. Subreddit-vs-subreddit. The game installs in any subreddit; a creature carries the home sub's house genes (r/science skews Knowledge, r/funny skews Mayhem). Cross-subreddit mating gives the best genetics, creating inter-community rivalry and a reason for whole subreddits to play against each other. This is the scale hook that makes it a Reddit sensation rather than a generic pet game.
5. Ugly-baby comedy engine. Inbreeding produces hilarious busted offspring. Failure is shareable, not just punishing.
6. Daily creature-of-the-day / rarest-genome spotlight, auto-posted, manufacturing a daily return reason and a screenshot-bait leaderboard.

## Architecture

Devvit Web app, one Reddit app installed as an Interactive Post.

- Client (`src/client`): Three.js renderer plus UI, served into the Devvit web view. Pure modules:
  - `genome.ts`: gene constants, the 6 pairs, `scoreGenetics`, `blend(parentA, parentB)`, `lineageScore`.
  - `render.ts`: `buildCreature(genome, generation, xp, hunger)` returns a Three.js group; pure given inputs.
  - `card.ts`: render genome card / creature snapshot to a data URL for posting.
- Server (Devvit handlers): feed activity events, lazy hunger decay, matchmaking (find complementary players), propose / counter / accept mate deals, resolve mating with owner assignment and cooldown, write milestone posts.
- State: Redis (Devvit KV). Keys: `creature:{creatureId}` (record), `user:{userId}:creatures` (set of owned creature ids), `mates:open:{sub}` (open courtship cards), `deal:{dealId}` (proposed terms: pair, owner, trade text, status), `leaderboard:{sub}` (sorted set by lineageScore), `cotd:{sub}:{date}`.
- No external database, no model-file assets, one heavy dependency (Three.js).

Component isolation: `genome.ts`, `render.ts`, `card.ts` are pure and unit-testable in Node without a browser or Reddit. Server handlers depend on them plus the Devvit Redis/Reddit APIs. The web view depends only on the client modules and the server's JSON endpoints.

## Testing

- `genome.test.ts`: `scoreGenetics` rewards magnitude + balance; `blend` of complementary parents scores higher than blend of similar parents (the central game-balance claim); offspring `generation` is max(parents)+1; `lineageScore` rewards both deeper generations and more offspring; decay math is monotonic.
- `render.test.ts`: `buildCreature` is deterministic for given inputs, produces all 6 slots, selects the expected variant at pair extremes, and a higher `generation` deviates further from baseline than a lower one (smoke-level, asserting structure not pixels).
- No browser, no network, no Reddit in tests. Pure functions only.

## Style

No em dashes or en dashes anywhere (code, UI copy, posts, docs). Inherited project rule.

## Out of scope (YAGNI)

- Scraping global Reddit history (not exposed; dishonest to fake).
- Real-time multiplayer. Mating is asynchronous (propose, return later to resolve), which fits Reddit and the retention hook.
- Auto-enforced trade escrow. Deal terms are recorded as free text; enforcement is social. Structured escrow is a noted upgrade path, not v1.
- A backing SQL database. Redis KV is enough for this state shape.
