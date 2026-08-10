import * as THREE from '../libs/three.module.js';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from './ragdoll.js';
import { MAPS, readInput, isDown } from './input.js';
import { SKINS, getFaceTexture, toonMat, addOutline, vinilMat } from './skins.js';
import { som, initSom } from './som.js';
import { readGamepad, mergeInput } from './gamepad.js';
import { GLTFLoader } from '../libs/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from '../libs/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../libs/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../libs/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../libs/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from '../libs/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from '../libs/jsm/environments/RoomEnvironment.js';

await RAPIER.init();

// Carimbo visível na tela — se o número não bater com o do repo, é cache velho
const VERSAO = 'v15-cidade';

let WIN_SCORE = 5; // rounds pra vencer a partida (definido pelo modo escolhido)
// Modos de jogo (escolhidos no menu com a tecla N)
const MODOS = [
  { nome: 'Melhor de 5', vitorias: 5, caos: false },
  { nome: 'Melhor de 3', vitorias: 3, caos: false },
  { nome: 'Morte Súbita', vitorias: 1, caos: false },
  { nome: 'CAOS ⚔️ (armas sem parar)', vitorias: 5, caos: true },
];
let modoIdx = 0;
let MODO_CAOS = false; // partida atual usa drop de armas acelerado?
const IDLE_IN = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false, esquiva: false };

// Na versão publicada (arquivo único), os assets viram data-URIs injetados aqui.
const ASSET = (p) => (globalThis.MOLENGAS_ASSETS && globalThis.MOLENGAS_ASSETS[p]) || p;
// localStorage pode ser bloqueado em iframe — falha silenciosa.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const PARAMS = new URLSearchParams(location.search);

// ---------- Física ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const GROUND_GROUPS = (0x0001 << 16) | 0xffff;
const PLAYER_BITS = [0x0002, 0x0004, 0x0020, 0x0040];
const TODOS_PLAYERS = 0x0066;
const PROP_GROUPS = (0x0008 << 16) | (0x0001 | 0x0008 | TODOS_PLAYERS);
// spawn [x, z] + de frente pro centro
const SPAWNS = [[-2.2, 0], [2.2, 0], [0, -2.6], [0, 2.6]];

// ---------- Cena ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141433);
scene.fog = new THREE.Fog(0x141433, 22, 55);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 10);

function criarRenderer() {
  const tentativas = [
    { antialias: true },
    { antialias: false },
    { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
  ];
  for (const opts of tentativas) {
    try { return new THREE.WebGLRenderer(opts); } catch {}
  }
  throw new Error(
    'O 3D (WebGL) está desligado no seu navegador — não é um problema do jogo. ' +
    'Feche TODAS as janelas do navegador e abra de novo. Se persistir: ative ' +
    '"Usar aceleração gráfica" em chrome://settings/system e teste get.webgl.org (deve mostrar um cubo girando).',
  );
}
const r3 = criarRenderer();
r3.setSize(innerWidth, innerHeight);
r3.setPixelRatio(Math.min(devicePixelRatio, 2));
r3.shadowMap.enabled = true;
r3.shadowMap.type = THREE.PCFSoftShadowMap;
r3.toneMapping = THREE.ACESFilmicToneMapping;
r3.toneMappingExposure = 1.12;
document.body.appendChild(r3.domElement);

// ---------- Reflexo de ambiente (IBL) — opt-in por ?env ----------
// Dá reflexo no metal, mas o IBL soma luz e briga com o bloom (estoura). Pra ligar
// de verdade precisa rebaixar as luzes dos mapas antes — fica pra um passe futuro.
if (PARAMS.has('env')) {
  const pmrem = new THREE.PMREMGenerator(r3);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.18;
}

// ---------- Pós-processamento: bloom (brilho no laser/água/holofotes/neon) ----------
// ?nobloom desliga (fallback). Composer renderiza a cena, aplica bloom e faz a
// saída (tonemap ACES + sRGB) no OutputPass.
const USA_BLOOM = !PARAMS.has('nobloom');
let composer = null, bloomPass = null, smaaPass = null;
if (USA_BLOOM) {
  composer = new EffectComposer(r3);
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 0.9); // força, raio, limiar
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  smaaPass = new SMAAPass(innerWidth, innerHeight); // anti-serrilhado (bordas limpas)
  composer.addPass(smaaPass);
}
function renderCena() { if (composer) composer.render(); else r3.render(scene, camera); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  r3.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  bloomPass?.setSize(innerWidth, innerHeight);
  smaaPass?.setSize(innerWidth, innerHeight);
});

const hemi = new THREE.HemisphereLight(0xccccff, 0x443344, 1.05);
scene.add(hemi);
const rim = new THREE.DirectionalLight(0x7f9dff, 0.9);
rim.position.set(-4, 5, -7);
scene.add(rim);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
scene.add(sun);

// Snapshot do ambiente padrão — um mapa pode sobrescrever luz/neblina no build,
// e setMapa restaura tudo isto antes do próximo build (não vaza entre mapas).
const AMBIENTE_PADRAO = {
  hemiSky: 0xccccff, hemiGround: 0x443344, hemiInt: 1.05,
  rim: 0x7f9dff, rimInt: 0.9, rimPos: [-4, 5, -7],
  sun: 0xffffff, sunInt: 1.6, sunPos: [6, 12, 5],
  fog: 0x141433, fogNear: 22, fogFar: 55, expo: 1.12,
};
function restaurarAmbiente() {
  const A = AMBIENTE_PADRAO;
  hemi.color.setHex(A.hemiSky); hemi.groundColor.setHex(A.hemiGround); hemi.intensity = A.hemiInt;
  rim.color.setHex(A.rim); rim.intensity = A.rimInt; rim.position.set(...A.rimPos);
  sun.color.setHex(A.sun); sun.intensity = A.sunInt; sun.position.set(...A.sunPos);
  scene.fog.color.setHex(A.fog); scene.fog.near = A.fogNear; scene.fog.far = A.fogFar;
  r3.toneMappingExposure = A.expo;
}

// Textura do tablado (usada pelos mapas)
const deckTex = makeDeckTexture();

// Fundo (arte do Pollinations) — trocável por mapa
const backMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 62.5),
  new THREE.MeshBasicMaterial({ color: 0x141433, fog: false }),
);
backMesh.position.set(0, 6, -42);
scene.add(backMesh);
let fundoPedido = 0;
function setFundo(caminho) {
  const meu = ++fundoPedido;
  new THREE.TextureLoader().load(ASSET(caminho), (tex) => {
    if (meu !== fundoPedido) return; // chegou atrasado, outro mapa já pediu
    tex.colorSpace = THREE.SRGBColorSpace;
    backMesh.material.map = tex;
    backMesh.material.color.set(0xffffff);
    backMesh.material.needsUpdate = true;
  }, undefined, () => {});
}
setFundo('assets/fundo.jpg');

// ---------- Mapas ----------
const texCaixote = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c89b52';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(90,55,15,0.5)';
  for (const y of [0, 40, 84]) g.fillRect(0, y, 128, 4);
  g.strokeStyle = '#8a5f28';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.moveTo(118, 10); g.lineTo(10, 118); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const matCaixote = toonMat(THREE, 0xffffff);
matCaixote.map = texCaixote;

const texQueijo = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c94c';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#d9a832';
  for (const [hx, hy, hr] of [[40, 60, 20], [180, 40, 14], [120, 150, 24], [220, 200, 17], [60, 210, 12], [200, 110, 10]]) {
    g.beginPath(); g.arc(hx, hy, hr, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

function fazerCaixote(m, x, z) {
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.4, z).setLinearDamping(0.25).setAngularDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.19, 0.19, 0.19).setMass(4).setFriction(0.6).setCollisionGroups(PROP_GROUPS),
    b,
  );
  const me = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), matCaixote);
  me.castShadow = true;
  addOutline(THREE, me);
  scene.add(me);
  m.bodies.push(b);
  m.meshes.push(me);
  m.syncPairs.push([b, me]);
  m.props.push(b);
  m._caixotes.push([b, x, z]);
}
function resetCaixotes(m) {
  for (const [b, x, z] of m._caixotes) {
    b.setTranslation({ x, y: 0.4, z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

// ---------- Armas (dropam no mapa, qualquer um pega e usa) ----------
// Cada arma é um prop (agarrável/arremessável); em velocidade, o corpo dela
// machuca quem encostar (menos quem a segura). O visual é placeholder por
// enquanto — depois entra o GLB do Meshy (arma não precisa de rig).
const ARMAS_DEF = {
  bastao: {
    icone: '🏏',
    y0: 0.55, massa: 2.6, alcance: 0.72, forca: 10,
    collider: () => RAPIER.ColliderDesc.capsule(0.32, 0.06),
    mesh: () => {
      const g = new THREE.Group();
      const cabo = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.74, 12), toonMat(THREE, 0x9a6b3f));
      const punho = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), toonMat(THREE, 0x2e2e38));
      punho.position.y = -0.36; g.add(cabo, punho);
      return g;
    },
  },
  cano: {
    icone: '🔧',
    y0: 0.5, massa: 3.2, alcance: 0.66, forca: 12,
    collider: () => RAPIER.ColliderDesc.capsule(0.36, 0.05),
    mesh: () => {
      const g = new THREE.Group();
      const m1 = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.8, roughness: 0.35 });
      const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.82, 14), m1);
      const anel = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 14), m1); anel.position.y = 0.4;
      g.add(tubo, anel);
      return g;
    },
  },
  // Arma de TIRO: segurar + apertar soco dispara um laser na direção que olha.
  laser: {
    icone: '🔫',
    y0: 0.4, massa: 1.5, alcance: 0.42, forca: 4,
    tiro: true, alcanceTiro: 7, cadencia: 0.28, danoTiro: 1, cor: 0x37e5ff,
    calorMax: 6, calorPorTiro: 1, resfria: 2.2, // superaquecimento: 6 tiros seguidos e trava até esfriar
    glb: 'raygun-low', escala: 0.62, corMat: 0xc79a4a, // ray gun do Meshy (metálico dourado)
    collider: () => RAPIER.ColliderDesc.capsule(0.12, 0.13),
    mesh: () => { // fallback caso o GLB não tenha carregado ainda
      const g = new THREE.Group();
      const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.36), new THREE.MeshStandardMaterial({ color: 0x2b3040, metalness: 0.7, roughness: 0.4 }));
      const cano = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x8890a0, metalness: 0.8, roughness: 0.3 }));
      cano.rotation.x = Math.PI / 2; cano.position.set(0, 0.02, 0.28);
      const cabo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7 }));
      cabo.position.set(0, -0.17, -0.08);
      const ponta = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0x37e5ff }));
      ponta.position.set(0, 0.02, 0.44);
      g.add(corpo, cano, cabo, ponta);
      return g;
    },
  },
};
// Cache dos modelos de arma (GLB do Meshy) — carrega uma vez, clona a cada drop.
const armaGLBcache = {};
function preloadArmaGLB(def) {
  new GLTFLoader().load(ASSET('assets/modelos/' + def.glb + '.glb'), (g) => {
    const s = g.scene;
    const mat = new THREE.MeshStandardMaterial({ color: def.corMat ?? 0xb8b8c0, metalness: 0.65, roughness: 0.4 });
    s.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
    // centraliza e escala pra caber na mão
    const box = new THREE.Box3().setFromObject(s), size = new THREE.Vector3(); box.getSize(size);
    s.scale.setScalar((def.escala || 0.5) / (Math.max(size.x, size.y, size.z) || 1));
    const g2 = new THREE.Group(); g2.add(s);
    const c2 = new THREE.Vector3(); new THREE.Box3().setFromObject(g2).getCenter(c2); s.position.sub(c2);
    armaGLBcache[def.glb] = g2;
  });
}
for (const d of Object.values(ARMAS_DEF)) if (d.glb) preloadArmaGLB(d);

function soltarArma(m, x, z, tipo = 'bastao') {
  const def = ARMAS_DEF[tipo] || ARMAS_DEF.bastao;
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, def.y0, z).setLinearDamping(0.2).setAngularDamping(0.45),
  );
  world.createCollider(def.collider().setMass(def.massa).setFriction(0.6).setCollisionGroups(PROP_GROUPS), b);
  const mesh = (def.glb && armaGLBcache[def.glb]) ? armaGLBcache[def.glb].clone(true) : def.mesh();
  mesh.castShadow = true; scene.add(mesh);
  m.bodies.push(b); m.meshes.push(mesh); m.syncPairs.push([b, mesh]); m.props.push(b);
  (m.armas ||= []).push({
    body: b, mesh, icone: def.icone || '🔩', alcance: def.alcance, forca: def.forca,
    tiro: !!def.tiro, alcanceTiro: def.alcanceTiro || 0, cadencia: def.cadencia || 0.5,
    danoTiro: def.danoTiro || 1, cor: def.cor || 0x37e5ff,
    calor: 0, calorMax: def.calorMax || 6, calorPorTiro: def.calorPorTiro || 1, resfria: def.resfria || 2.2, quente: false,
  });
  return b;
}
// Feixes de laser (efeito curto). Cilindro do cano até o ponto de impacto.
const laserBeams = [];
function spawnBeam(fx, fy, fz, tx, ty, tz, cor) {
  const dv = new THREE.Vector3(tx - fx, ty - fy, tz - fz); const len = dv.length() || 0.01;
  const grp = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, len, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false }),
  );
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, len, 10),
    new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.5, fog: false }),
  );
  grp.add(core, glow);
  grp.position.set(fx + dv.x * 0.5, fy + dv.y * 0.5, fz + dv.z * 0.5);
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.clone().normalize());
  scene.add(grp); laserBeams.push({ m: grp, core, glow, vida: 0.18, max: 0.18 });
}
function updateBeams(dt) {
  for (let i = laserBeams.length - 1; i >= 0; i--) {
    const b = laserBeams[i]; b.vida -= dt;
    const k = Math.max(0, b.vida / b.max);
    b.core.material.opacity = k; b.glow.material.opacity = k * 0.5;
    b.m.scale.x = b.m.scale.z = 1 + (1 - k) * 1.6;
    if (b.vida <= 0) {
      scene.remove(b.m);
      b.core.geometry.dispose(); b.core.material.dispose();
      b.glow.geometry.dispose(); b.glow.material.dispose();
      laserBeams.splice(i, 1);
    }
  }
}
// Dispara o laser do blaster na direção que o lutador olha (hitscan).
function dispararLaser(l, arma) {
  const h = l.rag.heading;
  const dx = Math.sin(h), dz = Math.cos(h);
  const mp = arma.body.translation();
  const fx = mp.x, fy = mp.y, fz = mp.z, range = arma.alcanceTiro;
  let alvo = null, alvoT = range, ap = null;
  for (const o of lutadores) {
    if (o === l || !o.vivo || o.rag.isEsquivando(simNow)) continue; // esquiva desvia o tiro
    const tp = o.rag.parts.torso.translation();
    const rx = tp.x - fx, ry = tp.y - fy, rz = tp.z - fz;
    const t = rx * dx + rz * dz;                 // distância ao longo do feixe (horizontal)
    if (t < 0.2 || t > range) continue;
    const px = rx - dx * t, pz = rz - dz * t;    // perpendicular
    const perp = Math.hypot(px, ry, pz);
    if (perp < 0.75 && t < alvoT) { alvoT = t; alvo = o; ap = tp; }
  }
  const ex = fx + dx * (alvo ? alvoT : range), ez = fz + dz * (alvo ? alvoT : range);
  spawnBeam(fx, fy, fz, ex, fy, ez, arma.cor);
  spawnFlash(fx + dx * 0.45, fy, fz + dz * 0.45, arma.cor); // flash no cano
  powFx({ x: fx + dx * 0.4, y: fy, z: fz + dz * 0.4 });
  som.laser?.();
  if (alvo) {
    alvo.rag.dano = Math.min(4, alvo.rag.dano + arma.danoTiro);
    alvo.rag.stun(simNow + 0.85);
    if (alvo.rag.dano >= 4 && !alvo.rag.isDowned(simNow)) alvo.rag.knockdown(simNow);
    for (const pn of ['torso', 'pelvis']) alvo.rag.parts[pn].applyImpulse({ x: dx * 7, y: 1.6, z: dz * 7 }, true);
    alvo.rag.lastHitLandedAt = simNow;
    burstEstrelas(ap); powFx(ap); trauma = Math.min(1, trauma + 0.4); hitStop = Math.max(hitStop, 0.05);
  }
}
// Flash do cano (bola brilhante que some rápido) — usa a mesma lista dos feixes
function spawnFlash(x, y, z, cor) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.6, fog: false }));
  grp.add(core, glow); grp.position.set(x, y, z);
  scene.add(grp); laserBeams.push({ m: grp, core, glow, vida: 0.12, max: 0.12 });
}
// Mira do laser: linha fina (ciano; vermelha se superaquecida) do cano até o 1o rival
const _UP = new THREE.Vector3(0, 1, 0);
function criarSight() {
  const grp = new THREE.Group();
  const linha = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.3, fog: false }));
  const ponto = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.75, fog: false }));
  grp.add(linha, ponto);
  return { grp, linha, ponto };
}
function atualizarSight(s, rag, arma) {
  const h = rag.heading, dx = Math.sin(h), dz = Math.cos(h);
  const mp = arma.body.translation(), range = arma.alcanceTiro;
  let t = range;
  for (const o of lutadores) {
    if (o.rag === rag || !o.vivo) continue;
    const tp = o.rag.parts.torso.translation();
    const rx = tp.x - mp.x, rz = tp.z - mp.z, dd = rx * dx + rz * dz;
    if (dd < 0.2 || dd > range) continue;
    if (Math.hypot(rx - dx * dd, rz - dz * dd) < 0.75) t = Math.min(t, dd);
  }
  const len = Math.max(0.2, t);
  s.grp.position.set(mp.x, mp.y, mp.z);
  s.grp.quaternion.setFromUnitVectors(_UP, new THREE.Vector3(dx, 0, dz));
  s.linha.scale.set(1, len, 1); s.linha.position.set(0, len / 2, 0);
  s.ponto.position.set(0, len, 0);
  s.linha.material.color.setHex(arma.quente ? 0xff4030 : 0x66f0ff);
}
function removerArma(m, arma) {
  const i = (m.armas || []).indexOf(arma); if (i >= 0) m.armas.splice(i, 1);
  world.removeRigidBody(arma.body);
  scene.remove(arma.mesh);
  const pi = m.props.indexOf(arma.body); if (pi >= 0) m.props.splice(pi, 1);
  const si = m.syncPairs.findIndex((s) => s[0] === arma.body); if (si >= 0) m.syncPairs.splice(si, 1);
  const bi = m.bodies.indexOf(arma.body); if (bi >= 0) m.bodies.splice(bi, 1);
}
function chaoFixo(m, hx, hz, mat, atrito = 0.8) {
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(atrito).setCollisionGroups(GROUND_GROUPS), g);
  m.bodies.push(g);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.6, hz * 2), mat);
  deck.position.y = -0.3;
  deck.receiveShadow = true;
  scene.add(deck);
  m.meshes.push(deck);
  return g;
}

const texGelo = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#cfeefc');
  grad.addColorStop(1, '#a8d8f0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  for (const [x1, y1, x2, y2] of [[40, 90, 200, 60], [200, 60, 310, 140], [420, 40, 350, 210], [80, 300, 220, 340], [220, 340, 300, 460], [460, 300, 380, 380]]) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  g.strokeStyle = '#7fb8d8';
  g.lineWidth = 22;
  g.strokeRect(11, 11, 490, 490);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const texSumo = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f0e3c8';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#c2413b';
  g.lineWidth = 26;
  g.beginPath(); g.arc(256, 256, 218, 0, 7); g.stroke();
  g.lineWidth = 10;
  g.beginPath(); g.arc(256, 256, 60, 0, 7); g.stroke();
  g.fillStyle = '#c2413b';
  for (const a of [0.8, 2.35]) {
    g.save();
    g.translate(256 + Math.cos(a) * 130, 256 + Math.sin(a) * 130);
    g.fillRect(-8, -30, 16, 60);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const texJanelas = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#232a3a';
  g.fillRect(0, 0, 128, 128);
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = (i * 7 + j * 13) % 5 < 2 ? '#ffd94a' : '#46536b';
      g.fillRect(10 + i * 30, 10 + j * 24, 18, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const matBloco = (() => { const m = toonMat(THREE, 0xffffff); m.map = texJanelas; return m; })();

function predio(m, px, pz, alt = 5) {
  for (let col = 0; col < 2; col++) {
    for (let andar = 0; andar < alt; andar++) {
      const x = px + (col - 0.5) * 0.57;
      const y = 0.22 + andar * 0.44;
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, pz).setLinearDamping(0.15).setAngularDamping(0.35),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.28, 0.21, 0.28).setMass(3).setFriction(0.7).setCollisionGroups(PROP_GROUPS),
        b,
      );
      const me = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.56), matBloco);
      me.castShadow = true;
      me.receiveShadow = true;
      scene.add(me);
      m.bodies.push(b);
      m.meshes.push(me);
      m.syncPairs.push([b, me]);
      m.props.push(b);
      m._blocos.push([b, x, y, pz]);
    }
  }
}
function resetBlocos(m) {
  for (const [b, x, y, z] of m._blocos) {
    b.setTranslation({ x, y, z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

const MAPAS = [
  {
    nome: 'ESTÁDIO',
    build(m) {
      chaoFixo(m, ARENA.halfX, ARENA.halfZ, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // Bola de demolição
      const ancora = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 6.2, 0));
      const bola = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.8, 0).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3),
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(0.55).setMass(45).setFriction(0.4).setRestitution(0.3).setCollisionGroups(PROP_GROUPS),
        bola,
      );
      world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 4.4, z: 0 }), ancora, bola, true);
      bola.setLinvel({ x: 2.6, y: 0, z: 1.1 }, true);
      m.bodies.push(ancora, bola);
      m.props.push(bola);
      m.bolas.push(bola);
      const bolaMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), toonMat(THREE, 0x4a4a58));
      bolaMesh.castShadow = true;
      addOutline(THREE, bolaMesh);
      const brilho = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8a8a9a }));
      brilho.position.set(-0.2, 0.28, 0.28);
      bolaMesh.add(brilho);
      scene.add(bolaMesh);
      m.meshes.push(bolaMesh);
      m.syncPairs.push([bola, bolaMesh]);
      const corda = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), toonMat(THREE, 0x2e2e38));
      scene.add(corda);
      m.meshes.push(corda);
      const suporte = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), toonMat(THREE, 0x2e2e38));
      suporte.position.set(0, 6.2, 0);
      scene.add(suporte);
      m.meshes.push(suporte);
      for (const [cx, cz] of [[-3.4, 2.3], [3.2, -2.4], [0.6, 3.0], [-1.2, -2.9]]) fazerCaixote(m, cx, cz);
      const vA = new THREE.Vector3(0, 6.2, 0);
      const vB = new THREE.Vector3();
      const vD = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      m.update = () => {
        const bp = bola.translation();
        vB.set(bp.x, bp.y, bp.z);
        vD.subVectors(vA, vB);
        const len = vD.length();
        corda.position.copy(vB).addScaledVector(vD, 0.5);
        corda.scale.set(1, len, 1);
        corda.quaternion.setFromUnitVectors(up, vD.normalize());
      };
      m.reset = () => {
        bola.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
        bola.setLinvel({ x: 2.6, y: 0, z: 1.1 }, true);
        bola.setAngvel({ x: 0, y: 0, z: 0 }, true);
        resetCaixotes(m);
      };
    },
  },
  {
    nome: 'GANGORRA',
    build(m) {
      // Plataforma inteira apoiada num eixo central — o peso inclina
      const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
      const plat = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -0.3, 0).setAngularDamping(2),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(4.3, 0.3, 3.3).setMass(260).setFriction(0.9).setCollisionGroups(GROUND_GROUPS),
        plat,
      );
      const eixo = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
        base, plat, true,
      );
      if (eixo.setLimits) eixo.setLimits(-0.42, 0.42);
      if (eixo.configureMotorPosition) eixo.configureMotorPosition(0, 900, 380);
      m.bodies.push(base, plat);
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(8.6, 0.6, 6.6),
        new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }),
      );
      deck.receiveShadow = true;
      scene.add(deck);
      m.meshes.push(deck);
      m.syncPairs.push([plat, deck]);
      const fulcro = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 4), toonMat(THREE, 0x8a4f9e));
      fulcro.position.y = -1.2;
      scene.add(fulcro);
      m.meshes.push(fulcro);
      fazerCaixote(m, -1.6, 2.3);
      fazerCaixote(m, 1.6, -2.3);
      m.reset = () => {
        plat.setTranslation({ x: 0, y: -0.3, z: 0 }, true);
        plat.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        plat.setAngvel({ x: 0, y: 0, z: 0 }, true);
        plat.setLinvel({ x: 0, y: 0, z: 0 }, true);
        resetCaixotes(m);
      };
    },
  },
  {
    nome: 'QUEIJO',
    build(m) {
      // Ilhas com buracos entre elas — cuidado onde pisa
      const matQ = new THREE.MeshStandardMaterial({ map: texQueijo, roughness: 0.8 });
      const pads = [
        [0, 0, 0.85, 0.9],
        [2.6, 0, 1.05, 0.9], [-2.6, 0, 1.05, 0.9],
        [0, 2.4, 0.85, 0.75], [0, -2.4, 0.85, 0.75],
        [2.6, 2.4, 0.9, 0.7], [-2.6, 2.4, 0.9, 0.7], [2.6, -2.4, 0.9, 0.7], [-2.6, -2.4, 0.9, 0.7],
      ];
      for (const [px, pz, hx, hz] of pads) {
        const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, -0.3, pz));
        world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(0.8).setCollisionGroups(GROUND_GROUPS), g);
        m.bodies.push(g);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.6, hz * 2), matQ);
        deck.position.set(px, -0.3, pz);
        deck.receiveShadow = true;
        scene.add(deck);
        m.meshes.push(deck);
      }
      fazerCaixote(m, 0, 0);
      m.reset = () => resetCaixotes(m);
    },
  },
  {
    nome: 'GELO',
    build(m) {
      // Pista escorregadia: atrito quase zero + tração reduzida
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: texGelo, roughness: 0.15 }), 0.03);
      m.controle = 0.35;
      fazerCaixote(m, -2.8, 2.2);
      fazerCaixote(m, 2.8, -2.2);
      m.reset = () => resetCaixotes(m);
    },
  },
  {
    nome: 'MORTE SÚBITA',
    build(m) {
      // A plataforma encolhe a cada round
      const mat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 });
      let chao = null;
      let deck = null;
      let fator = 1;
      const criar = () => {
        if (chao) {
          world.removeRigidBody(chao);
          m.bodies.splice(m.bodies.indexOf(chao), 1);
        }
        chao = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(4.8 * fator, 0.3, 3.6 * fator).setFriction(0.8).setCollisionGroups(GROUND_GROUPS),
          chao,
        );
        m.bodies.push(chao);
        if (!deck) {
          deck = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.6, 7.2), mat);
          deck.position.y = -0.3;
          deck.receiveShadow = true;
          scene.add(deck);
          m.meshes.push(deck);
        }
        deck.scale.set(fator, 1, fator);
      };
      criar();
      fazerCaixote(m, -2, 2);
      fazerCaixote(m, 2, -2);
      m.reset = (novo) => {
        fator = novo ? 1 : Math.max(0.35, fator - 0.13);
        criar();
        resetCaixotes(m);
      };
    },
  },
  {
    nome: 'MARTELO',
    build(m) {
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // Braço giratório varrendo a arena na altura da cintura
      const poste = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.12, 0.75, 0.12).setTranslation(0, 0.45, 0).setCollisionGroups(GROUND_GROUPS),
        poste,
      );
      const braco = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(1.95, 0.62, 0).setAngularDamping(0).setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(1.55, 0.06, 0.06).setMass(8).setCollisionGroups(PROP_GROUPS),
        braco,
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(0.42).setTranslation(1.75, 0, 0).setMass(25).setCollisionGroups(PROP_GROUPS),
        braco,
      );
      const eixo = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: 0, y: 0.62, z: 0 }, { x: -1.95, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
        poste, braco, true,
      );
      if (eixo.configureMotorVelocity) eixo.configureMotorVelocity(1.15, 260);
      m.bodies.push(poste, braco);
      m.props.push(braco);
      const posteMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.25, 12), toonMat(THREE, 0x8a4f9e));
      posteMesh.position.y = 0.45;
      posteMesh.castShadow = true;
      scene.add(posteMesh);
      m.meshes.push(posteMesh);
      const bracoGrupo = new THREE.Group();
      const barra = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.13, 0.13), toonMat(THREE, 0x4a4a58));
      barra.castShadow = true;
      addOutline(THREE, barra);
      bracoGrupo.add(barra);
      const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), toonMat(THREE, 0xd63b30));
      cabeca.position.x = 1.75;
      cabeca.castShadow = true;
      addOutline(THREE, cabeca);
      bracoGrupo.add(cabeca);
      scene.add(bracoGrupo);
      m.meshes.push(bracoGrupo);
      m.syncPairs.push([braco, bracoGrupo]);
      m.reset = () => {
        braco.setTranslation({ x: 1.95, y: 0.62, z: 0 }, true);
        braco.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        braco.setLinvel({ x: 0, y: 0, z: 0 }, true);
        braco.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
    },
  },
  {
    nome: 'SUMÔ',
    semSoco: true,
    build(m) {
      // Ringue redondo que encolhe — sem soco: empurra, agarra e arremessa
      const mat = new THREE.MeshStandardMaterial({ map: texSumo, roughness: 0.8 });
      let chao = null;
      let deck = null;
      let fator = 1;
      const criar = () => {
        if (chao) {
          world.removeRigidBody(chao);
          m.bodies.splice(m.bodies.indexOf(chao), 1);
        }
        chao = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(0.3, 3.9 * fator).setFriction(0.9).setCollisionGroups(GROUND_GROUPS),
          chao,
        );
        m.bodies.push(chao);
        if (!deck) {
          deck = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.6, 44), mat);
          deck.position.y = -0.3;
          deck.receiveShadow = true;
          scene.add(deck);
          m.meshes.push(deck);
        }
        deck.scale.set(fator, 1, fator);
      };
      criar();
      m.reset = (novo) => {
        fator = novo ? 1 : Math.max(0.4, fator - 0.12);
        criar();
      };
    },
  },
  {
    nome: 'BATATA QUENTE',
    build(m) {
      chaoFixo(m, 4.6, 3.5, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // A bomba passa de mão em mão — some longe dela quando piscar!
      const bomba = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0).setLinearDamping(0.4).setAngularDamping(0.6),
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(0.24).setMass(3).setFriction(0.6).setRestitution(0.4).setCollisionGroups(PROP_GROUPS),
        bomba,
      );
      m.bodies.push(bomba);
      m.props.push(bomba);
      const bombaMat = toonMat(THREE, 0x232330);
      const bombaMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), bombaMat);
      bombaMesh.castShadow = true;
      addOutline(THREE, bombaMesh);
      const pavio = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), toonMat(THREE, 0xb98d43));
      pavio.position.y = 0.28;
      bombaMesh.add(pavio);
      scene.add(bombaMesh);
      m.meshes.push(bombaMesh);
      m.syncPairs.push([bomba, bombaMesh]);
      let proximaEm = null;
      m.update = (now) => {
        if (now === undefined) return;
        if (proximaEm === null) proximaEm = now + 6.5;
        const falta = proximaEm - now;
        const pisca = falta < 3 && Math.sin(now * (falta < 1.2 ? 34 : 11)) > 0;
        bombaMat.color.setHex(pisca ? 0xd63b30 : 0x232330);
        if (falta <= 0) {
          proximaEm = now + 6.5;
          const bp = bomba.translation();
          for (const l of lutadores) {
            const tp = l.rag.parts.torso.translation();
            const d = Math.hypot(tp.x - bp.x, tp.y - bp.y, tp.z - bp.z);
            if (d < 2.4) {
              const k = (1 - d / 2.4) * 14;
              const dl = Math.hypot(tp.x - bp.x, tp.z - bp.z) || 1;
              for (const pn of ['torso', 'pelvis']) {
                l.rag.parts[pn].applyImpulse({ x: ((tp.x - bp.x) / dl) * k, y: k * 0.5, z: ((tp.z - bp.z) / dl) * k }, true);
              }
              l.rag.releaseGrabs();
              l.rag.stun(now + 1.2);
              l.rag.dano = Math.min(4, l.rag.dano + 1);
            }
          }
          som.bolada();
          trauma = 1;
          burstEstrelas(bp);
          puffFx({ x: bp.x, y: bp.y + 0.6, z: bp.z });
          bomba.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
          bomba.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      };
      m.reset = () => {
        proximaEm = null;
        bomba.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
        bomba.setLinvel({ x: 0, y: 0, z: 0 }, true);
        bomba.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
    },
  },
  {
    nome: 'CIDADE',
    fundo: 'assets/fundo-cidade.jpg',
    build(m) {
      // Robôs gigantes na cidade: os prédios são pilhas de blocos com
      // física — desabam, voam com socos e viram armas
      const asfalto = (() => {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 384;
        const g = c.getContext('2d');
        g.fillStyle = '#3a3d46';
        g.fillRect(0, 0, 512, 384);
        g.strokeStyle = '#f2d16b';
        g.lineWidth = 6;
        g.setLineDash([26, 22]);
        g.beginPath(); g.moveTo(0, 192); g.lineTo(512, 192); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = '#565963';
        g.lineWidth = 3;
        for (const x of [128, 384]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 384); g.stroke(); }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      chaoFixo(m, 6, 4.5, new THREE.MeshStandardMaterial({ map: asfalto, roughness: 0.92 }));
      for (const [bx, bz, alt] of [[-4.4, -3, 5], [4.4, -3, 5], [-4.4, 3, 4], [4.4, 3, 4], [0, -3.6, 3]]) {
        predio(m, bx, bz, alt);
      }
      m.reset = () => resetBlocos(m);
    },
  },
  {
    nome: 'RIO',
    fundo: 'assets/fundo-rio.png',
    build(m) {
      // Atmosfera de pôr-do-sol (casa com a pintura do fundo): luz dourada,
      // rim quente, neblina de haze que funde o morro 3D no fundo 2D.
      hemi.color.setHex(0xffe6c4); hemi.groundColor.setHex(0x4a3a2a); hemi.intensity = 0.92;
      rim.color.setHex(0xffc98a); rim.intensity = 0.7; rim.position.set(7, 4, 6);
      sun.color.setHex(0xffd39a); sun.intensity = 1.5; sun.position.set(11, 8, 3);
      scene.fog.color.setHex(0xf2d9b8); scene.fog.near = 15; scene.fog.far = 46;
      r3.toneMappingExposure = 1.16;
      // Colisor/fundo submerso (os lutadores pisam aqui, na agua)
      chaoFixo(m, 7, 5.5, new THREE.MeshStandardMaterial({ color: 0x0e3a4f, roughness: 0.5 }));
      // OCEANO no MEIO: superficie glossy com profundidade (centro fundo, beira
      // rasa/turquesa) + ondas que fazem o brilho do sol dançar (normais por frame)
      const gA = new THREE.PlaneGeometry(15, 12, 64, 48);
      const posA = gA.attributes.position;
      const corA = new Float32Array(posA.count * 3);
      const cFundo = new THREE.Color(0x1a6f89).convertSRGBToLinear(); // profundo (claro o bastante p/ ver a luta)
      const cRaso = new THREE.Color(0x46bccb).convertSRGBToLinear();  // raso turquesa
      const tmpC = new THREE.Color();
      for (let i = 0; i < posA.count; i++) {
        const d = Math.min(1, Math.hypot(posA.getX(i) / 7.5, posA.getY(i) / 6)); // 0 centro -> 1 beira
        tmpC.copy(cFundo).lerp(cRaso, d * 1.15);
        corA[i * 3] = tmpC.r; corA[i * 3 + 1] = tmpC.g; corA[i * 3 + 2] = tmpC.b;
      }
      gA.setAttribute('color', new THREE.BufferAttribute(corA, 3));
      const agua = new THREE.Mesh(gA, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.13, metalness: 0.32, transparent: true, opacity: 0.94,
        emissive: 0x14323d, emissiveIntensity: 0.18,
      }));
      agua.rotation.x = -Math.PI / 2; agua.position.y = 0.06; agua.receiveShadow = true;
      m.aguaY = 0.06; // superfície da água (pra splash de nocaute ao cair no mar)
      scene.add(agua); m.meshes.push(agua);
      const baseA = posA.array.slice();
      m.update = (t) => {
        const pp = gA.attributes.position;
        for (let i = 0; i < pp.count; i++) {
          const x = baseA[i * 3], y = baseA[i * 3 + 1];
          pp.array[i * 3 + 2] = Math.sin(x * 0.9 + t * 1.7) * 0.06 + Math.cos(y * 1.0 + t * 1.3) * 0.05
            + Math.sin((x + y) * 2.1 + t * 2.6) * 0.02;
        }
        pp.needsUpdate = true;
        gA.computeVertexNormals(); // ondas mexem o brilho do sol na água
      };
      // MORRO detalhado (diorama) emoldurando a arena
      new GLTFLoader().load(ASSET('assets/modelos/rio-cenario.glb'), (gltf) => {
        const s = gltf.scene;
        const box = new THREE.Box3().setFromObject(s);
        const size = new THREE.Vector3(); box.getSize(size);
        s.scale.setScalar(16 / Math.max(size.x, size.z));
        const b2 = new THREE.Box3().setFromObject(s);
        s.position.set(0, -b2.min.y - 2.4, -2);
        // Morro coerente (não arco-íris): usa a INCLINAÇÃO de cada face.
        //  - face vertical (parede) => cor de casa de favela (tom terroso), por célula
        //  - face horizontal (topo/chão) => mata verde, às vezes telhado terracota
        const casas = [0xb5651d, 0xd9a441, 0x6fa8a0, 0xc98a8a, 0xe8dcc0, 0x7a9cc0, 0xd98a6a, 0xcbb892]
          .map((h) => new THREE.Color(h).convertSRGBToLinear());   // tons de favela, suaves
        const verdes = [0x3f6b2e, 0x4f7a3a, 0x5c8a44, 0x34611f]
          .map((h) => new THREE.Color(h).convertSRGBToLinear());   // mata
        const terra = new THREE.Color(0x9c6b4a).convertSRGBToLinear(); // telhado/terra
        const hash = (i) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
        const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
        const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
        s.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true;
          let g = o.geometry; if (g.index) g = g.toNonIndexed(); // 1 cor por triangulo
          g.computeBoundingBox();
          const bb = g.boundingBox, sz = new THREE.Vector3(); bb.getSize(sz);
          const cel = Math.max(sz.x, sz.z) / 13 || 1;   // manchas grandes = casas inteiras
          const celY = Math.max(0.001, sz.y / 5);
          const pos = g.attributes.position, n = pos.count;
          const col = new Float32Array(n * 3);
          for (let f = 0; f < n; f += 3) {
            A.fromBufferAttribute(pos, f); B.fromBufferAttribute(pos, f + 1); C.fromBufferAttribute(pos, f + 2);
            e1.subVectors(B, A); e2.subVectors(C, A); nrm.crossVectors(e1, e2).normalize();
            const ny = Math.abs(nrm.y); // 1=horizontal (topo/chão), 0=vertical (parede)
            const cx = Math.floor(((A.x + B.x + C.x) / 3 - bb.min.x) / cel);
            const cy = Math.floor(((A.y + B.y + C.y) / 3 - bb.min.y) / celY);
            const cz = Math.floor(((A.z + B.z + C.z) / 3 - bb.min.z) / cel);
            const id = Math.abs((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791));
            const h = hash(id);
            let c;
            if (ny < 0.5) {                          // parede => casa colorida (por célula)
              c = casas[Math.floor(h * casas.length) % casas.length];
            } else {                                 // topo/chão => mata verde, às vezes telhado
              c = h < 0.7 ? verdes[Math.floor(hash(id * 1.7) * verdes.length) % verdes.length] : terra;
            }
            const br = 0.88 + hash(id * 3.3) * 0.18;
            for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r * br; col[(f + k) * 3 + 1] = c.g * br; col[(f + k) * 3 + 2] = c.b * br; }
          }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          g.computeVertexNormals();
          o.geometry = g;
          o.material = new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true,
          });
        });
        scene.add(s); m.meshes.push(s);

        // VEGETAÇÃO decorativa (sem física): plantada NA superfície do morro via
        // raycast pra baixo (acha a altura real de cada ponto, nada flutua).
        const ray = new THREE.Raycaster();
        const BAIXO = new THREE.Vector3(0, -1, 0);
        const alturaMorro = (x, z) => {
          ray.set(new THREE.Vector3(x, 30, z), BAIXO);
          const hit = ray.intersectObject(s, true);
          return hit.length ? hit[0].point.y : null;
        };
        const hs = (i) => { const v = Math.sin(i * 91.7) * 43758.5453; return v - Math.floor(v); };
        // arbustos low-poly (icosaedro achatado, verde)
        const geoMato = new THREE.IcosahedronGeometry(1, 0);
        const matsMato = [0x3f6b2e, 0x4f7a3a, 0x5c8a44].map((h) => new THREE.MeshStandardMaterial({ color: h, roughness: 1, flatShading: true }));
        const spotsMato = [[-6.4, -2.2], [-5.6, -4.0], [-7.0, 0.6], [-4.2, -4.8], [6.2, -2.0], [5.6, -4.1], [6.8, 0.8], [4.2, -4.8], [-2.6, -5.4], [2.6, -5.4], [0.2, -5.7], [-6.9, -1.0], [6.7, -1.2]];
        spotsMato.forEach(([x, z], i) => {
          const y = alturaMorro(x, z); if (y === null) return;
          const r = 0.28 + hs(i) * 0.34;
          const mt = new THREE.Mesh(geoMato, matsMato[i % matsMato.length]);
          mt.scale.set(r, r * (0.7 + hs(i * 2) * 0.5), r);
          mt.position.set(x, y + r * 0.3, z);
          mt.rotation.y = hs(i * 3) * 6.28; mt.castShadow = true; mt.receiveShadow = true;
          scene.add(mt); m.meshes.push(mt);
        });
        // palmeiras (clonadas do modelo low-poly)
        new GLTFLoader().load(ASSET('assets/modelos/palmeira-low.glb'), (gp) => {
          const proto = gp.scene;
          const pb = new THREE.Box3().setFromObject(proto), ps = new THREE.Vector3(); pb.getSize(ps);
          proto.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          const spots = [[-6.6, -1.4], [-5.8, -3.8], [-7.1, 1.2], [6.4, -1.2], [5.7, -3.7], [6.9, 1.3], [-3.6, -5.1], [3.6, -5.1], [0, -5.6]];
          spots.forEach(([x, z], i) => {
            const y = alturaMorro(x, z); if (y === null) return;
            const esc = (2.5 + hs(i * 5) * 1.1) / (ps.y || 1);
            const p = proto.clone(true);
            p.scale.setScalar(esc);
            p.position.set(x, y - pb.min.y * esc, z);
            p.rotation.y = hs(i * 7) * 6.28;
            scene.add(p); m.meshes.push(p);
          });
        });
      });
      // CASAS destrutiveis (mistura dos 4 modelos, coloridas) nas BORDAS/pe do morro
      const cores = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4d96ff, 0xf78fb3, 0xffa552, 0xf4f4f4];
      const carregarGeo = (arq) => new Promise((res) => {
        new GLTFLoader().load(ASSET(arq), (g) => {
          let geo = null; g.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
          if (!geo) { res(null); return; }
          geo = geo.clone(); geo.center(); geo.computeVertexNormals(); geo.computeBoundingBox();
          res(geo);
        }, undefined, () => res(null));
      });
      Promise.all(['casa-low', 'casa-b', 'casa-c', 'casa-d'].map((n) => carregarGeo('assets/modelos/' + n + '.glb'))).then((gs) => {
        const info = gs.filter(Boolean).map((geo) => { const z = new THREE.Vector3(); geo.boundingBox.getSize(z); return { geo, esc: 0.6 / Math.max(z.x, z.z), h: z.y * (0.6 / Math.max(z.x, z.z)) }; });
        if (!info.length) return;
        let ci = 0, pick = 0;
        const torre = (px, pz, alt) => {
          let y = 0;
          for (let a = 0; a < alt; a++) {
            const it = info[pick++ % info.length];
            const yy = y + it.h * 0.5;
            const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, yy, pz).setLinearDamping(0.2).setAngularDamping(0.4));
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, it.h * 0.5, 0.3).setMass(3).setFriction(0.9).setCollisionGroups(PROP_GROUPS), rb);
            const me = new THREE.Mesh(it.geo, new THREE.MeshStandardMaterial({ color: cores[ci++ % cores.length], roughness: 0.85 }));
            me.scale.setScalar(it.esc); me.castShadow = true; me.receiveShadow = true; scene.add(me);
            m.bodies.push(rb); m.meshes.push(me); m.syncPairs.push([rb, me]); m.props.push(rb); m._blocos.push([rb, px, yy, pz]);
            y += it.h;
          }
        };
        // bordas laterais + fundo (deixa o meio livre pra agua/luta)
        const pos = [[-5.6,-4,3],[-6.1,-2,2],[-6.3,0,3],[-6.1,2,2],[-5.6,4,3],
                     [5.6,-4,3],[6.1,-2,2],[6.3,0,3],[6.1,2,2],[5.6,4,3],
                     [-3,-5,2],[-1,-5.6,3],[1,-5.6,2],[3,-5,3]];
        for (const [x,z,a] of pos) torre(x, z, a);
        m.reset = () => resetBlocos(m);
      });
    },
  },
];

let mapaIdx = 0;
let mapa = null;
function setMapa(idx) {
  if (mapa) {
    for (const b of mapa.bodies) world.removeRigidBody(b);
    for (const me of mapa.meshes) scene.remove(me);
  }
  mapaIdx = ((idx % MAPAS.length) + MAPAS.length) % MAPAS.length;
  mapa = { bodies: [], meshes: [], syncPairs: [], props: [], bolas: [], armas: [], _caixotes: [], _blocos: [], reset: null, update: null };
  proxArmaEm = 0; // reinicia o cronômetro de drop de armas
  // Restaura o ambiente padrao (um mapa pode sobrescrever luz/ceu/neblina no build)
  backMesh.visible = true;
  scene.background = new THREE.Color(0x141433);
  restaurarAmbiente();
  MAPAS[mapaIdx].build(mapa);
  mapa.semSoco = !!MAPAS[mapaIdx].semSoco;
  setFundo(MAPAS[mapaIdx].fundo ?? 'assets/fundo.jpg');
  for (const l of lutadores) {
    l.rag.props = mapa.props;
    l.rag.controle = mapa.controle ?? 1;
    l.rag.reset();
    l.vivo = true;
  }
  const el = document.getElementById('mapa');
  if (el) el.textContent = 'MAPA: ' + MAPAS[mapaIdx].nome;
}

// ---------- Show de luzes e confete ----------
const holofotes = [];
{
  const geoCone = new THREE.ConeGeometry(2.4, 15, 20, 1, true);
  geoCone.translate(0, -7.5, 0);
  const matCone = new THREE.MeshBasicMaterial({
    color: 0xffe9b0, transparent: true, opacity: 0.085,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  for (const [tx, ty, tz] of [[-11, 11, -7], [11, 11, -7], [-8, 12, 6], [8, 12, 6]]) {
    const g = new THREE.Group();
    g.position.set(tx, ty, tz);
    g.add(new THREE.Mesh(geoCone, matCone));
    scene.add(g);
    holofotes.push(g);
  }
}
const _dirHolofote = new THREE.Vector3();
const _baixo = new THREE.Vector3(0, -1, 0);
function mirarHolofotes(t) {
  holofotes.forEach((h, i) => {
    _dirHolofote.set(Math.sin(t * 0.5 + i * 1.7) * 3.2, 0, Math.cos(t * 0.4 + i * 2.1) * 2.2)
      .sub(h.position).normalize();
    h.quaternion.setFromUnitVectors(_baixo, _dirHolofote);
  });
}

const confetes = [];
{
  const paleta = [0xff5b8d, 0x59c8ff, 0xffd94a, 0x8dff70, 0xc792ff];
  const geoC = new THREE.PlaneGeometry(0.09, 0.14);
  const matsC = paleta.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  const rnd = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(geoC, matsC[i % paleta.length]);
    m.position.set(rnd(i, 1) * 30 - 15, rnd(i, 2) * 13 + 2, rnd(i, 3) * 24 - 19);
    m.rotation.set(rnd(i, 4) * 6, rnd(i, 5) * 6, 0);
    m._v = 0.35 + rnd(i, 6) * 0.5;
    m._f = rnd(i, 7) * 6.3;
    scene.add(m);
    confetes.push(m);
  }
}
function cairConfetes(dt, t) {
  for (const m of confetes) {
    m.position.y -= m._v * dt;
    m.position.x += Math.sin(t * 1.3 + m._f) * 0.3 * dt;
    m.rotation.x += 1.2 * dt;
    m.rotation.y += 1.7 * dt;
    if (m.position.y < -1) m.position.y = 14;
  }
}

// ---------- Visual dos bonecos ----------
const CATEGORIA = {
  head: 'head', torso: 'torso', pelvis: 'pelvis',
  upperArmL: 'arms', upperArmR: 'arms', forearmL: 'arms', forearmR: 'arms',
  thighL: 'legs', thighR: 'legs', calfL: 'legs', calfR: 'legs',
};
const FOFURA = { arms: 1.6, legs: 1.55 };
// Estilos de personagem em teste (?estilo=a|b|c|d):
// a=feijão vinil · b=chibi cabeçudo · c=massinha articulada · d=cartum chapado
let ESTILO = PARAMS.get('estilo') || 'a';   // 'let': a tecla M alterna em runtime
const ESTILO_BASE = ESTILO;                 // estilo original (pra voltar ao desligar o 3D)
// ?glb=NOME escolhe o modelo 3D do estilo 'g' (assets/modelos/NOME.glb)
const MODELO_GLB = PARAMS.get('glb') || 'jaeger-low';

function clarear(cor, t) {
  const f = (v) => Math.round(v + (255 - v) * t);
  return (f((cor >> 16) & 255) << 16) | (f((cor >> 8) & 255) << 8) | f(cor & 255);
}
function escurecer(cor, t) {
  const f = (v) => Math.round(v * (1 - t));
  return (f((cor >> 16) & 255) << 16) | (f((cor >> 8) & 255) << 8) | f(cor & 255);
}
// Puxa a cor pra um tom pastel apagado (estilo Gang Beasts)
function dessaturar(cor, t) {
  const r = (cor >> 16) & 255, g = (cor >> 8) & 255, b = cor & 255;
  const cinza = 0.3 * r + 0.59 * g + 0.11 * b;
  const f = (v) => Math.round(v + (cinza - v) * t + 18);
  return (Math.min(255, f(r)) << 16) | (Math.min(255, f(g)) << 8) | Math.min(255, f(b));
}

function buildVisual(skin, fase = 0, slot = 0) {
  const meshes = { _skin: skin, _fase: fase };
  const mats = {};
  // Fábrica de materiais por estilo
  const mkMat = (color) => {
    if (ESTILO === 'c') return new THREE.MeshStandardMaterial({ color: clarear(color, 0.12), roughness: 0.8 });
    if (ESTILO === 'f') return new THREE.MeshStandardMaterial({ color: dessaturar(color, 0.32), roughness: 0.88 });
    if (ESTILO === 'd') return toonMat(THREE, color);
    if (ESTILO === 'm') { // mech metálico: aço tingido pela cor do lutador
      const aco = new THREE.Color(0x8b95a4).lerp(new THREE.Color(color), 0.28);
      return new THREE.MeshStandardMaterial({ color: aco, metalness: 0.85, roughness: 0.38, emissive: new THREE.Color(color).multiplyScalar(0.12) });
    }
    return vinilMat(THREE, color, 1);
  };
  const contorno = (m, esc = 1.035) => (ESTILO === 'c' || ESTILO === 'f' || ESTILO === 'm' ? m : addOutline(THREE, m, ESTILO === 'd' ? 1.055 : esc));
  const matFor = (cat) => mats[cat] ||= mkMat(skin.cores[cat]);
  const bolinha = (mat, r, escala) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
    if (escala) b.scale.set(...escala);
    b.castShadow = true;
    contorno(b);
    return b;
  };
  const fazFace = (r) => new THREE.Mesh(
    new THREE.CircleGeometry(r, 28),
    new THREE.MeshBasicMaterial({ map: getFaceTexture(THREE, skin.face, 'ok'), transparent: true }),
  );
  const fazTexTorso = () => {
    skin._texTorso ||= (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      skin.texturaTorso(c.getContext('2d'));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const m = mkMat(0xffffff);
    m.map = skin._texTorso;
    return m;
  };
  const CHIBI = ESTILO === 'b';
  const GB = ESTILO === 'f';
  const MECH = ESTILO === 'm';
  const ARTIC = ESTILO === 'c' || GB || MECH;

  // Estilo G (protótipo): modelo 3D profissional (GLB) colado na física
  if (ESTILO === 'g') {
    for (const spec of PARTS) {
      let obj;
      if (spec.name === 'torso') {
        obj = new THREE.Group();
        obj._baseS = [1, 1, 1];
        // ?glb aceita lista por lutador (ex.: jaeger,kaiju); cai no 1o se faltar
        const nomesGLB = MODELO_GLB.split(',');
        const nomeGLB = (nomesGLB[slot] || nomesGLB[0] || 'robo').trim();
        new GLTFLoader().load(ASSET('assets/modelos/' + nomeGLB + '.glb'), (gltf) => {
          const modelo = gltf.scene;
          // Auto-encaixe: escala pra ~2.33 de altura e ancora o tronco a
          // ~55% dos pés (funciona com qualquer GLB, não só o robo).
          const box = new THREE.Box3().setFromObject(modelo);
          const size = new THREE.Vector3(), center = new THREE.Vector3();
          box.getSize(size); box.getCenter(center);
          const alvoH = 2.33, torsoFrac = 0.55;
          const s = alvoH / (size.y || 1);
          modelo.scale.setScalar(s);
          modelo.position.set(-center.x * s, -(box.min.y * s) - torsoFrac * alvoH, -center.z * s);
          const tinta = new THREE.Color(skin.cores.torso);
          modelo.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.material = o.material.clone();
              o.material.color.lerp(tinta, 0.4);
            }
          });
          obj.add(modelo);
          registrarFlashMats(meshes); // materiais do GLB chegam async
        });
      } else {
        obj = new THREE.Group();
      }
      scene.add(obj);
      meshes[spec.name] = obj;
    }
    return meshes;
  }

  // Estilo R (rigado de verdade): esqueleto de 11 ossos + SkinnedMesh. A malha
  // continua INTEIRA (igual ao modelo) e deforma suave nas juntas — sem pedaço
  // solto. Os ossos são dirigidos pela física, então soco/chute articulam.
  if (ESTILO === 'r') {
    const nbr = {
      pelvis: ['torso', 'thighL', 'thighR'], torso: ['pelvis', 'head', 'upperArmL', 'upperArmR'],
      head: ['torso'], upperArmL: ['torso', 'forearmL'], upperArmR: ['torso', 'forearmR'],
      forearmL: ['upperArmL'], forearmR: ['upperArmR'], thighL: ['pelvis', 'calfL'],
      thighR: ['pelvis', 'calfR'], calfL: ['thighL'], calfR: ['thighR'],
    };
    const idxDe = {}; PARTS.forEach((p, i) => { idxDe[p.name] = i; });
    const anchors = PARTS.map((p) => new THREE.Vector3(p.off[0], p.off[1], p.off[2]));
    // Ossos planos sob uma raiz na origem — syncVisual dirige cada osso pela física.
    const rootBones = new THREE.Group(); scene.add(rootBones);
    const bones = PARTS.map((p) => { const b = new THREE.Bone(); b.position.set(p.off[0], p.off[1], p.off[2]); rootBones.add(b); return b; });
    rootBones.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(bones);
    PARTS.forEach((p, i) => { meshes[p.name] = bones[i]; }); // syncVisual move os ossos
    meshes.torso._baseS = [1, 1, 1];
    meshes._rootBones = rootBones; meshes._skel = skel; meshes._skinMeshes = []; meshes._flashExtra = [];
    const nomesGLB = MODELO_GLB.split(',');
    const nomeGLB = (nomesGLB[slot] || nomesGLB[0] || 'jaeger-low').trim();
    const tinta = new THREE.Color(skin.cores.torso);
    new GLTFLoader().load(ASSET('assets/modelos/' + nomeGLB + '.glb'), (gltf) => {
      const modelo = gltf.scene; modelo.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelo);
      const size = new THREE.Vector3(), center = new THREE.Vector3();
      box.getSize(size); box.getCenter(center);
      const RH = 1.68, pesY = 0.08;                       // altura útil pé->cabeça do ragdoll
      const s = RH / (size.y || 1);
      const offX = -center.x * s, offZ = -center.z * s, offY = pesY - box.min.y * s;
      const v = new THREE.Vector3(), nv = new THREE.Vector3();
      // pesos: osso mais próximo (primary) + vizinho de junta mais próximo (secondary),
      // misturando só perto da junta — dá dobra suave sem soltar pedaço.
      const pesar = (vx, vy, vz) => {
        let p0 = 0, d0 = 1e9;
        for (let i = 0; i < anchors.length; i++) { const a = anchors[i], dx = vx - a.x, dy = vy - a.y, dz = vz - a.z, d = dx * dx + dy * dy + dz * dz; if (d < d0) { d0 = d; p0 = i; } }
        let p1 = p0, d1 = 1e9;
        for (const nm of nbr[PARTS[p0].name]) { const i = idxDe[nm], a = anchors[i], dx = vx - a.x, dy = vy - a.y, dz = vz - a.z, d = dx * dx + dy * dy + dz * dz; if (d < d1) { d1 = d; p1 = i; } }
        const dp = Math.sqrt(d0), dq = Math.sqrt(d1) || 1e-4;
        const w1 = Math.min(1, Math.max(0.5, dq / (dp + dq))); // primary mantém a maioria (meio do membro fica rígido)
        return [p0, p1, w1, 1 - w1];
      };
      modelo.traverse((o) => {
        if (!o.isMesh) return;
        const g0 = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        const pos = g0.attributes.position, nor = g0.attributes.normal, uv = g0.attributes.uv;
        const n = pos.count;
        const P = new Float32Array(n * 3), N = nor ? new Float32Array(n * 3) : null;
        const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
        const nmat = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).multiplyScalar(s);
          v.x += offX; v.y += offY; v.z += offZ;
          P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
          if (N) { nv.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize(); N[i * 3] = nv.x; N[i * 3 + 1] = nv.y; N[i * 3 + 2] = nv.z; }
          const [a, b, w1, w2] = pesar(v.x, v.y, v.z);
          SI[i * 4] = a; SI[i * 4 + 1] = b; SW[i * 4] = w1; SW[i * 4 + 1] = w2;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
        if (N) geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else geo.computeVertexNormals();
        if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv.array), 2));
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
        const src = Array.isArray(o.material) ? o.material[0] : o.material;
        const mat = src.clone(); if (mat.color) mat.color.lerp(tinta, 0.4);
        const sm = new THREE.SkinnedMesh(geo, mat);
        sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
        sm.bind(skel);
        scene.add(sm); meshes._skinMeshes.push(sm); meshes._flashExtra.push(sm);
      });
      registrarFlashMats(meshes);
    });
    return meshes;
  }

  // Estilo J (Jaeger rigado): usa um GLB JÁ RIGADO (esqueleto + skin do Meshy).
  // Cada osso do Meshy segue rigidamente o corpo da física correspondente; os
  // pesos de skin do próprio modelo suavizam as juntas → malha inteira, sem solto.
  if (ESTILO === 'j') {
    for (const spec of PARTS) { const o = new THREE.Object3D(); scene.add(o); meshes[spec.name] = o; }
    meshes.torso._baseS = [1, 1, 1];
    meshes._jrig = null;
    const nomesGLB = MODELO_GLB.split(',');
    let nomeGLB = (nomesGLB[slot] || nomesGLB[0] || '').trim();
    if (!nomeGLB || nomeGLB === 'jaeger-low') nomeGLB = 'jaeger-rigado'; // 'j' precisa de um GLB rigado
    const tinta = new THREE.Color(skin.cores.torso);
    // De qual corpo da física cada osso do esqueleto Meshy segue:
    const BONE2BODY = {
      Hips: 'pelvis', Spine: 'torso', Spine01: 'torso', Spine02: 'torso',
      neck: 'head', Head: 'head', head_end: 'head', headfront: 'head',
      LeftShoulder: 'torso', LeftArm: 'upperArmL', LeftForeArm: 'forearmL', LeftHand: 'forearmL',
      RightShoulder: 'torso', RightArm: 'upperArmR', RightForeArm: 'forearmR', RightHand: 'forearmR',
      LeftUpLeg: 'thighL', LeftLeg: 'calfL', LeftFoot: 'calfL', LeftToeBase: 'calfL',
      RightUpLeg: 'thighR', RightLeg: 'calfR', RightFoot: 'calfR', RightToeBase: 'calfR',
    };
    new GLTFLoader().load(ASSET('assets/modelos/' + nomeGLB + '.glb'), (gltf) => {
      const armature = gltf.scene; let skinned = null, skeleton = null;
      armature.traverse((o) => {
        if (o.isSkinnedMesh) { skinned = o; skeleton = o.skeleton; }
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          if (src && src.map) {
            // modelo tem textura: preserva, só deixa metálico e tinge de leve
            o.material = src.clone(); o.material.metalness = 0.5; o.material.roughness = 0.5;
            if (o.material.color) o.material.color.lerp(tinta, 0.28);
          } else {
            // sem textura (caso do jaeger-rigado): aço tingido pela cor do jogador
            o.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(0x8b95a6).lerp(tinta, 0.5),
              metalness: 0.6, roughness: 0.48,
              emissive: new THREE.Color(tinta).multiplyScalar(0.06),
            });
          }
        }
      });
      if (!skinned) { console.log('estilo j: GLB sem SkinnedMesh (não rigado)'); return; }
      armature.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(skinned), sz = new THREE.Vector3(); box.getSize(sz);
      armature.scale.setScalar(1.9 / (sz.y || 1)); // altura alvo ~1.9
      scene.add(armature); armature.updateMatrixWorld(true);
      // bindOffset por osso = inverse(corpo em repouso) * osso no bind (tudo em world/metros)
      const q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      const driven = [];
      for (const bone of skeleton.bones) {
        const bn = BONE2BODY[bone.name]; if (!bn) continue;
        const spec = PARTS.find((p) => p.name === bn);
        const restInv = new THREE.Matrix4().compose(new THREE.Vector3(spec.off[0], spec.off[1], spec.off[2]), q0, one).invert();
        const off = new THREE.Matrix4().multiplyMatrices(restInv, bone.matrixWorld);
        driven.push({ bone, body: bn, off, root: bone.name === 'Hips' });
      }
      meshes._armature = armature;
      meshes._jrig = { armature, skinned, skeleton, driven };
      meshes._flashExtra = [skinned]; registrarFlashMats(meshes);
    });
    return meshes;
  }

  // Estilo E (protótipo): a ilustração da API é o personagem — sprite
  // de corpo inteiro colado na física (tomba, gira e amassa junto)
  if (ESTILO === 'e') {
    for (const spec of PARTS) {
      let obj;
      if (spec.name === 'torso') {
        const tex = new THREE.TextureLoader().load(ASSET('assets/papel/tubarao-corpo.png'));
        tex.colorSpace = THREE.SRGBColorSpace;
        obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        obj.center.set(0.5, 0.6);
        obj._baseS = [2.1, 2.1, 1];
        obj.scale.set(2.1, 2.1, 1);
        meshes._sprite = obj;
      } else {
        obj = new THREE.Group();
      }
      scene.add(obj);
      meshes[spec.name] = obj;
    }
    return meshes;
  }

  for (const spec of PARTS) {
    let obj;
    if (spec.name === 'torso') {
      const matBean = skin.texturaTorso ? fazTexTorso() : matFor('torso');
      if (ARTIC) {
        // corpo articulado gordo (barril; GB com ombros redondos)
        obj = new THREE.Mesh(new THREE.CapsuleGeometry(GB ? 0.21 : 0.2, GB ? 0.2 : 0.18, 8, 18), matBean);
        obj._baseS = GB ? [1.18, 1.05, 0.98] : [1.22, 1.08, 0.95];
        if (GB) {
          for (const lado of [-1, 1]) {
            const ombro = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), matBean);
            ombro.position.set(lado * 0.18, 0.16, 0);
            obj.add(ombro);
          }
        }
      } else if (CHIBI) {
        // corpinho pequeno (a cabeça gigante é a estrela)
        const geo = new THREE.CapsuleGeometry(0.26, 0.3, 8, 20);
        geo.translate(0, -0.16, 0);
        obj = new THREE.Mesh(geo, matBean);
        obj._baseS = [1, 1, 0.9];
      } else {
        // feijão único
        const geo = new THREE.CapsuleGeometry(0.34, 0.56, 8, 24);
        geo.translate(0, -0.1, 0);
        obj = new THREE.Mesh(geo, matBean);
        obj._baseS = [1, 1.05, 0.92];
      }
      obj.scale.set(...obj._baseS);
      obj.castShadow = true;
      contorno(obj, 1.03);
      if (!CHIBI && !ARTIC) {
        const face = fazFace(0.21);
        face.position.set(0, 0.16, 0.325);
        face.rotation.x = -0.12;
        obj.add(face);
        meshes._face = face;
      }
      if (!skin.semBarriga) {
        const corBarriga = skin.cores.barriga ?? clarear(skin.cores.torso, 0.38);
        const barriga = new THREE.Mesh(new THREE.SphereGeometry(ARTIC ? 0.16 : CHIBI ? 0.18 : 0.24, 20, 16), mkMat(corBarriga));
        barriga.position.set(0, -0.12, ARTIC ? 0.1 : CHIBI ? 0.12 : 0.15);
        barriga.scale.set(0.85, 1.05, 0.55);
        obj.add(barriga);
      }
    } else if (spec.shape === 'ball') {
      obj = new THREE.Group();
      if (ARTIC || CHIBI) {
        // cabeça visível (chibi GIGANTE; gang beasts pequena e afundada)
        obj.scale.setScalar(CHIBI ? 1.9 : GB ? 1.18 : 1.5);
        const skull = bolinha(matFor('head'), spec.r, [1, GB ? 1.06 : 1.02, 0.96]);
        skull.position.y = CHIBI ? -0.05 : GB ? -0.11 : -0.03;
        obj.add(skull);
        const face = fazFace(spec.r * (GB ? 0.72 : 0.95));
        face.position.set(0, CHIBI ? -0.06 : GB ? -0.12 : -0.03, spec.r + 0.004);
        obj.add(face);
        meshes._face = face;
        if (ARTIC) {
          const pescoco = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.125, 0.16, 12), matFor('head'));
          pescoco.position.y = -0.15;
          obj.add(pescoco);
        }
        meshes._headAnchor = obj;
      } else {
        // feijão: cabeça invisível, só âncora de chapéus
        obj.scale.setScalar(1.5);
        const ancora2 = new THREE.Group();
        ancora2.position.y = -0.14;
        obj.add(ancora2);
        meshes._headAnchor = ancora2;
      }
    } else if (spec.name === 'pelvis') {
      if (ARTIC) {
        obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.12, 8, 18), matFor('pelvis'));
        obj.scale.set(1.3, 1.0, 1.1);
        obj.castShadow = true;
        contorno(obj);
      } else {
        obj = new THREE.Group();
      }
    } else if (spec.name.startsWith('upperArm') || spec.name.startsWith('thigh')) {
      if (ARTIC) {
        const cat = CATEGORIA[spec.name];
        const gordo = spec.r * FOFURA[cat];
        obj = new THREE.Mesh(new THREE.CapsuleGeometry(gordo, spec.hh * 2, 6, 14), matFor(cat));
        obj.castShadow = true;
        contorno(obj);
        for (const py of [spec.hh, -spec.hh]) {
          const cap = bolinha(matFor(cat), gordo * (GB ? 1.0 : 1.12));
          cap.position.y = py;
          obj.add(cap);
        }
      } else {
        obj = new THREE.Group();
      }
    } else if (spec.name.startsWith('forearm')) {
      const grosso = ARTIC ? spec.r * FOFURA.arms : 0.09;
      obj = new THREE.Mesh(new THREE.CapsuleGeometry(grosso, ARTIC ? spec.hh * 2 : 0.16, 6, 12), matFor('arms'));
      obj.castShadow = true;
      contorno(obj);
      const mao = bolinha(mats.maos ||= mkMat(escurecer(skin.cores.arms, GB ? 0.08 : 0.22)), ARTIC ? spec.r * (GB ? 1.6 : 1.9) : 0.13);
      mao.position.y = ARTIC ? -(spec.hh + spec.r * 0.55) : -0.14;
      obj.add(mao);
    } else {
      // calf
      let geoPerna;
      if (ARTIC) {
        geoPerna = new THREE.CapsuleGeometry(spec.r * FOFURA.legs, spec.hh * 2, 6, 12);
      } else {
        geoPerna = new THREE.CapsuleGeometry(0.1, 0.34, 6, 12);
        geoPerna.translate(0, 0.09, 0);
      }
      obj = new THREE.Mesh(geoPerna, matFor('legs'));
      obj.castShadow = true;
      contorno(obj);
      const pe = new THREE.Mesh(
        new THREE.CapsuleGeometry(ARTIC ? 0.082 : 0.095, 0.1, 6, 12),
        mats.pes ||= mkMat(escurecer(skin.cores.legs, 0.22)),
      );
      pe.rotation.x = Math.PI / 2;
      pe.scale.set(1.05, 1, 0.85);
      pe.position.set(0, ARTIC ? -(spec.hh + 0.03) : -0.16, 0.05);
      pe.castShadow = true;
      contorno(pe);
      obj.add(pe);
    }
    scene.add(obj);
    meshes[spec.name] = obj;
  }
  skin.extras(THREE, { head: meshes._headAnchor ?? meshes.head, torso: meshes.torso, pelvis: meshes.pelvis });
  registrarFlashMats(meshes);
  return meshes;
}

function destroyVisual(meshes) {
  for (const spec of PARTS) {
    const obj = meshes[spec.name];
    if (obj.isBone) continue; // estilo 'r': ossos são limpos junto com a raiz abaixo
    scene.remove(obj);
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.map) o.material.dispose();
    });
  }
  // Estilo 'r' (rigado): remove a raiz dos ossos e as malhas skinadas (ficam soltas na cena)
  if (meshes._rootBones) scene.remove(meshes._rootBones);
  for (const sm of meshes._skinMeshes || []) {
    scene.remove(sm);
    if (sm.geometry) sm.geometry.dispose();
    if (sm.material && !sm.material.map) sm.material.dispose();
  }
  // Estilo 'j' (Jaeger rigado): remove a armature carregada
  if (meshes._armature) scene.remove(meshes._armature);
}

// Flash de dano: coleta os materiais do lutador que têm canal emissivo, guardando
// o valor base pra restaurar. Funciona em todos os estilos (vinil/toon/standard/GLB).
const COR_FLASH = new THREE.Color(1.0, 0.55, 0.5); // branco-quente avermelhado (dor)
function registrarFlashMats(meshes) {
  const mats = [], visto = new Set();
  const raizes = PARTS.map((s) => meshes[s.name]).concat(meshes._flashExtra || []);
  for (const root of raizes) {
    if (!root || !root.traverse) continue;
    root.traverse((o) => {
      const lista = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const mat of lista) {
        if (!mat || !mat.emissive || mat.__outline || visto.has(mat)) continue;
        visto.add(mat);
        mats.push({ mat, base: mat.emissive.clone(), baseInt: mat.emissiveIntensity ?? 1 });
      }
    });
  }
  meshes._flashMats = mats;
  meshes._flashOn = false;
}

function syncVisual(rag, meshes, now) {
  for (const spec of PARTS) {
    const b = rag.parts[spec.name];
    const m = meshes[spec.name];
    const t = b.translation();
    const r = b.rotation();
    m.position.set(t.x, t.y, t.z);
    m.quaternion.set(r.x, r.y, r.z, r.w);
  }
  // Respiração + squash & stretch no corpo
  const desdeHit = now - rag.lastHitLandedAt;
  const k = desdeHit >= 0 && desdeHit < 0.18 ? 0.22 * (1 - desdeHit / 0.18) : 0;
  // Flash de dano: o corpo inteiro brilha (branco-quente) ao levar um golpe e some rápido
  if (meshes._flashMats) {
    const FL = 0.16;
    const fInt = desdeHit >= 0 && desdeHit < FL ? (1 - desdeHit / FL) : 0;
    if (fInt > 0) {
      meshes._flashOn = true;
      for (const fm of meshes._flashMats) {
        fm.mat.emissive.copy(fm.base).lerp(COR_FLASH, fInt);
        fm.mat.emissiveIntensity = fm.baseInt + fInt * 1.7;
      }
    } else if (meshes._flashOn) { // restaura uma vez quando o flash acaba
      meshes._flashOn = false;
      for (const fm of meshes._flashMats) { fm.mat.emissive.copy(fm.base); fm.mat.emissiveIntensity = fm.baseInt; }
    }
  }
  const bs = meshes.torso._baseS ?? [1, 1, 1];
  meshes.torso.scale.set(
    bs[0] * (1 + k),
    bs[1] * (1 + 0.028 * Math.sin(now * 2.6 + meshes._fase)) * (1 - k * 0.6),
    bs[2] * (1 + k),
  );
  // Carinha: nocaute > piscada > normal
  if (meshes._face) {
    const piscando = ((now + meshes._fase) % 3.4) < 0.13;
    const variante = rag.isStunned(now) ? 'x' : (piscando ? 'blink' : 'ok');
    meshes._face.material.map = getFaceTexture(THREE, meshes._skin.face, variante);
  }
  // Sprite de papel: acompanha a inclinação do corpo físico
  if (meshes._sprite) {
    const q = rag.parts.torso.rotation();
    meshes._sprite.material.rotation = -Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  }
}

// Estilo 'r' (rigado): depois de mover os ossos, atualiza os esqueletos (senão a
// malha skinada colapsa). Chamar logo antes do render, com matrizes já frescas.
const _rgWorld = new THREE.Matrix4(), _rgDesired = new THREE.Matrix4(), _rgInvP = new THREE.Matrix4(), _rgOne = new THREE.Vector3(1, 1, 1);
const _rgPos = new THREE.Vector3(), _rgQuat = new THREE.Quaternion(), _rgScl = new THREE.Vector3();
const _rgBody = {};
function atualizarSkins() {
  for (const l of lutadores) {
    const mm = l.meshes;
    if (!mm) continue;
    if (mm._skel) { mm._rootBones.updateMatrixWorld(true); mm._skel.update(); }
    if (mm._jrig) {
      // corpos da física (trackers preenchidos por syncVisual) -> matrizes world
      for (const spec of PARTS) { const t = mm[spec.name]; _rgBody[spec.name] = (_rgBody[spec.name] || new THREE.Matrix4()).compose(t.position, t.quaternion, _rgOne); }
      // Cada osso ROTACIONA com seu corpo, mas mantém o COMPRIMENTO (posição de bind):
      // só o quadril (raiz) translada. Assim os membros dobram sem esticar.
      for (const d of mm._jrig.driven) {
        _rgDesired.multiplyMatrices(_rgBody[d.body], d.off);
        _rgInvP.copy(d.bone.parent.matrixWorld).invert();
        _rgWorld.multiplyMatrices(_rgInvP, _rgDesired);
        _rgWorld.decompose(_rgPos, _rgQuat, _rgScl);
        d.bone.quaternion.copy(_rgQuat);          // rotação vem da física
        if (d.root) d.bone.position.copy(_rgPos);  // só a raiz translada (mantém proporções)
        d.bone.updateWorldMatrix(false, false);
      }
      mm._jrig.skeleton.update();
    }
  }
}

// ---------- Lutadores (2 a 4, humanos e bots) ----------
// tipos de controle: 'kb1' (WASD+gp0) | 'kb2' (setas+gp1) | 'gp' | 'cpu'
const VOZES = [0.9, 1.15, 0.75, 1.35]; // timbre por slot
let lutadores = [];

function montarLutadores(configs) {
  for (const l of lutadores) {
    destroyVisual(l.meshes);
    l.rag.destroy();
    if (l._sight) { scene.remove(l._sight.grp); l._sight = null; }
  }
  lutadores = configs.map((cfg, i) => {
    const [sx, sz] = SPAWNS[i];
    const heading = Math.atan2(-sx, -sz);
    const rag = new Ragdoll(RAPIER, world, {
      x: sx, z: sz, heading,
      memberships: PLAYER_BITS[i],
      filter: 0x0001 | 0x0008 | (TODOS_PLAYERS & ~PLAYER_BITS[i]),
    });
    rag.props = mapa.props;
    rag.controle = mapa.controle ?? 1;
    const meshes = buildVisual(SKINS[cfg.skin], i * 1.9, i);
    return { rag, meshes, cfg, slot: i, vivo: true, score: 0 };
  });
  for (const l of lutadores) l.rag.rivals = lutadores.filter((o) => o !== l).map((o) => o.rag);
}

// Tecla M: alterna entre o estilo base e o Jaeger rigado ('j') em runtime,
// reconstruindo os visuais dos lutadores em cena (mesmo caminho da troca de skin).
function alternarModelo3D() {
  ESTILO = ESTILO === 'j' ? (ESTILO_BASE === 'j' ? 'a' : ESTILO_BASE) : 'j';
  for (const l of lutadores) {
    destroyVisual(l.meshes);
    l.meshes = buildVisual(SKINS[l.cfg.skin], l.slot * 1.9, l.slot);
  }
  som.selecionar?.();
}
addEventListener('keydown', (e) => { if (e.code === 'KeyM') alternarModelo3D(); });

function inputDoLutador(l) {
  if (l.cfg.tipo === 'cpu') return botInput(l);
  if (l.cfg.tipo === 'kb1') return mergeInput(readInput(MAPS.p1), readGamepad(0));
  if (l.cfg.tipo === 'kb2') return mergeInput(readInput(MAPS.p2), readGamepad(1));
  return readGamepad(l.cfg.gp) ?? IDLE_IN;
}

// Toque duplo na direção = investida de ombro
function detectarDash(l, inp, now) {
  const mag = Math.hypot(inp.move.x, inp.move.z);
  const pressionado = mag > 0.5;
  if (pressionado && !l._movHeld) {
    if (now - (l._lastPress ?? -9) < 0.33) l.rag.dash(now);
    l._lastPress = now;
  }
  l._movHeld = mag > 0.3;
}

// Esquiva: dispara na borda (apertou), rola na direção segurada
function detectarEsquiva(l, inp, now) {
  if (inp.esquiva && !l._esqHeld) l.rag.esquiva(now, inp.move.x, inp.move.z);
  l._esqHeld = !!inp.esquiva;
}

// ---------- Bot ----------
function botInput(l) {
  const out = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };
  const me = l.rag.parts.pelvis.translation();
  const alvos = lutadores.filter((o) => o !== l && o.vivo);
  if (!alvos.length) return out;
  let alvo = alvos[0], dAlvo = Infinity;
  for (const a of alvos) {
    const ap = a.rag.parts.pelvis.translation();
    const d = Math.hypot(ap.x - me.x, ap.z - me.z);
    if (d < dAlvo) { dAlvo = d; alvo = a; }
  }
  const ap = alvo.rag.parts.pelvis.translation();
  let dx = ap.x - me.x, dz = ap.z - me.z;
  // fugir da bola de demolição em velocidade
  for (const b of mapa.bolas) {
    const bp = b.translation();
    const bv = b.linvel();
    if (Math.hypot(bp.x - me.x, bp.z - me.z) < 1.7 && Math.hypot(bv.x, bv.z) > 2.5) {
      dx = me.x - bp.x;
      dz = me.z - bp.z;
    }
  }
  // medo da beirada: longe do centro, puxa pra dentro
  const rC = Math.hypot(me.x, me.z);
  if (rC > 3.3) {
    dx = dx * 0.35 - me.x * 0.65;
    dz = dz * 0.35 - me.z * 0.65;
  }
  const dl = Math.hypot(dx, dz) || 1;
  if (dAlvo > 0.85 || rC > 3.3) {
    out.move.x = dx / dl;
    out.move.z = dz / dl;
  }
  // Armas: se está segurando uma, usa (encara o alvo e ataca); senão pega a que
  // estiver por perto. Faz o bot mostrar as armas na luta.
  if (rC < 3.3) {
    const minhaArma = mapa.armas && mapa.armas.find((a) => l.rag.grabJoints.some((g) => g && g.body === a.body));
    if (minhaArma) {
      out.grab = true; out.move.x = dx / dl; out.move.z = dz / dl; // segura + encara
      const alcance = minhaArma.tiro ? minhaArma.alcanceTiro : 1.15;
      if (dAlvo < alcance && simNow > (l._botFire ?? 0)) { out.punch = true; l._botFire = simNow + (minhaArma.tiro ? 0.55 : 0.75); }
      return out;
    }
    if (mapa.armas && mapa.armas.length && !l.rag.grabJoints.some((g) => g)) {
      let aw = null, ad = 2.4;
      for (const a of mapa.armas) { const q = a.body.translation(); const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < ad) { ad = d; aw = a; } }
      if (aw) { const q = aw.body.translation(); const wx = q.x - me.x, wz = q.z - me.z, wl = Math.hypot(wx, wz) || 1; out.move.x = wx / wl; out.move.z = wz / wl; if (ad < 0.85) out.grab = true; return out; }
    }
  }
  // decidir soco ou agarrão quando chega perto
  if (dAlvo < 0.95 && simNow > (l._botCd ?? 0)) {
    if (Math.random() < 0.55) {
      out.punch = true;
      l._botCd = simNow + 0.9 + Math.random() * 0.7;
    } else {
      l._botGrabAte = simNow + 1.3 + Math.random() * 0.6;
      l._botCd = simNow + 2 + Math.random();
    }
  }
  if (simNow < (l._botGrabAte ?? 0)) {
    out.grab = true;
    // agarrou um rival? dá cabeçada de vez em quando e arrasta pra borda mais próxima
    if (l.rag.grabbedRival()) {
      const rl = Math.hypot(me.x, me.z) || 1;
      out.move.x = me.x / rl;
      out.move.z = me.z / rl;
      if (simNow > (l._botCab ?? 0)) { out.punch = true; l._botCab = simNow + 0.9 + Math.random() * 0.6; }
    }
  }
  if (l.rag.hangingOnLedge()) out.jump = true;
  return out;
}

// ---------- Efeitos de impacto (estrelas, POF!, poeira) ----------
function texturaCanvas(tamanho, desenha) {
  const c = document.createElement('canvas');
  c.width = c.height = tamanho;
  desenha(c.getContext('2d'), tamanho);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const starTex = texturaCanvas(64, (g) => {
  g.translate(32, 32);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 26 : 11;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffd94a';
  g.strokeStyle = '#241640';
  g.lineWidth = 4;
  g.fill();
  g.stroke();
});
const puffTex = texturaCanvas(128, (g) => {
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,250,240,0.95)');
  grad.addColorStop(0.7, 'rgba(255,245,230,0.5)');
  grad.addColorStop(1, 'rgba(255,245,230,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
});
const powTexs = ['POF!', 'PAH!', 'BUM!'].map((txt) => texturaCanvas(256, (g) => {
  g.translate(128, 128);
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const r = i % 2 === 0 ? 118 : 82;
    const a = (i / 24) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffd94a';
  g.strokeStyle = '#241640';
  g.lineWidth = 8;
  g.fill();
  g.stroke();
  g.font = '900 64px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = '#fff';
  g.strokeText(txt, 0, 4);
  g.fillStyle = '#d6273b';
  g.fillText(txt, 0, 4);
}));

const emoteTex = texturaCanvas(128, (g) => {
  g.font = '96px "Segoe UI Emoji", "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('👋', 64, 70);
});

const efeitos = [];
function spawnFx(tex, pos, opts) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.position.set(pos.x + (opts.dx || 0), pos.y + (opts.dy || 0), pos.z + (opts.dz || 0));
  s.scale.setScalar(opts.escala ?? 0.24);
  scene.add(s);
  efeitos.push({
    s, vida: opts.vida ?? 0.55, vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0,
    grav: opts.grav ?? 0, giro: opts.giro ?? 0, cresce: opts.cresce ?? 0, teto: opts.teto ?? 9,
  });
}
function burstEstrelas(pos) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    spawnFx(starTex, pos, {
      dy: 0.1, escala: 0.24, vida: 0.55, grav: 4.5, giro: 6,
      vx: Math.cos(a) * 1.8, vy: 1.6 + (i % 3) * 0.6, vz: Math.sin(a) * 1.2,
    });
  }
}
let powN = 0;
function powFx(pos) {
  spawnFx(powTexs[powN++ % powTexs.length], pos, { dy: 0.5, escala: 0.14, vida: 0.6, vy: 0.55, cresce: 4.2, teto: 0.9 });
}
function puffFx(pos) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    spawnFx(puffTex, pos, {
      dy: -0.55, dx: Math.cos(a) * 0.22, dz: Math.sin(a) * 0.18,
      escala: 0.3, vida: 0.5, vy: 0.5, cresce: 1.6,
      vx: Math.cos(a) * 0.8, vz: Math.sin(a) * 0.6,
    });
  }
}
function updateEfeitos(dt) {
  for (let i = efeitos.length - 1; i >= 0; i--) {
    const e = efeitos[i];
    e.vida -= dt;
    if (e.vida <= 0) {
      scene.remove(e.s);
      e.s.material.dispose();
      efeitos.splice(i, 1);
      continue;
    }
    e.vy -= e.grav * dt;
    e.s.position.x += e.vx * dt;
    e.s.position.y += e.vy * dt;
    e.s.position.z += e.vz * dt;
    if (e.cresce) e.s.scale.setScalar(Math.min(e.teto, e.s.scale.x + e.cresce * dt));
    e.s.material.opacity = Math.min(1, e.vida * 3);
    if (e.giro) e.s.material.rotation += e.giro * dt;
  }
}

function makeDeckTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  const tons = ['#eccb79', '#e5c06a', '#f0d287', '#e2ba5e', '#eac672', '#e8c46d', '#f2d68e', '#e0b75a'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tons[i];
    g.fillRect(i * 128, 0, 128, 768);
    g.fillStyle = 'rgba(120,80,20,0.35)';
    g.fillRect(i * 128, 0, 5, 768);
  }
  g.fillStyle = 'rgba(120,80,20,0.22)';
  for (let i = 0; i < 8; i++) {
    for (let y = ((i * 7) % 4) * 96 + 60; y < 768; y += 384) g.fillRect(i * 128, y, 128, 4);
  }
  g.strokeStyle = '#c2413b';
  g.lineWidth = 30;
  g.strokeRect(30, 30, 1024 - 60, 768 - 60);
  g.strokeStyle = '#f7ead0';
  g.lineWidth = 6;
  g.strokeRect(56, 56, 1024 - 112, 768 - 112);
  const v = g.createRadialGradient(512, 384, 260, 512, 384, 660);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(70,35,10,0.28)');
  g.fillStyle = v;
  g.fillRect(0, 0, 1024, 768);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- HUD / seleção / rounds ----------
const $ = (id) => document.getElementById(id);
let state = 'selecao'; // selecao | intro | luta | replay | ponto | fim
let stateUntil = 0;
let introStep = 0;
let pendente = null; // resultado do round esperando o replay acabar

// Som liga no primeiro gesto do usuário (regra do navegador)
const ligarSom = () => { initSom(); som.musica(state === 'luta' ? 'luta' : 'menu'); };
addEventListener('pointerdown', ligarSom, { once: true });
addEventListener('keydown', ligarSom, { once: true });

// Configuração da seleção: 4 slots
const lerSkin = (k, padrao) => {
  const v = parseInt(store.get(k), 10);
  return (Number.isFinite(v) ? v : padrao) % SKINS.length;
};
const selCfg = [
  { tipo: 'kb1', ativo: true, conf: false, skin: lerSkin('molengas_skin0', 2) },
  { tipo: 'kb2', ativo: true, conf: false, skin: lerSkin('molengas_skin1', 6) },
  { tipo: 'gp', gp: 2, ativo: false, conf: false, skin: 4 },
  { tipo: 'gp', gp: 3, ativo: false, conf: false, skin: 7 },
];
let selFase = 'skins'; // skins | mapa
// ?skins=a,b força as fantasias (debug/screenshot)
if (PARAMS.get('skins')) {
  const ns = PARAMS.get('skins').split(',').map((n) => parseInt(n, 10));
  ns.forEach((n, i) => { if (Number.isFinite(n) && selCfg[i]) selCfg[i].skin = n % SKINS.length; });
}

function trocarSkin(i, dir) {
  selCfg[i].skin = ((selCfg[i].skin + dir) % SKINS.length + SKINS.length) % SKINS.length;
  store.set('molengas_skin' + i, selCfg[i].skin);
  som.selecionar();
  // lutador em cena? troca ao vivo
  const l = lutadores.find((x) => x.slot === i);
  if (l) {
    destroyVisual(l.meshes);
    l.meshes = buildVisual(SKINS[selCfg[i].skin], i * 1.9, i);
    l.cfg.skin = selCfg[i].skin;
  }
  atualizarSelecao();
}

function atualizarSelecao() {
  for (let i = 0; i < 4; i++) {
    const painel = $('sel-p' + i);
    if (!painel) continue;
    const c = selCfg[i];
    painel.classList.toggle('confirmado', c.ativo && c.conf);
    painel.classList.toggle('vazio', !c.ativo);
    $('sel-img' + i).src = ASSET(`assets/retratos/${SKINS[c.skin].id}.jpg`);
    $('sel-img' + i).style.opacity = c.ativo ? 1 : 0.25;
    $('sel-nome' + i).textContent = c.ativo ? SKINS[c.skin].nome + (c.tipo === 'cpu' ? ' 🤖' : '') : '—';
  }
  $('sel-mapa').style.display = selFase === 'mapa' ? 'block' : 'none';
  $('sel-mapa-nome').textContent = MAPAS[mapaIdx].nome;
  if ($('sel-modo-nome')) $('sel-modo-nome').textContent = MODOS[modoIdx].nome;
  if ($('sel-jaeger')) $('sel-jaeger').textContent = ESTILO === 'j' ? 'SIM 🤖' : 'não';
}
function checarFaseMapa() {
  const ativos = selCfg.filter((c) => c.ativo);
  if (ativos.length >= 2 && ativos.every((c) => c.conf || c.tipo === 'cpu')) selFase = 'mapa';
}
function addBot() {
  const slot = selCfg.find((c) => !c.ativo);
  if (!slot) return;
  slot.ativo = true;
  slot.tipo = 'cpu';
  slot.conf = true;
  slot.skin = Math.floor(Math.random() * SKINS.length);
  som.confirmar();
  atualizarSelecao();
}
function mostrarSelecao() {
  selFase = 'skins';
  for (const c of selCfg) {
    c.conf = false;
    if (c.tipo === 'cpu') { c.ativo = false; c.tipo = 'gp'; }
  }
  $('selecao').style.display = 'flex';
  showMsg('');
  state = 'selecao';
  som.musica('menu');
  atualizarSelecao();
}
function startIntro(roundN) {
  state = 'intro';
  introStep = 0;
  stateUntil = simNow + 0.9;
  replayBuf.length = 0;
  showMsg('ROUND ' + roundN);
}
function iniciarLuta() {
  $('selecao').style.display = 'none';
  WIN_SCORE = MODOS[modoIdx].vitorias;   // aplica o modo escolhido
  MODO_CAOS = MODOS[modoIdx].caos;
  const configs = selCfg.filter((c) => c.ativo).map((c) => ({ ...c }));
  montarLutadores(configs);
  mapa.reset?.(true);
  updateScore();
  som.confirmar();
  som.musica('luta');
  startIntro(1);
}

function updateScore() {
  const placar = $('placar');
  if (!lutadores.length) { placar.innerHTML = ''; return; }
  placar.innerHTML = lutadores.map((l, i) => {
    const s = SKINS[l.cfg.skin];
    return `<div class="pcard" data-i="${i}">`
      + `<div class="pdev">`
      + `<img class="retrato" src="${ASSET(`assets/retratos/${s.id}.jpg`)}" onerror="this.style.display='none'">`
      + `<span>${l.score}</span><span class="parma"></span></div>`
      + `<div class="pbar ko"><i></i></div>`
      + `<div class="pbar fol"><i></i></div>`
      + `</div>`;
  }).join('');
  // guarda refs das barras pra atualizar por frame (dano/fôlego ao vivo)
  lutadores.forEach((l, i) => {
    const card = placar.querySelector(`.pcard[data-i="${i}"]`);
    l._hudCard = card;
    l._hudKO = card && card.querySelector('.ko i');
    l._hudFol = card && card.querySelector('.fol i');
    l._hudArma = card && card.querySelector('.parma');
  });
}
// Atualiza as barras de nocaute (dano) e fôlego a cada frame.
function updateHudBarras(now) {
  for (const l of lutadores) {
    if (!l._hudKO) continue;
    const ko = Math.min(1, l.rag.dano / 4);
    l._hudKO.style.width = (ko * 100).toFixed(0) + '%';
    l._hudFol.style.width = (Math.max(0, Math.min(1, l.rag.folego)) * 100).toFixed(0) + '%';
    const down = l.rag.isDowned(now);
    if (l._hudCard) l._hudCard.classList.toggle('down', down);
    // ícone da arma que está segurando (esmaece se superaquecida)
    if (l._hudArma) {
      const arma = mapa.armas && mapa.armas.find((a) => l.rag.grabJoints.some((g) => g && g.body === a.body));
      l._hudArma.textContent = arma ? arma.icone : '';
      l._hudArma.style.opacity = (arma && arma.tiro && arma.quente) ? '0.35' : '1';
    }
  }
}
function showMsg(txt, sub = '') {
  $('msg').innerHTML = txt + (sub ? `<div class="sub">${sub}</div>` : '');
  $('msg').style.display = txt ? 'block' : 'none';
}

// Seleção por teclado
addEventListener('keydown', (e) => {
  if (state !== 'selecao') return;
  if (selFase === 'skins') {
    if (!selCfg[0].conf && e.code === 'KeyA') trocarSkin(0, -1);
    if (!selCfg[0].conf && e.code === 'KeyD') trocarSkin(0, 1);
    if (!selCfg[0].conf && e.code === 'KeyF') { selCfg[0].conf = true; som.confirmar(); }
    if (!selCfg[1].conf && e.code === 'ArrowLeft') trocarSkin(1, -1);
    if (!selCfg[1].conf && e.code === 'ArrowRight') trocarSkin(1, 1);
    if (!selCfg[1].conf && e.code === 'KeyK') { selCfg[1].conf = true; som.confirmar(); }
    checarFaseMapa();
  } else {
    if (e.code === 'KeyA') { setMapa(mapaIdx - 1); som.selecionar(); }
    if (e.code === 'KeyD') { setMapa(mapaIdx + 1); som.selecionar(); }
    if (e.code === 'KeyC') addBot();
    if (e.code === 'KeyN') { modoIdx = (modoIdx + 1) % MODOS.length; som.selecionar(); } // modo de jogo
    if (e.code === 'KeyJ') alternarModelo3D(); // liga/desliga o Jaeger (preview + partida)
    if (e.code === 'KeyF') { iniciarLuta(); return; }
  }
  atualizarSelecao();
});
// Seleção por gamepad (bordas)
const gpMenuPrev = [{}, {}, {}, {}];
function menuGamepad() {
  if (state !== 'selecao') return;
  for (let g = 0; g < 4; g++) {
    const gp = readGamepad(g);
    if (!gp) continue;
    const prev = gpMenuPrev[g];
    const esq = gp.move.x < -0.5 && !(prev.x < -0.5);
    const dir = gp.move.x > 0.5 && !(prev.x > 0.5);
    const a = gp.jump && !prev.a;
    prev.x = gp.move.x;
    prev.a = gp.jump;
    // controles 0/1 comandam os slots 0/1; 2/3 entram nos slots livres
    const slot = g <= 1 ? selCfg[g] : selCfg.find((c) => c.tipo === 'gp' && c.gp === g);
    if (!slot) continue;
    if (selFase === 'skins') {
      const i = selCfg.indexOf(slot);
      if (!slot.ativo) {
        if (a) { slot.ativo = true; som.confirmar(); }
      } else if (!slot.conf) {
        if (esq) trocarSkin(i, -1);
        if (dir) trocarSkin(i, 1);
        if (a) { slot.conf = true; som.confirmar(); }
      }
      checarFaseMapa();
      atualizarSelecao();
    } else if (g === 0) {
      if (esq) { setMapa(mapaIdx - 1); som.selecionar(); }
      if (dir) { setMapa(mapaIdx + 1); som.selecionar(); }
      if (a) { iniciarLuta(); return; }
      atualizarSelecao();
    }
  }
}

// ---------- Replay em câmera lenta ----------
const REPLAY_FRAMES = 150; // ~2.5s a 60fps
const replayBuf = [];
let replayT = 0;
function corposDoReplay() {
  const corpos = [];
  for (const l of lutadores) for (const spec of PARTS) corpos.push([l.rag.parts[spec.name], l.meshes[spec.name]]);
  for (const [b, m] of mapa.syncPairs) corpos.push([b, m]);
  return corpos;
}
function gravarReplay() {
  const snap = [];
  for (const [b] of corposDoReplay()) {
    const t = b.translation();
    const q = b.rotation();
    snap.push(t.x, t.y, t.z, q.x, q.y, q.z, q.w);
  }
  replayBuf.push(snap);
  if (replayBuf.length > REPLAY_FRAMES) replayBuf.shift();
}
function aplicarReplay(idx) {
  const snap = replayBuf[idx];
  if (!snap) return;
  let o = 0;
  for (const [, m] of corposDoReplay()) {
    m.position.set(snap[o], snap[o + 1], snap[o + 2]);
    m.quaternion.set(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]);
    o += 7;
  }
}

// ---------- Rounds ----------
function vivos() { return lutadores.filter((l) => l.vivo); }

function handleRounds(now) {
  if (state === 'intro') {
    if (now > stateUntil) {
      if (introStep === 0) {
        introStep = 1;
        stateUntil = now + 0.6;
        showMsg('LUTEM! 🥊');
        som.lutem();
      } else {
        showMsg('');
        state = 'luta';
      }
    }
    return;
  }
  if (state === 'luta') {
    for (const l of lutadores) {
      if (l.vivo && l.rag.parts.pelvis.translation().y < -8) {
        l.vivo = false;
        l.rag.stats.quedas++;
        som.queda();
        som.vozChoro(VOZES[l.slot]);
        trauma = 1; hitStop = Math.max(hitStop, 0.11); // baque forte no nocaute/ring-out
        l.rag.rivals = [];
        for (const o of lutadores) o.rag.rivals = lutadores.filter((x) => x !== o && x.vivo).map((x) => x.rag);
      }
    }
    const v = vivos();
    if (v.length <= 1) {
      const winner = v[0] ?? null;
      if (winner) winner.score++;
      updateScore();
      som.torcidaOh();
      pendente = winner;
      if (replayBuf.length > 20) {
        state = 'replay';
        replayT = 0;
        showMsg('📹 REPLAY');
      } else {
        fecharRound();
      }
    }
  } else if (state === 'ponto' && now > stateUntil) {
    for (const l of lutadores) { l.rag.reset(); l.vivo = true; }
    for (const o of lutadores) o.rag.rivals = lutadores.filter((x) => x !== o).map((x) => x.rag);
    mapa.reset?.(false);
    startIntro(lutadores.reduce((s, l) => s + l.score, 0) + 1);
  } else if (state === 'fim' && isDown('KeyR')) {
    for (const l of lutadores) { l.rag.reset(); l.vivo = true; }
    mapa.reset?.(true);
    mostrarSelecao();
  }
}
function fecharRound() {
  const winner = pendente;
  pendente = null;
  if (winner && winner.score >= WIN_SCORE) {
    state = 'fim';
    som.vitoria();
    som.vozYay(VOZES[winner.slot]);
    const stats = lutadores.map((l) =>
      `${SKINS[l.cfg.skin].nome}: ${l.rag.stats.acertos}/${l.rag.stats.socos} socos · ` +
      `${l.rag.stats.quedas} quedas · ${l.rag.stats.pendurado.toFixed(0)}s pendurado · ${l.rag.stats.arremessos} arremessos`,
    ).join('<br>');
    showMsg('🏆 ' + SKINS[winner.cfg.skin].nome + ' VENCEU!', stats + '<br><br>Aperte R pra voltar à seleção');
  } else {
    som.ponto();
    state = 'ponto';
    stateUntil = simNow + 1.4;
    showMsg(winner ? 'PONTO DO ' + SKINS[winner.cfg.skin].nome + '!' : 'EMPATE!');
  }
}

// ---------- Cliente online (LAN) ----------
// O servidor roda a física oficial; aqui só mandamos botões e
// interpolamos os snapshots que chegam (~20Hz) pra 60fps.
let online = null;

function iniciarOnline() {
  $('selecao').style.display = 'none';
  showMsg('CONECTANDO…');
  const ws = new WebSocket(`ws://${location.host}`);
  online = { ws, slot: null, visuais: new Map(), buf: [], msgAtual: null };
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ t: 'entrar', skin: selCfg[0].skin }));
    showMsg('NA SALA! 🌐', 'quando todos entrarem, o host (1º jogador) aperta F');
    setInterval(() => {
      if (ws.readyState !== 1) return;
      const inp = mergeInput(readInput(MAPS.p1), readGamepad(0));
      ws.send(JSON.stringify({
        t: 'input', m: [inp.move.x, inp.move.z],
        p: inp.punch, g: inp.grab, j: inp.jump, e: inp.emote,
      }));
    }, 33);
  });
  ws.addEventListener('close', () => showMsg('DESCONECTOU 😵', 'o servidor fechou — recarrega a página'));
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'oi') online.slot = m.slot;
    else if (m.t === 'cheio') showMsg('SALA CHEIA 😔');
    else if (m.t === 's') receberSnap(m);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && online.ws.readyState === 1) online.ws.send(JSON.stringify({ t: 'comecar' }));
  });
}

function receberSnap(m) {
  online.buf.push({ rx: performance.now() / 1000, m });
  if (online.buf.length > 30) online.buf.shift();
  for (const pl of m.pl) {
    let v = online.visuais.get(pl.s);
    if (!v || v.skin !== pl.sk) {
      if (v) destroyVisual(v.meshes);
      v = { skin: pl.sk, meshes: buildVisual(SKINS[pl.sk % SKINS.length], pl.s * 1.9, pl.s) };
      online.visuais.set(pl.s, v);
    }
  }
  for (const [s, v] of online.visuais) {
    if (!m.pl.some((p) => p.s === s)) {
      destroyVisual(v.meshes);
      online.visuais.delete(s);
    }
  }
  $('placar').innerHTML = m.pl.map((pl) =>
    `<img class="retrato" src="${ASSET(`assets/retratos/${SKINS[pl.sk % SKINS.length].id}.jpg`)}" onerror="this.style.display='none'"> <span>${pl.sc}</span>`,
  ).join(' &nbsp;·&nbsp; ');
  if (m.msg !== online.msgAtual) {
    online.msgAtual = m.msg;
    if (m.st !== 'lobby') showMsg(m.msg);
  }
  for (const evn of m.ev) {
    const [tipo, x, y, z] = evn;
    if (tipo === 'hit') {
      const pos = { x, y, z };
      burstEstrelas(pos);
      powFx(pos);
      som.acerto();
      trauma = Math.min(1, trauma + 0.5);
    } else if (tipo === 'soco') som.soco();
    else if (tipo === 'pulo') som.pulo();
    else if (tipo === 'lutem') { som.lutem(); som.musica('luta'); }
    else if (tipo === 'ponto') { som.ponto(); som.torcidaOh(); }
    else if (tipo === 'queda') som.queda();
    else if (tipo === 'vitoria') { som.vitoria(); som.musica('menu'); }
    else if (tipo === 'bolada') som.bolada();
  }
}

function aplicarSnapOnline(m1, m2, f) {
  const lerp = (a, b) => a + (b - a) * f;
  const agora = performance.now() / 1000;
  for (const pl2 of m2.pl) {
    const pl1 = m1.pl.find((p) => p.s === pl2.s) ?? pl2;
    const v = online.visuais.get(pl2.s);
    if (!v || pl1.p.length !== pl2.p.length) continue;
    let o = 0;
    for (const spec of PARTS) {
      const msh = v.meshes[spec.name];
      msh.position.set(lerp(pl1.p[o], pl2.p[o]), lerp(pl1.p[o + 1], pl2.p[o + 1]), lerp(pl1.p[o + 2], pl2.p[o + 2]));
      const dot = pl1.p[o + 3] * pl2.p[o + 3] + pl1.p[o + 4] * pl2.p[o + 4] + pl1.p[o + 5] * pl2.p[o + 5] + pl1.p[o + 6] * pl2.p[o + 6];
      const s2 = dot < 0 ? -1 : 1;
      msh.quaternion.set(
        lerp(pl1.p[o + 3] * s2, pl2.p[o + 3]),
        lerp(pl1.p[o + 4] * s2, pl2.p[o + 4]),
        lerp(pl1.p[o + 5] * s2, pl2.p[o + 5]),
        lerp(pl1.p[o + 6] * s2, pl2.p[o + 6]),
      ).normalize();
      o += 7;
    }
    const piscando = ((agora + pl2.s * 1.9) % 3.4) < 0.13;
    v.meshes._face.material.map = getFaceTexture(THREE, v.meshes._skin.face, pl2.at ? 'x' : (piscando ? 'blink' : 'ok'));
    v.meshes.torso.scale.y = v.meshes.torso._baseY * (1 + 0.028 * Math.sin(agora * 2.6 + pl2.s * 1.9));
  }
  // props: aplica nos corpos locais (parados) e deixa o sync normal desenhar
  m2.pr.forEach((b2, idx) => {
    const b1 = m1.pr[idx] ?? b2;
    const body = mapa.props[idx];
    if (!body) return;
    body.setTranslation({ x: lerp(b1[0], b2[0]), y: lerp(b1[1], b2[1]), z: lerp(b1[2], b2[2]) }, false);
    body.setRotation({ x: b2[3], y: b2[4], z: b2[5], w: b2[6] }, false);
  });
}

function frameOnline(t, fdt) {
  const alvo = performance.now() / 1000 - 0.12;
  const buf = online.buf;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].rx > alvo) i--;
  if (buf.length >= 2) {
    const b1 = buf[Math.max(0, i - 1)];
    const b2 = buf[i];
    const span = Math.max(0.001, b2.rx - b1.rx);
    const f = Math.min(1, Math.max(0, (alvo - b1.rx) / span));
    aplicarSnapOnline(b1.m, b2.m, f);
  }
  for (const [body, mesh] of mapa.syncPairs) {
    const tp = body.translation();
    const rp = body.rotation();
    mesh.position.set(tp.x, tp.y, tp.z);
    mesh.quaternion.set(rp.x, rp.y, rp.z, rp.w);
  }
  mapa.update?.(t / 1000);
  updateEfeitos(fdt);
  mirarHolofotes(t / 1000);
  cairConfetes(fdt, t / 1000);
  // câmera pelos bonecos na tela
  trauma = Math.max(0, trauma - 2.4 * fdt);
  let midX = 0, midZ = 0, spread = 4;
  if (online.visuais.size) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const v of online.visuais.values()) {
      const p = v.meshes.pelvis.position;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    midX = (minX + maxX) / 2;
    midZ = (minZ + maxZ) / 2;
    spread = Math.min(Math.hypot(maxX - minX, maxZ - minZ), 12);
  }
  const target = new THREE.Vector3(midX * 0.6, 3.9 + spread * 0.3, 6.6 + spread * 0.55);
  camPos.lerp(target, 0.05);
  camera.position.copy(camPos);
  camera.lookAt(midX * 0.6, 0.8, midZ * 0.3);
  const shake = trauma * trauma * 0.26;
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;
  renderCena();
}

// ---------- Loop ----------
const FIXED_DT = 1 / 60;
world.timestep = FIXED_DT;
let acc = 0;
let last = performance.now();
let simNow = 0;
let trauma = 0;
let hitStop = 0; // freeze-frame: congela a física por alguns ms no impacto (peso)
let proxArmaEm = 0; // cronômetro do próximo drop de arma
const camPos = new THREE.Vector3(0, 6, 10);

function frame(t) {
  requestAnimationFrame(frame);
  const fdt = Math.min((t - last) / 1000, 0.1);
  last = t;

  if (online) {
    frameOnline(t, fdt);
    return;
  }

  if (state === 'replay') {
    replayT += fdt * 0.4; // câmera lenta
    const idx = Math.floor(replayT * 60);
    if (idx >= replayBuf.length) {
      fecharRound();
    } else {
      aplicarReplay(idx);
    }
    updateEfeitos(fdt);
    mirarHolofotes(simNow);
    cairConfetes(fdt, simNow);
    atualizarSkins();
    renderCena();
    return;
  }

  acc += fdt;
  if (hitStop > 0) { hitStop -= fdt; acc = 0; } // congela a simulação (freeze-frame), sem acumular catch-up
  while (acc >= FIXED_DT) {
    acc -= FIXED_DT;
    simNow += FIXED_DT;
    const lutando = state === 'luta';
    for (const l of lutadores) {
      let inp = lutando && l.vivo ? inputDoLutador(l) : IDLE_IN;
      if (inp !== IDLE_IN) {
        if (mapa.semSoco && inp.punch) inp = { ...inp, punch: false };
        if (l.cfg.tipo !== 'cpu') { detectarDash(l, inp, simNow); detectarEsquiva(l, inp, simNow); }
      }
      l.rag.update(FIXED_DT, simNow, inp);
    }
    world.step();
    if (state === 'luta') gravarReplay();
    handleRounds(simNow);
  }
  menuGamepad();

  for (const l of lutadores) syncVisual(l.rag, l.meshes, simNow);

  // Objetos do mapa seguem a física
  for (const [body, mesh] of mapa.syncPairs) {
    const tp = body.translation();
    const rp = body.rotation();
    mesh.position.set(tp.x, tp.y, tp.z);
    mesh.quaternion.set(rp.x, rp.y, rp.z, rp.w);
  }
  mapa.update?.(simNow);

  // Bolada: bola de demolição em velocidade atordoa quem ela atropela
  for (const bolaB of mapa.bolas) {
    const bv = bolaB.linvel();
    if (Math.hypot(bv.x, bv.y, bv.z) < 3) continue;
    const bp = bolaB.translation();
    for (const l of lutadores) {
      if (simNow < (l._bolaCd ?? 0)) continue;
      const tp = l.rag.parts.torso.translation();
      if (Math.hypot(bp.x - tp.x, bp.y - tp.y, bp.z - tp.z) < 0.95) {
        l._bolaCd = simNow + 1.2;
        l.rag.dano = Math.min(4, l.rag.dano + 1);
        l.rag.stun(simNow + 1.1);
        l.rag.lastHitLandedAt = simNow;
        som.bolada();
        trauma = Math.min(1, trauma + 0.5);
      }
    }
  }

  // ARMAS: em velocidade (arremessadas/balançadas) machucam quem encostam,
  // menos quem está segurando a arma. Some da arena => é removida (libera vaga).
  for (const arma of (mapa.armas || []).slice()) {
    const ap = arma.body.translation();
    if (ap.y < -6) { removerArma(mapa, arma); continue; }
    const av = arma.body.linvel();
    const sp = Math.hypot(av.x, av.y, av.z);
    if (sp < 3.4) continue; // parada/carregada devagar não machuca
    for (const l of lutadores) {
      if (simNow < (l._armaCd ?? 0)) continue;
      if (l.rag.grabJoints.some((g) => g && g.body === arma.body)) continue; // não fere quem segura
      const tp = l.rag.parts.torso.translation();
      if (Math.hypot(ap.x - tp.x, ap.y - tp.y, ap.z - tp.z) < arma.alcance) {
        l._armaCd = simNow + 0.7;
        const forte = sp > 7.5;
        l.rag.dano = Math.min(4, l.rag.dano + (forte ? 2 : 1));
        l.rag.stun(simNow + (forte ? 1.5 : 1.0));
        if (l.rag.dano >= 4 && !l.rag.isDowned(simNow)) l.rag.knockdown(simNow);
        const dl = Math.hypot(av.x, av.z) || 1;
        for (const pn of ['torso', 'pelvis']) {
          l.rag.parts[pn].applyImpulse({ x: (av.x / dl) * arma.forca, y: 2, z: (av.z / dl) * arma.forca }, true);
        }
        l.rag.lastHitLandedAt = simNow;
        som.bolada(); trauma = Math.min(1, trauma + 0.5); hitStop = Math.max(hitStop, 0.06);
      }
    }
  }
  // Drop de arma de tempos em tempos (cai do alto), no máx. 3 na arena
  if (state === 'luta') {
    const capArmas = MODO_CAOS ? 6 : 3, atrasoArma = MODO_CAOS ? 2.5 : 9;
    if (proxArmaEm === 0) proxArmaEm = simNow + (MODO_CAOS ? 1.5 : 5);
    if (simNow > proxArmaEm && (mapa.armas ? mapa.armas.length : 0) < capArmas) {
      const ax = (Math.random() * 2 - 1) * 2.4; // perto do centro (serve p/ arenas de vários tamanhos)
      const az = (Math.random() * 2 - 1) * 1.8;
      const tipos = ['bastao', 'cano', 'laser', 'bastao', 'cano'];
      const b = soltarArma(mapa, ax, az, tipos[(Math.random() * tipos.length) | 0]);
      b.setTranslation({ x: ax, y: 4.2, z: az }, true);
      puffFx({ x: ax, y: 4.2, z: az });
      proxArmaEm = simNow + atrasoArma + Math.random() * (MODO_CAOS ? 2 : 5);
    }
  }
  // Resfria as armas de tiro (superaquecimento: trava até esfriar de novo)
  for (const arma of (mapa.armas || [])) {
    if (!arma.tiro) continue;
    arma.calor = Math.max(0, arma.calor - arma.resfria * fdt);
    if (arma.quente && arma.calor <= 0.02) arma.quente = false;
  }
  // TIRO: quem segura um blaster e aperta soco dispara um laser (mira p/ onde olha)
  for (const l of lutadores) {
    const arma = mapa.armas && mapa.armas.find((a) => a.tiro && l.rag.grabJoints.some((g) => g && g.body === a.body));
    // Mira do laser: linha fina enquanto segura o blaster
    if (arma) { l._sight ||= criarSight(); atualizarSight(l._sight, l.rag, arma); l._sight.grp.visible = true; }
    else if (l._sight) l._sight.grp.visible = false;
    if (!arma) continue;
    if (l.rag.lastPunchStartAt > (l._tiroVisto ?? -1) && simNow > (l._tiroCd ?? 0)) {
      l._tiroVisto = l.rag.lastPunchStartAt;
      if (arma.quente) continue; // superaquecido: não dispara
      l._tiroCd = simNow + arma.cadencia;
      arma.calor = Math.min(arma.calorMax, arma.calor + arma.calorPorTiro);
      if (arma.calor >= arma.calorMax && !arma.quente) { arma.quente = true; som.overheat?.(); }
      dispararLaser(l, arma);
    }
  }
  updateBeams(fdt);
  // Splash: cair no mar (mapas com m.aguaY, tipo RIO) faz splash + som de queda
  if (mapa.aguaY != null) {
    for (const l of lutadores) {
      const py = l.rag.parts.pelvis.translation();
      if (py.y > mapa.aguaY) { l._naAgua = false; continue; }
      if (py.y < mapa.aguaY - 1.1 && !l._naAgua) {
        l._naAgua = true;
        puffFx({ x: py.x, y: mapa.aguaY + 0.1, z: py.z });
        puffFx({ x: py.x + 0.3, y: mapa.aguaY + 0.25, z: py.z });
        som.queda?.(); trauma = Math.min(1, trauma + 0.3);
      }
    }
  }

  // Efeitos + sons por lutador
  for (const l of lutadores) {
    const p = l.rag;
    if (p.lastHitLandedAt > 0 && p.lastHitLandedAt > (p._fxVisto ?? -1)) {
      p._fxVisto = p.lastHitLandedAt;
      const pos = p.parts.head.translation();
      burstEstrelas(pos);
      powFx(pos);
      som.acerto();
      som.vozDor(VOZES[l.slot]);
      // Golpe mais forte (quanto mais grogue, maior o baque) sacode e congela mais
      trauma = Math.min(1, trauma + 0.5 + p.dano * 0.06);
      hitStop = Math.max(hitStop, 0.05 + p.dano * 0.012);
    }
    if (p.stunUntil > 0 && p.stunUntil > (p._stunVisto ?? 0)) {
      p._stunVisto = p.stunUntil;
      puffFx(p.parts.pelvis.translation());
    }
    // NOCAUTE: desabou mole (dá pra agarrar e arrastar) — baque forte + estrelas + grito
    if (p.lastKnockdownAt > (p._sKO ?? -1)) {
      p._sKO = p.lastKnockdownAt;
      const hp = p.parts.head.translation();
      burstEstrelas(hp); powFx(hp); som.bolada(); som.vozChoro(VOZES[l.slot]);
      trauma = 1; hitStop = Math.max(hitStop, 0.1);
    }
    if (p.lastPunchStartAt > (p._sSoco ?? -1)) { p._sSoco = p.lastPunchStartAt; som.soco(); som.vozSoco(VOZES[l.slot]); }
    if (p.lastCabecadaAt > (p._sCab ?? -1)) { p._sCab = p.lastCabecadaAt; som.soco(); som.vozSoco(VOZES[l.slot]); trauma = Math.min(1, trauma + 0.4); hitStop = Math.max(hitStop, 0.06); }
    if (p.lastChuteAt > (p._sChu ?? -1)) { p._sChu = p.lastChuteAt; som.soco(); }
    if (p.lastJumpAt > (p._sPulo ?? -1)) { p._sPulo = p.lastJumpAt; som.pulo(); }
    if (p.lastGrabAt > (p._sGarra ?? -1)) {
      p._sGarra = p.lastGrabAt;
      som.agarra();
      if (p.hangingOnLedge()) som.vozUe(VOZES[l.slot]);
    }
    if (p.lastThrowAt > (p._sArr ?? -1)) { p._sArr = p.lastThrowAt; som.arremesso(); trauma = Math.min(1, trauma + 0.4); hitStop = Math.max(hitStop, 0.06); }
    if (p.lastDashAt > (p._sDash ?? -1)) {
      p._sDash = p.lastDashAt;
      som.arremesso();
      puffFx(p.parts.pelvis.translation());
    }
    if (p.lastEsquivaAt > (p._sEsq ?? -1)) {
      p._sEsq = p.lastEsquivaAt;
      som.esquiva?.();
      puffFx(p.parts.pelvis.translation());
    }
    if (p.lastEmoteAt > (p._sEmote ?? -1)) {
      p._sEmote = p.lastEmoteAt;
      som.vozYay(VOZES[l.slot]);
      const hp = p.parts.head.translation();
      spawnFx(emoteTex, hp, { dy: 0.55, escala: 0.32, vida: 0.9, vy: 0.6, cresce: 0.4, teto: 0.5 });
    }
  }
  updateEfeitos(fdt);
  mirarHolofotes(simNow);
  cairConfetes(fdt, simNow);

  // Câmera segue o meio da briga (com chacoalhada nos impactos)
  trauma = Math.max(0, trauma - 2.4 * fdt);
  let midX = 0, midZ = 0, spread = 4;
  const vv = lutadores.length ? (vivos().length ? vivos() : lutadores) : null;
  if (vv) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const l of vv) {
      const p = l.rag.parts.pelvis.translation();
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    midX = (minX + maxX) / 2;
    midZ = (minZ + maxZ) / 2;
    spread = Math.min(Math.hypot(maxX - minX, maxZ - minZ), 12);
  }
  if (PARAMS.has('debug') && lutadores[0]) {
    const q = lutadores[0].rag.parts.pelvis.rotation();
    const yawQ = (r) => Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y)).toFixed(2);
    const d = $('debug');
    d.style.display = 'block';
    d.textContent = `t=${simNow.toFixed(1)}s estado=${state} vivos=${vivos().length} yaw0=${yawQ(q)}`;
  }
  if (PARAMS.has('zoom')) {
    camPos.set(midX * 0.6, 1.9, 3.6);
    camera.position.copy(camPos);
    camera.lookAt(midX * 0.6, 1.05, 0);
  } else {
    const target = new THREE.Vector3(midX * 0.6, 3.9 + spread * 0.3, 6.6 + spread * 0.55);
    camPos.lerp(target, 0.05);
    camera.position.copy(camPos);
    camera.lookAt(midX * 0.6, 0.8, midZ * 0.3);
  }
  const shake = trauma * trauma * 0.26;
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;

  updateHudBarras(simNow);
  atualizarSkins();
  renderCena();
}

// ---------- Início ----------
setMapa(parseInt(PARAMS.get('mapa'), 10) || 0);
if (PARAMS.has('servidor')) {
  iniciarOnline();
} else if (PARAMS.has('direto')) {
  // dev: pula a seleção; ?bots=N adiciona N bots
  $('selecao').style.display = 'none';
  const nBots = Math.min(parseInt(PARAMS.get('bots'), 10) || 0, 3);
  const configs = [{ ...selCfg[0] }, { ...selCfg[1] }];
  // ?cpu: os dois lutadores base viram bots (auto-luta pra demo/screenshot)
  if (PARAMS.has('cpu')) { configs[0].tipo = 'cpu'; configs[1].tipo = 'cpu'; }
  for (let i = 0; i < nBots; i++) configs.push({ tipo: 'cpu', skin: (4 + i * 3) % SKINS.length });
  montarLutadores(configs.slice(0, 4));
  updateScore();
  state = 'luta';
} else {
  // dois lutadores de enfeite atrás do menu
  montarLutadores([{ ...selCfg[0] }, { ...selCfg[1] }]);
  updateScore();
  mostrarSelecao();
}

// ?avancar=N na URL: simula N segundos de física antes do primeiro frame (debug/screenshot)
const avancar = online ? 0 : parseFloat(PARAMS.get('avancar') || '0');
for (let i = 0; i < avancar * 60; i++) {
  simNow += FIXED_DT;
  const lutando = state === 'luta';
  for (const l of lutadores) l.rag.update(FIXED_DT, simNow, lutando && l.vivo ? inputDoLutador(l) : IDLE_IN);
  world.step();
  if (state === 'luta') { gravarReplay(); handleRounds(simNow); }
}

document.getElementById('carregando').style.display = 'none';
document.getElementById('versao').textContent = VERSAO;
requestAnimationFrame(frame);
