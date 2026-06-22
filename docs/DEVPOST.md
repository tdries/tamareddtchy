# Devpost submission copy: Tamareddtchy

Paste-ready copy for the Reddit's Games with a Hook submission. No em dashes anywhere.

## Tagline (under 200 chars)

A virtual pet whose body is a living 3D readout of your Reddit personality. To raise a champion, you have to find a redditor who is your opposite and breed your creatures together.

## About the project (Project Story)

### Inspiration

We kept noticing the same thing about Reddit games: they explode on launch day and they are dead by the weekend. The post gets played once and scrolled past. Nothing pulls you back, and nothing connects you to anyone else playing. So we asked a different question. What if the game was a creature you got attached to, the kind you cannot help checking on, and what if the only way to win forced you out of your own corner of Reddit? Tamagotchi was the obvious skeleton. The twist came from biology class: good genetics come from crossing distant gene pools. On Reddit, your distant gene pool is the person whose interests are nothing like yours.

### What it does

Tamareddtchy is a Tamagotchi for your Reddit identity. You hatch a small 3D creature, and from that moment its body is a pure function of what you do on Reddit. Read science and it grows a domed brain-head. Live in r/fitness and it gets athletic legs. Spend your time in r/funny and its torso turns into a lumpy, chaotic blob. The creature is never stored as a picture. It is rebuilt in 3D, every frame, from twelve numbers.

The numbers are twelve genes arranged as six opposite pairs (Knowledge vs Vitality, Tech vs Heart, Craft vs Mayhem, and so on). Good genetics does not mean grinding one gene. It means developing both sides of many pairs, which you can only reach by breeding with someone unlike you. So the endgame is a mate market: the app ranks every other creature in the subreddit by how complementary it is to yours. Mate with your opposite and you get a strong, well developed child. Mate with someone too similar and you get a hilarious, busted, inbred mess that everyone screenshots.

Breeding is a deal, not a merge. Two players' creatures produce exactly one offspring, and the players negotiate who keeps it and what gets traded. The child's generation is one higher than its best parent, so pairing with an advanced creature pulls your lineage forward, which gives the higher generation player real leverage in the deal. You climb a generation ladder, and higher generations visibly mutate further from the plain starter blob, so prestige is something you can see.

### How we built it

It is one Devvit Web app, published as a single Interactive Post. The client is a web view: HTML, CSS, and TypeScript, with the creatures rendered in Three.js. The server is Devvit's server runtime over Redis and the Reddit API.

The core decision was to make the creature procedural. There are no 3D model files. The geometry is grown from the genome at runtime: each body slot is a blobby mesh whose shape comes from one gene pair's balance and whose size comes from that pair's magnitude. That keeps the payload tiny, makes every genome a genuinely different body, and keeps the promise that your body literally is your Reddit self.

The other decision was to put all the game rules (the genome, the genetics scoring, the breeding blend, the lineage score) in one shared module that the client, the server, and the unit tests all import. The rules can never drift between what you see and what the server enforces, and we could test the whole game balance in plain Node with no browser and no Reddit.

We also built an in-memory mock of the backend so the entire game is playable locally with zero Reddit auth. That made development fast and means a judge can clone the repo and play every screen in one command.

### Challenges we ran into

The hardest problem was the genetics math, and it was a real bug, not a tuning knob. Our first scoring function accidentally rewarded being lopsided within a pair, which is the exact opposite of the design. A creature that crossed gene pools scored the same as one that grinded a single interest. We caught it because the unit test that asserts "a child of opposites beats a child of similars" failed by one point. We reworked the score to reward pair development (both sides filled in), and the central mechanic held. The lesson: the most important rule in the game deserved the test that almost did not pass.

The second challenge was making real 3D look alive inside a constrained web view on both desktop and mobile. We leaned on procedural geometry plus a light idle animation loop (breathing, blinking, bobbing, drooping when hungry) so the creature feels alive without any heavy assets to download.

### Accomplishments that we're proud of

The mate market screen sells the whole idea in one glance: five creatures, five completely different procedurally generated bodies, ranked by how well they complement you. We are proud that "your body is your genome" is not a slogan we bolted a picture onto. It is literally how the renderer works. And we are proud that the hook is honest: the game makes leaving your bubble the optimal move, instead of just saying community is nice.

### What we learned

We learned that the strongest hook is a mechanic, not a feature. We did not add a "share" button and hope. We made the artifact (the creature) so personal and so visibly tied to other people that posting it is the natural thing to do, and finding your opposite is the only way to win. We also re-learned that a small, finished, polished thing beats a sprawling half-built one, especially when the judging prizes launch-ready quality.

### What's next for Tamareddtchy

Cross subreddit rivalry is the big one. Because the app installs in any subreddit, a creature can carry its home sub's house genes, so r/science creatures skew Knowledge and r/funny skew Mayhem, and the best offspring come from cross community mating. That turns the game into a reason for whole subreddits to play against and with each other. After that: structured escrow for the trade terms (today they are social), seasonal rare genomes, and a creature-of-the-day spotlight that auto-posts the rarest lineage each day.

## Built With

typescript, three.js, devvit, devvit-web, reddit-api, redis, express, vite, vitest, webgl, html, css, procedural-generation, node.js

## Try it out

- GitHub repo: https://github.com/tdries/tamareddtchy
- Demo video: https://youtu.be/YOUTUBE_ID  (record and replace)
- App listing on developer.reddit.com: (add after `devvit upload` and approval)
- Demo subreddit post: (add the public post link judges play)

## Submission category / track

Reddit's Games with a Hook. Primary fit: Best App with a Hook, Best Use of Retention Mechanics, and Best Use of User Contributions. The creature is a return-visit machine, hunger and streaks drive daily retention, and every milestone is user generated content that posts itself.

## Team members

Tim Dries (tdries)
