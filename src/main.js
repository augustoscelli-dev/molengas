import * as THREE from '../libs/three.module.js';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from './ragdoll.js';
import { MAPS, readInput, isDown } from './input.js';
import { SKINS, getFaceTexture, toonMat, addOutline } from './skins.js';

await RAPIER.init();

const WIN_SCORE = 5;

// Na versão publicada (arquivo único), os assets viram data-URIs injetados aqui.
const ASSET = (p) => (globalThis.MOLENGAS_ASSETS && globalThis.MOLENGAS_ASSETS[p]) || p;
// localStorage pode ser bloqueado em iframe — falha silenciosa.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- Física ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const GROUND_GROUPS = (0x0001 << 16) | 0xffff;
const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
world.createCollider(
  RAPIER.ColliderDesc.cuboid(ARENA.halfX, 0.3, ARENA.halfZ).setFriction(0.8).setCollisionGroups(GROUND_GROUPS),
  groundBody,
);

const p1 = new Ragdoll(RAPIER, world, { x: -2.2, z: 0, heading: Math.PI / 2, memberships: 0x0002, filter: 0x0001 | 0x0004 });
const p2 = new Ragdoll(RAPIER, world, { x: 2.2, z: 0, heading: -Math.PI / 2, memberships: 0x0004, filter: 0x0001 | 0x0002 });
p1.opponent = p2;
p2.opponent = p1;

// ---------- Cena ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141433);
scene.fog = new THREE.Fog(0x141433, 22, 55);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 10);

function criarRenderer() {
  // O contexto WebGL pode falhar por estado do navegador (GPU travada etc.) —
  // tenta configurações cada vez mais conservadoras antes de desistir.
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
const renderer = criarRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xccccff, 0x443344, 1.05));
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

// Plataforma
const deckTex = makeDeckTexture();
const deck = new THREE.Mesh(
  new THREE.BoxGeometry(ARENA.halfX * 2, 0.6, ARENA.halfZ * 2),
  new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }),
);
deck.position.y = -0.3;
deck.receiveShadow = true;
scene.add(deck);

// Fundo (arte do Pollinations, se existir; senão fica só o céu)
new THREE.TextureLoader().load(ASSET('assets/fundo.jpg'), (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 62.5),
    new THREE.MeshBasicMaterial({ map: tex, fog: false }),
  );
  back.position.set(0, 6, -42);
  scene.add(back);
}, undefined, () => {});

// ---------- Visual dos bonecos ----------
const CATEGORIA = {
  head: 'head', torso: 'torso', pelvis: 'pelvis',
  upperArmL: 'arms', upperArmR: 'arms', forearmL: 'arms', forearmR: 'arms',
  thighL: 'legs', thighR: 'legs', calfL: 'legs', calfR: 'legs',
};

// Gordurinha visual por categoria (a física continua com as medidas originais)
const FOFURA = { arms: 1.28, legs: 1.22 };

function clarear(cor, t) {
  const f = (v) => Math.round(v + (255 - v) * t);
  return (f((cor >> 16) & 255) << 16) | (f((cor >> 8) & 255) << 8) | f(cor & 255);
}

function buildVisual(skin, fase = 0) {
  const meshes = { _skin: skin, _fase: fase };
  const mats = {};
  const matFor = (cat) => mats[cat] ||= toonMat(THREE, skin.cores[cat]);
  const bolinha = (mat, r, escala) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
    if (escala) b.scale.set(...escala);
    b.castShadow = true;
    addOutline(THREE, b);
    return b;
  };
  for (const spec of PARTS) {
    const cat = CATEGORIA[spec.name];
    let obj;
    if (spec.shape === 'ball') {
      obj = new THREE.Group();
      obj.scale.setScalar(1.42); // cabeçona
      const skull = bolinha(matFor('head'), spec.r, [1, 1.07, 1.01]);
      obj.add(skull);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(spec.r * 0.9, 24),
        new THREE.MeshBasicMaterial({ map: getFaceTexture(THREE, skin.face, 'ok'), transparent: true }),
      );
      face.position.set(0, -0.008, spec.r + 0.006);
      obj.add(face);
      meshes._face = face;
    } else if (spec.name === 'torso') {
      // Tronco = ovo gorducho com barriguinha
      obj = bolinha(matFor('torso'), 0.19, [1.12, 1.42, 1.02]);
      obj._baseY = 1.42;
      const corBarriga = skin.cores.barriga ?? clarear(skin.cores.torso, 0.38);
      const barriga = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), toonMat(THREE, corBarriga));
      barriga.position.set(0, -0.03, 0.078);
      barriga.scale.set(0.8, 0.92, 0.5);
      obj.add(barriga);
    } else if (spec.name === 'pelvis') {
      obj = bolinha(matFor('pelvis'), 0.185, [1.14, 1.0, 1.06]);
    } else {
      const gordo = spec.r * FOFURA[cat];
      obj = new THREE.Mesh(new THREE.CapsuleGeometry(gordo, spec.hh * 2, 6, 14), matFor(cat));
      obj.castShadow = true;
      addOutline(THREE, obj);
      // Tampas nas juntas (ombro/cotovelo/quadril/joelho) pra dobra ficar contínua
      if (spec.name.startsWith('upperArm') || spec.name.startsWith('thigh')) {
        for (const py of [spec.hh, -spec.hh]) {
          const cap = bolinha(matFor(cat), gordo * 1.03);
          cap.position.y = py;
          obj.add(cap);
        }
      }
      // Mãozinhas e pezinhos
      if (spec.name.startsWith('forearm')) {
        const mao = bolinha(matFor('arms'), spec.r * 1.5);
        mao.position.y = -(spec.hh + spec.r * 0.5);
        obj.add(mao);
      }
      if (spec.name.startsWith('calf')) {
        const pe = bolinha(matFor('legs'), spec.r * 1.45, [1, 0.55, 1.4]);
        pe.position.set(0, -(spec.hh + spec.r * 0.35), 0.04);
        obj.add(pe);
      }
    }
    scene.add(obj);
    meshes[spec.name] = obj;
  }
  skin.extras(THREE, { head: meshes.head, torso: meshes.torso, pelvis: meshes.pelvis });
  return meshes;
}

function destroyVisual(meshes) {
  for (const spec of PARTS) {
    const obj = meshes[spec.name];
    scene.remove(obj);
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.map) o.material.dispose();
    });
  }
}

const lerSkin = (k, padrao) => {
  const v = parseInt(store.get(k), 10);
  return (Number.isFinite(v) ? v : padrao) % SKINS.length;
};
const skinIdx = [lerSkin('molengas_skin0', 2), lerSkin('molengas_skin1', 6)];
const visuals = [null, null];
function setSkin(i, idx) {
  skinIdx[i] = ((idx % SKINS.length) + SKINS.length) % SKINS.length;
  store.set('molengas_skin' + i, skinIdx[i]);
  if (visuals[i]) destroyVisual(visuals[i]);
  visuals[i] = buildVisual(SKINS[skinIdx[i]], i * 1.9);
  updateScore();
}
addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') setSkin(0, skinIdx[0] + 1);
  if (e.code === 'Digit2') setSkin(1, skinIdx[1] + 1);
});

function makeDeckTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  // tábuas com variação de tom
  const tons = ['#eccb79', '#e5c06a', '#f0d287', '#e2ba5e', '#eac672', '#e8c46d', '#f2d68e', '#e0b75a'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tons[i];
    g.fillRect(i * 128, 0, 128, 768);
    g.fillStyle = 'rgba(120,80,20,0.35)';
    g.fillRect(i * 128, 0, 5, 768);
  }
  // frisos horizontais sutis (emendas das tábuas, desencontradas)
  g.fillStyle = 'rgba(120,80,20,0.22)';
  for (let i = 0; i < 8; i++) {
    for (let y = ((i * 7) % 4) * 96 + 60; y < 768; y += 384) g.fillRect(i * 128, y, 128, 4);
  }
  // borda dupla: vermelha + friso creme
  g.strokeStyle = '#c2413b';
  g.lineWidth = 30;
  g.strokeRect(30, 30, 1024 - 60, 768 - 60);
  g.strokeStyle = '#f7ead0';
  g.lineWidth = 6;
  g.strokeRect(56, 56, 1024 - 112, 768 - 112);
  // vinheta suave nas bordas
  const v = g.createRadialGradient(512, 384, 260, 512, 384, 660);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(70,35,10,0.28)');
  g.fillStyle = v;
  g.fillRect(0, 0, 1024, 768);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function syncVisual(ragdoll, meshes, now) {
  for (const spec of PARTS) {
    const b = ragdoll.parts[spec.name];
    const m = meshes[spec.name];
    const t = b.translation();
    const r = b.rotation();
    m.position.set(t.x, t.y, t.z);
    m.quaternion.set(r.x, r.y, r.z, r.w);
  }
  // Respiração sutil
  meshes.torso.scale.y = meshes.torso._baseY * (1 + 0.028 * Math.sin(now * 2.6 + meshes._fase));
  // Carinha: nocaute > piscada > normal
  const piscando = ((now + meshes._fase) % 3.4) < 0.13;
  const variante = ragdoll.isStunned(now) ? 'x' : (piscando ? 'blink' : 'ok');
  meshes._face.material.map = getFaceTexture(THREE, meshes._skin.face, variante);
}

// ---------- Estrelinhas de impacto ----------
function makeStarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const starTex = makeStarTexture();
const efeitos = [];
function burstEstrelas(pos) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
    s.position.set(pos.x, pos.y + 0.1, pos.z);
    s.scale.setScalar(0.24);
    scene.add(s);
    efeitos.push({ s, vx: Math.cos(a) * 1.8, vy: 1.6 + (i % 3) * 0.6, vz: Math.sin(a) * 1.2, vida: 0.55 });
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
    e.vy -= 4.5 * dt;
    e.s.position.x += e.vx * dt;
    e.s.position.y += e.vy * dt;
    e.s.position.z += e.vz * dt;
    e.s.material.opacity = Math.min(1, e.vida * 3);
    e.s.material.rotation += 6 * dt;
  }
}

// ---------- HUD / rounds ----------
const $ = (id) => document.getElementById(id);
const score = [0, 0];
let state = 'luta'; // luta | ponto | fim
let stateUntil = 0;

function updateScore() {
  const s0 = SKINS[skinIdx[0]], s1 = SKINS[skinIdx[1]];
  $('placar').innerHTML =
    `<img class="retrato" src="${ASSET(`assets/retratos/${s0.id}.jpg`)}" onerror="this.style.display='none'">` +
    `<span style="color:#ff8080">${s0.nome} ${score[0]}</span> &nbsp;×&nbsp; ` +
    `<span style="color:#80c0ff">${score[1]} ${s1.nome}</span>` +
    `<img class="retrato" src="${ASSET(`assets/retratos/${s1.id}.jpg`)}" onerror="this.style.display='none'">`;
}
function showMsg(txt, sub = '') {
  $('msg').innerHTML = txt + (sub ? `<div class="sub">${sub}</div>` : '');
  $('msg').style.display = txt ? 'block' : 'none';
}
setSkin(0, skinIdx[0]);
setSkin(1, skinIdx[1]);
showMsg('MOLENGAS!', 'Derrube o outro da arena — primeiro a fazer ' + WIN_SCORE + ' pontos vence · teclas 1 e 2 trocam as fantasias');
setTimeout(() => { if (state === 'luta') showMsg(''); }, 3500);

function handleRounds(now) {
  if (state === 'luta') {
    const y1 = p1.parts.pelvis.translation().y;
    const y2 = p2.parts.pelvis.translation().y;
    if (y1 < -8 || y2 < -8) {
      const winner = y1 < -8 ? 1 : 0;
      score[winner]++;
      updateScore();
      state = 'ponto';
      stateUntil = now + 1.6;
      const nome = SKINS[skinIdx[winner]].nome;
      if (score[winner] >= WIN_SCORE) {
        state = 'fim';
        showMsg('🏆 ' + nome + ' VENCEU!', 'Aperte R pra recomeçar');
      } else {
        showMsg('PONTO DO ' + nome + '!');
      }
    }
  } else if (state === 'ponto' && now > stateUntil) {
    p1.reset(); p2.reset();
    showMsg('');
    state = 'luta';
  } else if (state === 'fim' && isDown('KeyR')) {
    score[0] = score[1] = 0;
    updateScore();
    p1.reset(); p2.reset();
    showMsg('');
    state = 'luta';
  }
}

// ---------- Loop ----------
const FIXED_DT = 1 / 60;
world.timestep = FIXED_DT;
let acc = 0;
let last = performance.now();
let simNow = 0;

function frame(t) {
  requestAnimationFrame(frame);
  const fdt = Math.min((t - last) / 1000, 0.1);
  acc += fdt;
  last = t;

  while (acc >= FIXED_DT) {
    acc -= FIXED_DT;
    simNow += FIXED_DT;
    if (state !== 'fim') {
      p1.update(FIXED_DT, simNow, readInput(MAPS.p1));
      p2.update(FIXED_DT, simNow, readInput(MAPS.p2));
    }
    world.step();
    handleRounds(simNow);
  }

  syncVisual(p1, visuals[0], simNow);
  syncVisual(p2, visuals[1], simNow);

  // Estrelinhas quando um soco conecta
  for (const p of [p1, p2]) {
    if (p.lastHitLandedAt > 0 && p.lastHitLandedAt > (p._fxVisto ?? -1)) {
      p._fxVisto = p.lastHitLandedAt;
      burstEstrelas(p.parts.head.translation());
    }
  }
  updateEfeitos(fdt);

  // Câmera segue o meio da briga
  const a = p1.parts.pelvis.translation();
  const b = p2.parts.pelvis.translation();
  const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
  const spread = Math.min(Math.hypot(a.x - b.x, a.z - b.z), 12);
  if (new URLSearchParams(location.search).has('debug')) {
    const q = p1.parts.pelvis.rotation();
    const qh = p1.parts.head.rotation();
    const yawQ = (r) => {
      const fx = 2 * (r.x * r.z + r.w * r.y);
      const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
      return Math.atan2(fx, fz).toFixed(2);
    };
    const d = document.getElementById('debug');
    d.style.display = 'block';
    d.textContent = `t=${simNow.toFixed(1)}s heading=${p1.heading.toFixed(2)} pelvisYaw=${yawQ(q)} headYaw=${yawQ(qh)}`;
  }
  // ?zoom na URL = câmera de retrato, pra inspecionar as fantasias de perto
  if (new URLSearchParams(location.search).has('zoom')) {
    camera.position.set(midX * 0.6, 1.9, 3.6);
    camera.lookAt(midX * 0.6, 1.05, 0);
  } else {
    const target = new THREE.Vector3(midX * 0.6, 3.9 + spread * 0.3, 6.6 + spread * 0.55);
    camera.position.lerp(target, 0.05);
    camera.lookAt(midX * 0.6, 0.8, midZ * 0.3);
  }

  renderer.render(scene, camera);
}
// ?avancar=N na URL: simula N segundos de física antes do primeiro frame (debug/screenshot)
const avancar = parseFloat(new URLSearchParams(location.search).get('avancar') || '0');
for (let i = 0; i < avancar * 60; i++) {
  simNow += FIXED_DT;
  p1.update(FIXED_DT, simNow, readInput(MAPS.p1));
  p2.update(FIXED_DT, simNow, readInput(MAPS.p2));
  world.step();
}

document.getElementById('carregando').style.display = 'none';
requestAnimationFrame(frame);
