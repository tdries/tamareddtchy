// The genome is the whole game. Everything visual and every score derives from
// these 12 numbers. Pure functions only: no Reddit, no DOM, no Three.js here so
// this file runs and tests in plain Node.

export const GENES = [
  "knowledge",
  "vitality",
  "tech",
  "heart",
  "craft",
  "mayhem",
  "pulse",
  "lore",
  "inner",
  "social",
  "earth",
  "fiction",
] as const;

export type Gene = (typeof GENES)[number];
export type Genome = Record<Gene, number>;

// Six complementary opposite-pairs. The left gene's opposite is the right gene.
// This is the spine of the design: it drives the body slots and it defines what
// "opposite gene pool" means for mating.
export const PAIRS: ReadonlyArray<readonly [Gene, Gene]> = [
  ["knowledge", "vitality"],
  ["tech", "heart"],
  ["craft", "mayhem"],
  ["pulse", "lore"],
  ["inner", "social"],
  ["earth", "fiction"],
] as const;

// Human-facing labels and the real subreddits each gene stands for. Used by the
// onboarding diet picker and the genome card.
export const GENE_INFO: Record<
  Gene,
  { label: string; blurb: string; subs: string[] }
> = {
  knowledge: { label: "Knowledge", blurb: "the mind", subs: ["science", "askscience", "todayilearned"] },
  vitality: { label: "Vitality", blurb: "the body", subs: ["fitness", "food", "outdoors"] },
  tech: { label: "Tech", blurb: "the logic", subs: ["programming", "technology", "gaming"] },
  heart: { label: "Heart", blurb: "the feeling", subs: ["relationships", "aww", "MadeMeSmile"] },
  craft: { label: "Craft", blurb: "the order", subs: ["DIY", "art", "woodworking"] },
  mayhem: { label: "Mayhem", blurb: "the chaos", subs: ["funny", "memes", "chaosgaming"] },
  pulse: { label: "Pulse", blurb: "the now", subs: ["news", "sports", "worldnews"] },
  lore: { label: "Lore", blurb: "the forever", subs: ["history", "books", "mythology"] },
  inner: { label: "Inner", blurb: "the self", subs: ["meditation", "GetMotivated", "journaling"] },
  social: { label: "Social", blurb: "the world", subs: ["AskReddit", "politics", "community"] },
  earth: { label: "Earth", blurb: "the real", subs: ["NatureIsCool", "space", "EarthPorn"] },
  fiction: { label: "Fiction", blurb: "the dream", subs: ["movies", "scifi", "fantasy"] },
};

export function emptyGenome(): Genome {
  return Object.fromEntries(GENES.map((g) => [g, 0])) as Genome;
}

export function totalMagnitude(g: Genome): number {
  return GENES.reduce((sum, gene) => sum + g[gene], 0);
}

// Genes sorted strongest first. The top entries are the creature's identity.
export function dominantGenes(g: Genome): Gene[] {
  return [...GENES].sort((a, b) => g[b] - g[a]);
}

// The opposite of a gene, per the pair table.
export function complement(gene: Gene): Gene {
  for (const [a, b] of PAIRS) {
    if (a === gene) return b;
    if (b === gene) return a;
  }
  return gene; // unreachable: every gene is in exactly one pair
}

// Within each pair, how lopsided is it (0 = perfectly balanced, 1 = all one side).
// Returned per pair as a signed ratio in [-1, 1]: positive favors the A gene.
export function pairBalance(g: Genome): number[] {
  return PAIRS.map(([a, b]) => {
    const sum = g[a] + g[b];
    if (sum === 0) return 0;
    return (g[a] - g[b]) / sum;
  });
}

// How "developed" each pair is: the strength of its weaker side. A pair with
// both genes high is fully developed; a pair leaning hard on one gene (or empty)
// is not. This is the heart of "good genetics from crossing pools": a creature
// strong on BOTH sides of many pairs is the prize, and that only comes from
// breeding complementary parents. Per pair, normalized 0..1.
export function pairDevelopment(g: Genome): number[] {
  return PAIRS.map(([a, b]) => {
    const weaker = Math.min(g[a], g[b]);
    // Saturate so a modest both-sides pair already counts; ~60 each = full.
    return Math.min(1, weaker / 60);
  });
}

// Good genetics = strong (high magnitude) AND broadly developed across the pairs
// (both sides of many pairs filled in, which is what crossing distant gene pools
// produces). A blank creature scores 0; a one-note grinder scores low on
// development; a big, broadly-crossed genome scores high. Range roughly 0..100.
export function scoreGenetics(g: Genome): number {
  const mag = totalMagnitude(g);
  if (mag === 0) return 0;
  // Magnitude term saturates so you cannot win by grinding one number forever.
  const magTerm = Math.min(1, mag / 600); // ~50 avg per gene caps it
  // Development: average across the six pairs of how filled-in both sides are.
  const dev = pairDevelopment(g);
  const devTerm = dev.reduce((s, x) => s + x, 0) / dev.length;
  return Math.round((0.4 * magTerm + 0.6 * devTerm) * 100);
}

// Offspring genome from two parents.
//
// The key idea: a creature passes on its genetic SIGNATURE (which genes dominate,
// as a proportion of itself), not its raw size. A small creature that is purely
// Vitality is "100% Vitality" and passes that on just as strongly as a huge
// creature passes its dominant gene. So we mix the two parents' NORMALIZED
// profiles in equal measure, then scale the result up to a child magnitude. This
// is what makes a real mix: blend a Knowledge giant with a tiny Vitality rival
// and the child is genuinely Knowledge AND Vitality, not just a shrunk giant.
//
// Averaging raw values (the old approach) let the bigger parent dominate the
// child's shape entirely whenever the parents differed in size, which made every
// preview look like the larger parent.
export function blend(a: Genome, b: Genome): Genome {
  const magA = totalMagnitude(a) || 1;
  const magB = totalMagnitude(b) || 1;

  // Each parent contributes its profile (gene / own total), weighted equally.
  // Genes where the two profiles diverge get a hybrid-vigor boost, so crossing
  // distant gene pools yields a broadly-developed child (the design's payoff).
  const child = emptyGenome();
  let raw = 0;
  for (const gene of GENES) {
    const pa = a[gene] / magA; // a's share of itself on this gene
    const pb = b[gene] / magB; // b's share of itself on this gene
    const mixed = (pa + pb) / 2;
    const hybridVigor = Math.abs(pa - pb) * 0.5; // reward divergence between profiles
    child[gene] = mixed + hybridVigor;
    raw += child[gene];
  }

  // Scale the mixed profile up to a child magnitude: the average of the parents'
  // sizes, so a child is roughly as substantial as its parents rather than tiny.
  const targetMag = (magA + magB) / 2;
  const scale = raw > 0 ? targetMag / raw : 0;
  for (const gene of GENES) child[gene] = Math.round(child[gene] * scale);
  return child;
}

// How complementary are two genomes, 0..1. High when each one's strong genes are
// the other's weak genes. This is what the matchmaker ranks partners by.
export function complementarity(a: Genome, b: Genome): number {
  const da = dominantGenes(a).slice(0, 3);
  const magA = totalMagnitude(a) || 1;
  const magB = totalMagnitude(b) || 1;
  let score = 0;
  for (const gene of da) {
    const opp = complement(gene);
    // reward: my top gene is strong, partner is strong on its opposite
    score += (a[gene] / magA) * (b[opp] / magB);
  }
  return Math.min(1, score * 6); // scaled into a friendly 0..1 range
}
