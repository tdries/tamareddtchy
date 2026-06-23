// The 3D living-world arena. Renders a ground + sky + food pickups and a roaming
// population of creatures, driving their positions from the pure world sim each
// frame. Reuses buildCreature so every agent in the world is the same richly
// detailed creature as in the nursery. DOM + WebGL here; the sim logic is in
// src/shared/world.ts and stays pure/tested.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildCreature } from "./render.js";
import { formForCreature } from "./animals.js";
import {
  type Agent, type Food, stepWorld, spawnAgent, scatterFood, ARENA,
} from "../shared/world.js";
import { type Creature } from "../shared/creature.js";

export interface WorldHandle {
  dispose(): void;
  onEvent(cb: (msg: string) => void): void;
}

export function startWorld(host: HTMLElement, creatures: Creature[]): WorldHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const fit = () => {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
  };
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);

  // Lights + shadow.
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(8, 16, 10); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 60;
  (key.shadow.camera as THREE.OrthographicCamera).left = -ARENA * 1.5;
  (key.shadow.camera as THREE.OrthographicCamera).right = ARENA * 1.5;
  (key.shadow.camera as THREE.OrthographicCamera).top = ARENA * 1.5;
  (key.shadow.camera as THREE.OrthographicCamera).bottom = -ARENA * 1.5;
  scene.add(key, new THREE.HemisphereLight(0xbcd4ff, 0x2a2438, 0.6));

  // Ground: a soft rounded arena disc with a subtle grid feel via color.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA * 1.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x241d31, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // A glowing ring marking the arena edge.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ARENA * 1.46, ARENA * 1.5, 64),
    new THREE.MeshStandardMaterial({ color: 0xff4500, emissive: 0xff4500, emissiveIntensity: 0.6 }),
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);

  // Sim state.
  const agents: Agent[] = creatures.map((c, i) => spawnAgent(c, (i + 1) * 7919));
  let food: Food[] = scatterFood(10, 12345);

  // One rendered rig per agent, parented to a positioner group.
  const rigs: THREE.Group[] = agents.map((a) => {
    const holder = new THREE.Group();
    const built = buildCreature(a.creature.genome, a.creature.generation, a.creature.xp,
      formForCreature(a.creature.id, a.creature.parents), a.creature.id);
    built.group.scale.setScalar(0.6); // creatures are small in the wide arena
    built.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });
    holder.add(built.group);
    scene.add(holder);
    return holder;
  });

  // Food meshes (glowing pellets), rebuilt when the food list changes.
  let foodMeshes: THREE.Mesh[] = [];
  const rebuildFood = () => {
    for (const m of foodMeshes) scene.remove(m);
    foodMeshes = food.map((f) => {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28, 0),
        new THREE.MeshStandardMaterial({ color: 0x8ef0bd, emissive: 0x2fd07a, emissiveIntensity: 0.8, roughness: 0.4 }),
      );
      m.position.set(f.pos.x, 0.3, f.pos.z);
      scene.add(m);
      return m;
    });
  };
  rebuildFood();

  // Bloom for the glow.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.85);
  composer.addPass(bloom);

  const resize = () => {
    fit();
    const r = host.getBoundingClientRect();
    camera.aspect = Math.max(0.5, r.width / Math.max(1, r.height));
    camera.updateProjectionMatrix();
    composer.setSize(r.width, r.height);
    bloom.setSize(r.width, r.height);
  };
  resize();
  window.addEventListener("resize", resize);

  // Drag to orbit the camera around the arena.
  let camAngle = 0.5, dragging = false, lastX = 0;
  const down = (x: number) => { dragging = true; lastX = x; };
  const move = (x: number) => { if (dragging) { camAngle += (x - lastX) * 0.005; lastX = x; } };
  const up = () => { dragging = false; };
  renderer.domElement.addEventListener("pointerdown", (e) => down(e.clientX));
  window.addEventListener("pointermove", (e) => move(e.clientX));
  window.addEventListener("pointerup", up);

  let eventCb: ((m: string) => void) | null = null;
  let raf = 0;
  let t = 0;
  let seed = 99;
  let last = 0;
  // Re-scatter a little food periodically so the world does not starve.
  let foodTimer = 0;

  const loop = (ms: number) => {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.05, (ms - last) / 1000) : 0.016;
    last = ms;
    t += dt;

    // advance the sim (now in ms approximated by t*1000 for cooldown math)
    const events = stepWorld(agents, food, dt, t * 1000, (seed = (seed * 16807) % 2147483647), () => `w_${Math.floor(t * 1000)}_${agents.length}`);
    for (const ev of events) {
      if (ev.type === "ate") rebuildFood();
      if (ev.type === "bred" && ev.offspring) {
        if (eventCb) eventCb(`${agents[ev.a].creature.name} and ${agents[ev.b!].creature.name} had a baby!`);
        // add the newborn to the world
        const baby = ev.offspring;
        const ag = spawnAgent(baby, Math.floor(t * 1000));
        ag.pos = { x: ev.pos.x, z: ev.pos.z };
        agents.push(ag);
        const holder = new THREE.Group();
        const built = buildCreature(baby.genome, baby.generation, baby.xp, formForCreature(baby.id, baby.parents), baby.id);
        built.group.scale.setScalar(0.35); // babies start small
        built.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
        holder.add(built.group);
        scene.add(holder);
        rigs.push(holder);
      }
    }
    foodTimer += dt;
    if (foodTimer > 6 && food.length < 6) { food.push(...scatterFood(4, Math.floor(t * 7919))); rebuildFood(); foodTimer = 0; }

    // place rigs from sim, face their velocity, bob a little
    agents.forEach((a, i) => {
      const rig = rigs[i];
      if (!rig) return;
      rig.position.set(a.pos.x, 0.9 + Math.sin(t * 2 + i) * 0.04, a.pos.z);
      const speed = Math.hypot(a.vel.x, a.vel.z);
      if (speed > 0.05) rig.rotation.y = Math.atan2(a.vel.x, a.vel.z);
    });

    // orbit camera
    const cr = ARENA * 2.4;
    camera.position.set(Math.sin(camAngle) * cr, ARENA * 1.5, Math.cos(camAngle) * cr);
    camera.lookAt(0, 0.5, 0);

    composer.render();
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    onEvent(cb) { eventCb = cb; },
  };
}
