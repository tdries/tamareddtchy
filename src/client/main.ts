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
  blend,
  type Gene,
} from "../shared/genome.js";
import { type FeedKind, stage } from "../shared/creature.js";
import * as mating from "../shared/mating.js";
import * as api from "./api.js";

const view = document.getElementById("view")!;
const tabsEl = document.getElementById("tabs")!;
const GENE_HUE = (g: Gene) => `var(--g-${g})`;

let state: api.State;
let nurseryScene: CreatureScene | null = null;
const miniScenes: CreatureScene[] = [];
let trioScenes: CreatureScene[] = []; // parents + child preview in incubating rows
let requestPoll: number | null = null;

type Tab = "nursery" | "mate" | "board";

function currentTab(): Tab {
  const url = new URL(window.location.href);
  let t = url.searchParams.get("tab") as Tab;
  // Genome merged into the nursery; keep old ?tab=genome links working.
  if ((t as string) === "genome") t = "nursery";
  return (["nursery", "mate", "board"] as Tab[]).includes(t) ? t : "nursery";
}

function disposeScenes() {
  nurseryScene?.dispose();
  nurseryScene = null;
  while (miniScenes.length) miniScenes.pop()!.dispose();
  disposeTrioScenes();
  if (requestPoll) { clearTimeout(requestPoll); requestPoll = null; }
}

// The incubating-row 3D scenes are rebuilt on every poll tick, so dispose the
// previous batch each time to avoid leaking WebGL contexts.
function disposeTrioScenes() {
  while (trioScenes.length) trioScenes.pop()!.dispose();
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
      ${genomeCardHTML(c)}
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

// ---------------------------------- genome card ----------------------------
// Now embedded inside the nursery (no separate tab). Returns markup so the
// nursery can append it below the live creature.
function genomeCardHTML(c: import("../shared/creature.js").Creature): string {
  const score = scoreGenetics(c.genome);
  const balances = pairBalance(c.genome);
  return `
    <div class="genome-card">
      <div class="genome-head">
        <div>
          <p class="eyebrow">Genome card</p>
          <h2 class="section-h" style="margin:2px 0 0">${c.name}'s build, shareable</h2>
        </div>
        <div class="score-big">${score}<small>/100</small></div>
      </div>
      <p class="sub" style="margin:6px 0 14px">Good genetics means both sides of many pairs are developed. That only comes from crossing distant gene pools.</p>
      <div class="pairs">
        ${PAIRS.map(([a, b], i) => {
          const aPct = 50 + balances[i] * 50;
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
    </div>`;
}

// --------------------------------- mate market -----------------------------
async function renderMate() {
  const c = state.active!;
  view.innerHTML = `
    <section class="screen">
      <p class="eyebrow">Mate market</p>
      <h1 class="title">Find your opposite</h1>
      <p class="sub">The closer to a perfect opposite gene pool, the higher the odds a mating takes. A poor match can still work, it just becomes a numbers game. Mating costs a cooldown whether it succeeds or not.</p>
      <div id="requests"></div>
      <h2 class="section-h">Candidates</h2>
      <div class="mate-grid" id="mates"></div>
    </section>`;

  renderRequests();

  const cards = await api.mateMarket(c);
  const grid = view.querySelector("#mates")!;
  cards.forEach((card) => {
    const pct = Math.round(card.successChance * 100);
    const tier = pct >= 60 ? "fit-high" : pct >= 30 ? "fit-mid" : "fit-low";
    const word = pct >= 60 ? "strong" : pct >= 30 ? "risky" : "long shot";
    const el = document.createElement("div");
    el.className = "mate-card";
    el.innerHTML = `
      <div class="viz"></div>
      <div class="body">
        <div class="who">${card.ownerName} <span style="color:var(--ink-3);font-size:13px">Gen-${card.creature.generation}</span></div>
        <div class="odds ${tier}"><span class="odds-bar"><span style="width:${pct}%"></span></span><span class="odds-num">${pct}%</span></div>
        <div class="match-meter ${tier}">success chance: <b>${word}</b></div>
        <div class="chips">${dominantGenes(card.creature.genome).slice(0, 3).map((g) => `<span class="chip"><span class="dot" style="background:${GENE_HUE(g)}"></span>${GENE_INFO[g].label}</span>`).join("")}</div>
        <button class="btn" data-id="${card.creature.id}">Propose (you keep the kid)</button>
      </div>`;
    grid.appendChild(el);
    const viz = el.querySelector(".viz") as HTMLElement;
    const s = new CreatureScene(viz);
    s.setCreature(card.creature.genome, card.creature.generation, card.creature.xp);
    miniScenes.push(s);
    el.querySelector("button")!.addEventListener("click", async () => {
      await api.requestMate(c.id, card.creature.id, "me", "you keep the kid");
      toast(`Proposed to ${card.ownerName}. Track it under your matings.`);
      renderRequests();
    });
  });
}

// The follow-up panel: every mate request you have sent, with live status and a
// gestation progress bar. Polls itself while anything is in flight.
let lastReqSig = "";
async function renderRequests() {
  const host = view.querySelector("#requests");
  if (!host) return;
  const reqs = await api.myRequests();
  const now = Date.now();

  if (reqs.length === 0) {
    host.innerHTML = "";
    lastReqSig = "";
    disposeTrioScenes();
    if (requestPoll) { clearTimeout(requestPoll); requestPoll = null; }
    return;
  }

  // Only rebuild the DOM (and the 3D preview scenes) when a request's STATUS
  // changes. Between status changes we just nudge the progress bars in place, so
  // the live previews do not flicker every poll during a long incubation.
  const sig = reqs.map((rv) => `${rv.req.id}:${rv.req.status}`).join("|");
  if (sig === lastReqSig) {
    reqs.forEach((rv, i) => {
      if (rv.req.status !== "incubating") return;
      const prog = mating.gestationProgress(rv.req, now) * 100;
      const bar = host.querySelectorAll(".req-row")[i]?.querySelector<HTMLElement>(".bar.inc > span");
      if (bar) bar.style.width = `${prog}%`;
    });
    requestPoll = window.setTimeout(renderRequests, 1500);
    return;
  }
  lastReqSig = sig;
  disposeTrioScenes(); // status changed: tear down old preview scenes, rebuild

  host.innerHTML = `
    <h2 class="section-h">Your matings</h2>
    <div class="req-list">
      ${reqs.map((rv, idx) => {
        const r = rv.req;
        const prog = Math.round(mating.gestationProgress(r, now) * 100);
        const chance = Math.round(r.successChance * 100);
        let badge = "", detail = "", cls = "";
        if (r.status === "pending") { badge = "waiting for accept"; detail = `${rv.partnerName} has not answered yet`; cls = "st-pending"; }
        else if (r.status === "incubating") { badge = "incubating"; detail = `${prog}% incubated . ${chance}% chance it takes`; cls = "st-inc"; }
        else if (r.status === "hatched") { badge = "hatched!"; detail = rv.offspring ? `Gen-${rv.offspring.generation} ${rv.offspring.name}, genetics ${scoreGenetics(rv.offspring.genome)}` : "a new creature was born"; cls = "st-ok"; }
        else if (r.status === "failed") { badge = "failed"; detail = "no offspring, cooldown spent. try again"; cls = "st-fail"; }
        else { badge = "declined"; detail = `${rv.partnerName} said no`; cls = "st-fail"; }

        // While incubating, show both parents and a live preview of how their
        // offspring will look. The preview is exact, not a guess: the child
        // genome is blend(parentA, parentB), the same function that makes the
        // real baby on success.
        let trio = "";
        if (r.status === "incubating" && rv.myCreature && rv.partnerCreature) {
          const childGenome = blend(rv.myCreature.genome, rv.partnerCreature.genome);
          const childGen = Math.max(rv.myCreature.generation, rv.partnerCreature.generation) + 1;
          const childScore = scoreGenetics(childGenome);
          trio = `
            <div class="req-trio" data-row="${idx}">
              <div class="trio-cell">
                <div class="trio-viz" data-which="mine"></div>
                <div class="trio-label">${rv.myCreature.name}<small>Gen-${rv.myCreature.generation}</small></div>
              </div>
              <div class="trio-plus">+</div>
              <div class="trio-cell">
                <div class="trio-viz" data-which="partner"></div>
                <div class="trio-label">${rv.partnerName}<small>Gen-${rv.partnerCreature.generation}</small></div>
              </div>
              <div class="trio-arrow">&rarr;</div>
              <div class="trio-cell child">
                <div class="trio-viz" data-which="child"></div>
                <div class="trio-label">preview<small>Gen-${childGen} . genetics ${childScore}</small></div>
              </div>
            </div>`;
        }

        return `
          <div class="req-row ${cls}">
            <div class="req-main">
              <span class="req-partner">${rv.partnerName}</span>
              <span class="req-badge">${badge}</span>
            </div>
            <div class="req-detail">${detail}</div>
            ${r.status === "incubating" ? `<div class="bar inc"><span style="width:${prog}%"></span></div>` : ""}
            ${trio}
          </div>`;
      }).join("")}
    </div>`;

  // Mount the live 3D parents + offspring preview for each incubating row.
  host.querySelectorAll<HTMLElement>(".req-trio").forEach((trioEl) => {
    const idx = Number(trioEl.dataset.row);
    const rv = reqs[idx];
    if (!rv.myCreature || !rv.partnerCreature) return;
    const childGenome = blend(rv.myCreature.genome, rv.partnerCreature.genome);
    const childGen = Math.max(rv.myCreature.generation, rv.partnerCreature.generation) + 1;
    const mount = (sel: string, genome: typeof childGenome, gen: number, xp: number) => {
      const el = trioEl.querySelector<HTMLElement>(`.trio-viz[data-which="${sel}"]`);
      if (!el) return;
      const s = new CreatureScene(el);
      s.setCreature(genome, gen, xp);
      trioScenes.push(s);
    };
    mount("mine", rv.myCreature.genome, rv.myCreature.generation, rv.myCreature.xp);
    mount("partner", rv.partnerCreature.genome, rv.partnerCreature.generation, rv.partnerCreature.xp);
    // Preview the child as a small egg/blob so it reads as "incubating", not grown.
    mount("child", childGenome, childGen, 60);
  });

  // Keep refreshing while anything is pending or incubating.
  const live = reqs.some((rv) => rv.req.status === "pending" || rv.req.status === "incubating");
  if (requestPoll) { clearTimeout(requestPoll); requestPoll = null; }
  if (live) requestPoll = window.setTimeout(renderRequests, 1500);
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
