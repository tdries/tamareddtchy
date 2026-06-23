// Gallery: render any of the 20 base animals as a Gen-1 creature with the REAL
// sculpted renderer (same CreatureScene the game uses), so we can capture the
// current look per animal. ?animal=Fox. Dev-only.
import { CreatureScene } from "./scene.js";
import { ANIMALS } from "./animals.js";
import { preloadParts } from "./parts.js";
import { emptyGenome, type Genome, type Gene } from "../shared/genome.js";

const name = new URL(location.href).searchParams.get("animal") ?? "Fox";
const form = ANIMALS.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? ANIMALS[0];
document.getElementById("label")!.textContent = form.name;

// A distinct gene mix per animal (by name hash) so colors vary across the set.
const GENES: Gene[] = ["knowledge", "vitality", "tech", "heart", "craft", "mayhem", "pulse", "lore", "inner", "social", "earth", "fiction"];
let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
const genome: Genome = { ...emptyGenome() };
for (let i = 0; i < 4; i++) {
  const g = GENES[(h + i * 5) % GENES.length];
  genome[g] = 160 - i * 30;
}

const scene = new CreatureScene(document.getElementById("stage")!);
function show() { scene.setCreature(genome, 1, 520, form, name); }
show();
// re-render once sculpted parts load (gallery shows the real GLB look)
preloadParts().then(show);
