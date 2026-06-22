// The living, rotating creature. Wraps buildCreature in a Three.js scene with
// lighting, a turntable, drag-to-rotate, and an idle animation loop (breathe,
// blink, bob, plus droop when hungry and a bounce when fed). DOM + WebGL here,
// so this is not unit-tested; the pure geometry in render.ts is.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { buildCreature, type BuildResult } from "./render.js";
import type { Genome } from "../shared/genome.js";

export type Mood = "happy" | "ok" | "sad";

export class CreatureScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private built: BuildResult | null = null;
  private t = 0;
  private dragging = false;
  private lastX = 0;
  private spin = 0; // user-applied spin offset (drag only; no auto-rotate)
  private mouthBaseY = 0;
  private mood: Mood = "happy";
  private bounce = 0; // decays; spikes when fed
  private raf = 0;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping makes the emissive glow read as light, not flat color.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.resize();
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, this.aspect(), 0.1, 100);
    this.camera.position.set(0, 0.3, 4.4);

    // Soft, warm-cool key/fill/rim plus a hemisphere for gentle ambient bounce.
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(3, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0008;
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.6);
    fill.position.set(-4, 1, 2);
    const rim = new THREE.DirectionalLight(0xffd9a8, 0.7);
    rim.position.set(0, 3, -4);
    this.scene.add(
      key,
      fill,
      rim,
      new THREE.HemisphereLight(0xcfe0ff, 0x3a2a55, 0.7),
    );

    // A soft contact-shadow floor so the creature feels grounded in the dish.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.45;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(this.rig);

    // Soft bloom so the aura, orb, and emissive skin glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.7);
    this.composer.addPass(this.bloom);

    this.bindDrag();
    window.addEventListener("resize", () => this.resize());
    this.loop();
  }

  private aspect() {
    const r = this.host.getBoundingClientRect();
    return Math.max(0.5, r.width / Math.max(1, r.height));
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    if (this.camera) {
      this.camera.aspect = this.aspect();
      this.camera.updateProjectionMatrix();
    }
    this.composer?.setSize(r.width, r.height);
    this.bloom?.setSize(r.width, r.height);
  }

  private bindDrag() {
    const el = this.renderer.domElement;
    // Drag to rotate. No auto-rotation: the creature only spins when you spin it.
    const down = (x: number) => { this.dragging = true; this.lastX = x; };
    const move = (x: number) => { if (this.dragging) { this.spin += (x - this.lastX) * 0.01; this.lastX = x; } };
    const up = () => { this.dragging = false; };
    el.addEventListener("pointerdown", (e) => down(e.clientX));
    window.addEventListener("pointermove", (e) => move(e.clientX));
    window.addEventListener("pointerup", up);
  }

  // Swap in a new creature. Cheap enough to call on every genome change.
  setCreature(genome: Genome, generation: number, xp: number) {
    this.rig.clear();
    this.built = buildCreature(genome, generation, xp);
    // Every solid mesh casts and receives soft shadows.
    this.built.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    this.mouthBaseY = this.built.parts.mouth.scale.y;
    this.rig.add(this.built.group);
  }

  setMood(mood: Mood) { this.mood = mood; }

  // Call when the creature is fed: a happy little bounce.
  poke() { this.bounce = 1; }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.t += 0.016;
    // Rotation is drag-only: the rig holds wherever the user left it.
    this.rig.rotation.y = this.spin;

    if (this.built) {
      const t = this.t;
      const { body, head, eyes, mouth, arms, legs } = this.built.parts;

      // Breathing: two sine bands (a slow deep breath plus a faster flutter) so
      // it never looks metronomic. Belly expands a touch more than it rises.
      const breath = Math.sin(t * 1.5) * 0.7 + Math.sin(t * 2.9 + 1.1) * 0.3;
      body.scale.x = 1 + breath * 0.04;
      body.scale.z = 1 + breath * 0.04;
      body.scale.y = 1 + breath * 0.022;
      // The whole rig bobs and sways gently, like it is balancing.
      this.rig.position.y = Math.sin(t * 1.5) * 0.05;
      this.rig.rotation.z = Math.sin(t * 0.8) * 0.02;

      // Feed bounce, decays.
      if (this.bounce > 0) {
        this.rig.position.y += Math.sin(this.bounce * Math.PI) * 0.4;
        this.bounce = Math.max(0, this.bounce - 0.04);
      }

      // Head: droop by mood, plus a slow idle lookaround (it glances about).
      const droop = this.mood === "sad" ? -0.25 : this.mood === "ok" ? -0.08 : 0;
      head.rotation.x = droop + Math.sin(t * 0.9) * 0.05;
      head.rotation.y = Math.sin(t * 0.37) * 0.18; // lazy turning of the head

      // Eyes: occasional quick blinks (not a smooth sine) plus tiny saccades so
      // the gaze flickers and feels alive.
      const blink = blinkAmount(t);
      const sacc = Math.sin(t * 0.31) * 0.02 + (pulse(t, 2.3, 0.05) ? 0.05 : 0);
      for (const e of eyes) {
        e.scale.y = blink;
        e.rotation.y = sacc;
      }

      // Mouth: opens and closes once in a while, like it is chirping or chewing.
      const talk = pulse(t, 5.0, 0.12) ? 1 + Math.abs(Math.sin(t * 14)) * 0.9 : 1;
      mouth.scale.y = this.mouthBaseY * talk;

      // Arms: a slow idle sway, with an occasional bigger wave.
      const wave = pulse(t, 7.0, 0.1) ? Math.sin(t * 9) * 0.4 : 0;
      arms.children.forEach((arm, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        arm.rotation.x = Math.sin(t * 1.1 + i) * 0.12 + wave * side;
      });

      // Legs: a small periodic shuffle/tap once in a while.
      const step = pulse(t, 6.0, 0.12);
      legs.children.forEach((leg, i) => {
        if (leg.userData.baseY === undefined) leg.userData.baseY = leg.position.y;
        leg.position.y = leg.userData.baseY + (step ? Math.max(0, Math.sin(t * 12 + i * 1.7)) * 0.06 : 0);
      });
    }
    this.composer.render();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// True for a short window of length `width` (in seconds) once every `period`
// seconds. Used for occasional gestures (a wave, a chirp, a step) so the
// creature does things "once in a while" instead of constantly.
function pulse(t: number, period: number, width: number): boolean {
  return t % period < width;
}

// Discrete blinks: eyes are open (1) almost always, snapping near-shut for a
// fraction of a second a couple of times every few seconds. Two offset timers
// so blinks are not perfectly periodic.
function blinkAmount(t: number): number {
  const a = t % 4.3 < 0.12;
  const b = t % 6.7 < 0.1;
  return a || b ? 0.12 : 1;
}
