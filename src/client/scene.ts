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
  private spin = 0; // user-applied spin offset
  private autoRotate = true;
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
    const down = (x: number) => { this.dragging = true; this.lastX = x; this.autoRotate = false; };
    const move = (x: number) => { if (this.dragging) { this.spin += (x - this.lastX) * 0.01; this.lastX = x; } };
    const up = () => { this.dragging = false; setTimeout(() => (this.autoRotate = true), 2500); };
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
    this.rig.add(this.built.group);
  }

  setMood(mood: Mood) { this.mood = mood; }

  // Call when the creature is fed: a happy little bounce.
  poke() { this.bounce = 1; }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.t += 0.016;
    if (this.autoRotate) this.spin += 0.004;
    this.rig.rotation.y = this.spin;

    if (this.built) {
      const { body, head, eyes } = this.built.parts;
      // Breathe: gentle scale pulse on the body.
      const breathe = 1 + Math.sin(this.t * 1.8) * 0.025;
      body.scale.x = breathe;
      body.scale.z = breathe;
      // Bob the whole rig.
      this.rig.position.y = Math.sin(this.t * 1.4) * 0.05;
      // Bounce decays after a feed.
      if (this.bounce > 0) {
        this.rig.position.y += Math.sin(this.bounce * Math.PI) * 0.4;
        this.bounce = Math.max(0, this.bounce - 0.04);
      }
      // Mood: a sad creature droops its head and dims; happy perks up.
      const droop = this.mood === "sad" ? -0.25 : this.mood === "ok" ? -0.08 : 0;
      head.rotation.x = droop + Math.sin(this.t * 1.2) * 0.04;
      // Blink: squash eyes briefly on a slow cycle.
      const blink = Math.sin(this.t * 0.6) > 0.97 ? 0.1 : 1;
      for (const e of eyes) e.scale.y = blink;
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
