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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
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

// Gordurinha visual por categoria (a física continua com as medidas originais)
const FOFURA = { arms: 1.28, legs: 1.22 };

function clarear(cor, t) {
  const f = (v) => Math.round(v + (255 - v) * t);
  return (f((cor >> 16) & 255) << 16) | (f((cor >> 8) & 255) << 8) | f(cor & 255);
}
function escurecer(cor, t) {
  const f = (v) => Math.round(v * (1 - t));
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
      const skull = bolinha(matFor('head'), spec.r, [1, 1.03, 0.96]);
      obj.add(skull);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(spec.r * 0.9, 24),
        new THREE.MeshBasicMaterial({ map: getFaceTexture(THREE, skin.face, 'ok'), transparent: true }),
      );
      face.position.set(0, -0.008, spec.r + 0.006);
      obj.add(face);
      meshes._face = face;
    } else if (spec.name === 'torso') {
      // Tronco = ovo gorducho com barriguinha (ou textura de roupa, se a skin tiver)
      let matTorso = matFor('torso');
      if (skin.texturaTorso) {
        skin._texTorso ||= (() => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          skin.texturaTorso(c.getContext('2d'));
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          return t;
        })();
        matTorso = toonMat(THREE, 0xffffff);
        matTorso.map = skin._texTorso;
      }
      // Barril arredondado (estilo Gang Beasts), não bola
      obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.18, 6, 16), matTorso);
      obj.scale.set(1.15, 1.05, 0.9);
      obj.castShadow = true;
      addOutline(THREE, obj);
      obj._baseY = 1.05;
      if (!skin.semBarriga) {
        const corBarriga = skin.cores.barriga ?? clarear(skin.cores.torso, 0.38);
        const barriga = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), toonMat(THREE, corBarriga));
        barriga.position.set(0, -0.04, 0.095);
        barriga.scale.set(0.78, 1.05, 0.5);
        obj.add(barriga);
      }
    } else if (spec.name === 'pelvis') {
      // "Shorts": capsulinha larga e baixa
      obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.08, 6, 16), matFor('pelvis'));
      obj.scale.set(1.25, 0.9, 1.05);
      obj.castShadow = true;
      addOutline(THREE, obj);
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
      // Luvas e botas em tom mais escuro (contraste fofo)
      if (spec.name.startsWith('forearm')) {
        const mao = bolinha(mats.maos ||= toonMat(THREE, escurecer(skin.cores.arms, 0.28)), spec.r * 1.55);
        mao.position.y = -(spec.hh + spec.r * 0.5);
        obj.add(mao);
      }
      if (spec.name.startsWith('calf')) {
        // Botinha: capsulinha deitada apontando pra frente
        const pe = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.062, 0.09, 6, 12),
          mats.pes ||= toonMat(THREE, escurecer(skin.cores.legs, 0.28)),
        );
        pe.rotation.x = Math.PI / 2;
        pe.scale.set(1.05, 1, 0.8);
        pe.position.set(0, -(spec.hh + 0.025), 0.05);
        pe.castShadow = true;
        addOutline(THREE, pe);
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
// ?skins=4,7 na URL força as fantasias (debug/screenshot)
const skinsParam = new URLSearchParams(location.search).get('skins');
if (skinsParam) {
  const [a, b] = skinsParam.split(',').map((n) => parseInt(n, 10));
  if (Number.isFinite(a)) skinIdx[0] = a % SKINS.length;
  if (Number.isFinite(b)) skinIdx[1] = b % SKINS.length;
}
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
  // Squash & stretch da cabeça no impacto
  const desdeHit = now - ragdoll.lastHitLandedAt;
  if (desdeHit >= 0 && desdeHit < 0.18) {
    const k = 0.32 * (1 - desdeHit / 0.18);
    meshes.head.scale.set(1.42 * (1 + k), 1.42 * (1 - k * 0.65), 1.42 * (1 + k));
  } else {
    meshes.head.scale.setScalar(1.42);
  }
  // Carinha: nocaute > piscada > normal
  const piscando = ((now + meshes._fase) % 3.4) < 0.13;
  const variante = ragdoll.isStunned(now) ? 'x' : (piscando ? 'blink' : 'ok');
  meshes._face.material.map = getFaceTexture(THREE, meshes._skin.face, variante);
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
const PARAMS = new URLSearchParams(location.search);
let trauma = 0;
const camPos = new THREE.Vector3(0, 6, 10);

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

  // Efeitos de impacto: estrelas + POF! + chacoalhada quando um soco conecta,
  // poeira quando alguém desaba
  for (const p of [p1, p2]) {
    if (p.lastHitLandedAt > 0 && p.lastHitLandedAt > (p._fxVisto ?? -1)) {
      p._fxVisto = p.lastHitLandedAt;
      const pos = p.parts.head.translation();
      burstEstrelas(pos);
      powFx(pos);
      trauma = Math.min(1, trauma + 0.55);
    }
    if (p.stunUntil > 0 && p.stunUntil > (p._stunVisto ?? 0)) {
      p._stunVisto = p.stunUntil;
      puffFx(p.parts.pelvis.translation());
    }
  }
  updateEfeitos(fdt);
  mirarHolofotes(simNow);
  cairConfetes(fdt, simNow);

  // Câmera segue o meio da briga (com chacoalhada nos impactos)
  trauma = Math.max(0, trauma - 2.4 * fdt);
  const a = p1.parts.pelvis.translation();
  const b = p2.parts.pelvis.translation();
  const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
  const spread = Math.min(Math.hypot(a.x - b.x, a.z - b.z), 12);
  if (PARAMS.has('debug')) {
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
  const shake = trauma * trauma * 0.2;
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;

  renderer.render(scene, camera);
}
// ?avancar=N na URL: simula N segundos de física antes do primeiro frame (debug/screenshot)
const avancar = parseFloat(PARAMS.get('avancar') || '0');
for (let i = 0; i < avancar * 60; i++) {
  simNow += FIXED_DT;
  p1.update(FIXED_DT, simNow, readInput(MAPS.p1));
  p2.update(FIXED_DT, simNow, readInput(MAPS.p2));
  world.step();
}

document.getElementById('carregando').style.display = 'none';
requestAnimationFrame(frame);
