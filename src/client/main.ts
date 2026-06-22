// UI controller. Four tabs (Nursery, Genome, Mate Market, Lineage Board) plus a
// first-run onboarding diet picker. Tab routing reads ?tab= so the screenshot
// pipeline and deep links work; otherwise it is plain state. The 3D creature is
// driven by CreatureScene; everything else is light DOM.

import "./style.css";
import { CreatureScene } from "./scene.js";
import {
  GENES,
  PAIRS,
  GENE_INFO,
  dominantGenes,
  scoreGenetics,
  pairBalance,
  type Gene,
} from "../shared/genome.js";
import { type FeedKind, stage } from "../shared/creature.js";
import * as api from "./api.js";

const view = document.getElementById("view")!;
const tabsEl = document.getElementById("tabs")!;
const GENE_HUE = (g: Gene) => `var(--g-${g})`;

let state: api.State;
let nurseryScene: CreatureScene | null = null;
const miniScenes: CreatureScene[] = [];

type Tab = "nursery" | "genome" | "mate" | "board";

function currentTab(): Tab {
  const url = new URL(window.location.href);
  const t = (url.searchParams.get("tab") as Tab) || "nursery";
  return (["nursery", "genome", "mate", "board"] as Tab[]).includes(t) ? t : "nursery";
}

function disposeScenes() {
  nurseryScene?.dispose();
  nurseryScene = null;
  while (miniScenes.length) miniScenes.pop()!.dispose();
}

function toast(msg: string) {
  let el = document.querySelector(".toast") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el!.classList.remove("show"), 2200);
}

async function render() {
  disposeScenes();
  // ?demo=1 lands straight in a populated game (screenshots, cold judge landing).
  if (new URL(window.location.href).searchParams.get("demo")) api.seedDemoPlayer();
  state = await api.loadState();

  if (!state.onboarded) return renderOnboarding();

  const tab = currentTab();
  for (const b of tabsEl.querySelectorAll("button")) {
    b.classList.toggle("active", (b as HTMLElement).dataset.tab === tab);
  }
  if (tab === "nursery") return renderNursery();
  if (tab === "genome") return renderGenome();
  if (tab === "mate") return renderMate();
  if (tab === "board") return renderBoard();
}

// --------------------------------- onboarding ------------------------------
function renderOnboarding() {
  const picked = new Set<Gene>();
  view.innerHTML = `
    <section class="screen onboard">
      <p class="eyebrow">Hatch your creature</p>
      <h1 class="title">What do you actually do on Reddit?</h1>
      <p class="sub">Pick the corners you live in. Your creature is born looking like you, then grows with what you read, post, and upvote.</p>
      <input class="name-input" id="cname" placeholder="name your creature" maxlength="16" value="Pixel" />
      <div class="diet-grid">
        ${GENES.map((g) => `
          <button class="diet" data-g="${g}">
            <div class="g"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${GENE_HUE(g)}"></span>${GENE_INFO[g].label}</div>
            <div class="subs">r/${GENE_INFO[g].subs[0]} r/${GENE_INFO[g].subs[1]}</div>
          </button>`).join("")}
      </div>
      <button class="btn" id="hatch">Hatch it</button>
    </section>`;

  view.querySelectorAll<HTMLElement>(".diet").forEach((el) => {
    el.addEventListener("click", () => {
      const g = el.dataset.g as Gene;
      if (picked.has(g)) { picked.delete(g); el.classList.remove("on"); }
      else { picked.add(g); el.classList.add("on"); }
    });
  });
  view.querySelector("#hatch")!.addEventListener("click", async () => {
    const name = (view.querySelector("#cname") as HTMLInputElement).value.trim() || "Pixel";
    const diet = picked.size ? [...picked] : (["tech", "mayhem"] as Gene[]);
    await api.hatchCreature(name, diet);
    toast("It hatched.");
    render();
  });
}

// ---------------------------------- nursery --------------------------------
function renderNursery() {
  const c = state.active!;
  const now = Date.now();
  const hunger = Math.round(api.currentHunger(c, now));
  const fed = 100 - hunger;
  const mood = api.mood(c, now);
  const st = stage(c.xp);
  const xpInStage = Math.min(100, Math.round((c.xp / 400) * 100));
  const dom = dominantGenes(c.genome).slice(0, 5);

  view.innerHTML = `
    <section class="screen">
      <p class="eyebrow">Nursery</p>
      <h1 class="title">${c.name}</h1>
      <p class="sub">A Gen-${c.generation} ${st}. Drag to spin it. Feed it with Reddit activity.</p>
      <div class="nursery">
        <div class="dish" id="dish">
          <span class="stage-tag">${st.toUpperCase()}</span>
          <span class="gen-tag">GEN ${c.generation}</span>
          <div class="hint">drag to rotate</div>
        </div>
        <div class="panel">
          <span class="mood-chip mood-${mood}">${mood === "happy" ? "thriving" : mood === "ok" ? "peckish" : "neglected"}</span>
          <div class="needs">
            <div class="need-row">
              <div class="label"><span>Fed</span><span>${fed}%</span></div>
              <div class="bar fed"><span style="width:${fed}%"></span></div>
            </div>
            <div class="need-row">
              <div class="label"><span>Growth to next stage</span><span>${xpInStage}%</span></div>
              <div class="bar xp"><span style="width:${xpInStage}%"></span></div>
            </div>
            <div class="need-row">
              <div class="label"><span>Daily streak</span><span>${c.streak} day${c.streak === 1 ? "" : "s"}</span></div>
            </div>
          </div>
          <p class="feed-title">Feed it (this is how the genome grows)</p>
          <div class="feed-grid" id="feed">
            <button class="feed-btn" data-kind="read">Read a post<small>small gene boost</small></button>
            <button class="feed-btn" data-kind="engage">Comment / upvote<small>medium boost</small></button>
            <button class="feed-btn" data-kind="create">Make a post<small>big boost</small></button>
            <button class="feed-btn" data-kind="engage" data-cross="1">Visit an opposite sub<small>balances a pair</small></button>
          </div>
          <p class="feed-title">Dominant genes</p>
          <div class="chips">
            ${dom.map((g) => `<span class="chip"><span class="dot" style="background:${GENE_HUE(g)}"></span>${GENE_INFO[g].label}<span class="val">${c.genome[g]}</span></span>`).join("")}
          </div>
        </div>
      </div>
    </section>`;

  nurseryScene = new CreatureScene(document.getElementById("dish")!);
  nurseryScene.setCreature(c.genome, c.generation, c.xp);
  nurseryScene.setMood(mood);

  view.querySelectorAll<HTMLElement>(".feed-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.kind as FeedKind;
      // "Read"/"engage"/"create" feed the dominant gene; "opposite sub" feeds the
      // complement of the weakest-developed pair, which is the path to good genetics.
      let gene: Gene;
      if (btn.dataset.cross) {
        const balances = pairBalance(c.genome);
        let worst = 0, worstAbs = -1;
        balances.forEach((b, i) => { if (Math.abs(b) > worstAbs) { worstAbs = Math.abs(b); worst = i; } });
        const [a, b] = PAIRS[worst];
        gene = c.genome[a] < c.genome[b] ? a : b; // feed the lagging side
      } else {
        gene = dominantGenes(c.genome)[0];
      }
      state.active = await api.feed(c.id, gene, kind);
      nurseryScene?.poke();
      toast(`+${kind === "create" ? 15 : kind === "engage" ? 7 : 3} ${GENE_INFO[gene].label}`);
      setTimeout(() => renderNursery(), 350);
    });
  });
}

// ---------------------------------- genome ---------------------------------
function renderGenome() {
  const c = state.active!;
  const score = scoreGenetics(c.genome);
  const balances = pairBalance(c.genome);

  view.innerHTML = `
    <section class="screen">
      <p class="eyebrow">Genome card</p>
      <h1 class="title">${c.name}'s build</h1>
      <p class="sub">Good genetics means both sides of many pairs are developed. That only comes from crossing distant gene pools.</p>
      <div style="display:flex;gap:26px;align-items:center;margin-bottom:22px;flex-wrap:wrap">
        <div class="score-big">${score}<small>/100 genetics</small></div>
        <div class="chips">
          ${dominantGenes(c.genome).slice(0, 4).map((g) => `<span class="chip"><span class="dot" style="background:${GENE_HUE(g)}"></span>${GENE_INFO[g].label}<span class="val">${c.genome[g]}</span></span>`).join("")}
        </div>
      </div>
      <div class="pairs">
        ${PAIRS.map(([a, b], i) => {
          const bal = balances[i]; // + favors a
          const aPct = bal >= 0 ? 50 + bal * 50 : 50 + bal * 50;
          return `
          <div class="pair">
            <div class="pair-head"><span style="color:${GENE_HUE(a)}">${GENE_INFO[a].label} ${c.genome[a]}</span><span style="color:${GENE_HUE(b)}">${c.genome[b]} ${GENE_INFO[b].label}</span></div>
            <div class="scale">
              <span class="a" style="width:${Math.max(0, aPct)}%;background:${GENE_HUE(a)}"></span>
              <span class="b" style="width:${Math.max(0, 100 - aPct)}%;background:${GENE_HUE(b)}"></span>
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>`;
}

// --------------------------------- mate market -----------------------------
async function renderMate() {
  const c = state.active!;
  view.innerHTML = `
    <section class="screen">
      <p class="eyebrow">Mate market</p>
      <h1 class="title">Find your opposite</h1>
      <p class="sub">Ranked by how complementary they are to ${c.name}. Opposites make strong offspring; twins make a busted, inbred mess. The offspring is one creature, and you negotiate who keeps it.</p>
      <div class="mate-grid" id="mates"></div>
    </section>`;

  const cards = await api.mateMarket(c);
  const grid = view.querySelector("#mates")!;
  cards.forEach((card, idx) => {
    // First cards are the most complementary (api ranks them); fade the fit down.
    const fit = Math.max(0.12, 0.92 - idx * 0.18);
    const fitPct = Math.round(fit * 100);
    const good = idx < 2;
    const el = document.createElement("div");
    el.className = "mate-card";
    el.innerHTML = `
      <div class="viz"></div>
      <div class="body">
        <div class="who">${card.ownerName} <span style="color:var(--ink-3);font-size:13px">Gen-${card.creature.generation}</span></div>
        <div class="match-meter ${good ? "" : "fit-low"}">match for you: <b>${good ? "strong" : "weak"}</b> (${fitPct}%)</div>
        <div class="chips">${dominantGenes(card.creature.genome).slice(0, 3).map((g) => `<span class="chip"><span class="dot" style="background:${GENE_HUE(g)}"></span>${GENE_INFO[g].label}</span>`).join("")}</div>
        <button class="btn" data-id="${card.creature.id}">Propose (you keep the kid)</button>
      </div>`;
    grid.appendChild(el);
    const viz = el.querySelector(".viz") as HTMLElement;
    const s = new CreatureScene(viz);
    s.setCreature(card.creature.genome, card.creature.generation, card.creature.xp);
    miniScenes.push(s);
    el.querySelector("button")!.addEventListener("click", async () => {
      const kid = await api.proposeMate(c.id, card.creature.id, "me", `${c.name} Jr`);
      const q = scoreGenetics(kid.genome);
      toast(q >= 45 ? `Healthy Gen-${kid.generation}! genetics ${q}` : `Oof. inbred Gen-${kid.generation}, genetics ${q}`);
    });
  });
}

// --------------------------------- lineage board ---------------------------
async function renderBoard() {
  const rows = await api.leaderboard();
  view.innerHTML = `
    <section class="screen">
      <p class="eyebrow">Lineage board</p>
      <h1 class="title">r/tamareddtchy rankings</h1>
      <p class="sub">Lineage score blends generation depth, genetics quality, and how many viable offspring you have raised. Three ways to climb, no single dominant strategy.</p>
      <div class="board">
        ${rows.map((r, i) => `
          <div class="row ${r.name === "you" ? "me" : ""}">
            <div class="rank">${i + 1}</div>
            <div class="name">${r.name}${r.name === "you" ? " (you)" : ""}</div>
            <div class="score">${r.score}</div>
          </div>`).join("")}
      </div>
    </section>`;
}

// ----------------------------------- wiring --------------------------------
tabsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const tab = btn.dataset.tab as Tab;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  history.replaceState(null, "", url);
  render();
});

render();
