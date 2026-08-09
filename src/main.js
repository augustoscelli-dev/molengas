import * as THREE from '../libs/three.module.js';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from './ragdoll.js';
import { MAPS, readInput, isDown } from './input.js';
import { SKINS, getFaceTexture, toonMat, addOutline } from './skins.js';
import { som, initSom } from './som.js';
import { readGamepad, mergeInput } from './gamepad.js';

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
const PROP_GROUPS = (0x0008 << 16) | 0x000f;

const p1 = new Ragdoll(RAPIER, world, { x: -2.2, z: 0, heading: Math.PI / 2, memberships: 0x0002, filter: 0x0001 | 0x0004 | 0x0008 });
const p2 = new Ragdoll(RAPIER, world, { x: 2.2, z: 0, heading: -Math.PI / 2, memberships: 0x0004, filter: 0x0001 | 0x0002 | 0x0008 });
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

// Textura do tablado (usada pelos mapas)
const deckTex = makeDeckTexture();

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
function chaoFixo(m, hx, hz, mat) {
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(0.8).setCollisionGroups(GROUND_GROUPS), g);
  m.bodies.push(g);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.6, hz * 2), mat);
  deck.position.y = -0.3;
  deck.receiveShadow = true;
  scene.add(deck);
  m.meshes.push(deck);
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
      // Fulcro visual
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
];

let mapaIdx = 0;
let mapa = null;
function setMapa(idx) {
  if (mapa) {
    for (const b of mapa.bodies) world.removeRigidBody(b);
    for (const me of mapa.meshes) scene.remove(me);
  }
  mapaIdx = ((idx % MAPAS.length) + MAPAS.length) % MAPAS.length;
  mapa = { bodies: [], meshes: [], syncPairs: [], props: [], bolas: [], _caixotes: [], reset: null, update: null };
  MAPAS[mapaIdx].build(mapa);
  p1.props = p2.props = mapa.props;
  p1.reset();
  p2.reset();
  const el = document.getElementById('mapa');
  if (el) el.textContent = 'MAPA: ' + MAPAS[mapaIdx].nome + ' · tecla 3 troca';
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
      // Pescocinho ligando a cabeça ao corpo
      const pescoco = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.12, 12), matFor('head'));
      pescoco.position.y = -0.15;
      obj.add(pescoco);
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
  if (e.code === 'Digit3') setMapa(mapaIdx + 1);
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
let state = 'selecao'; // selecao | intro | luta | ponto | fim
let stateUntil = 0;
let introStep = 0;
const sel = { fase: 'skins', conf: [false, false] };

// Som só pode ligar depois de um gesto do usuário (regra do navegador)
const ligarSom = () => initSom();
addEventListener('pointerdown', ligarSom, { once: true });
addEventListener('keydown', ligarSom, { once: true });

function atualizarSelecao() {
  for (const i of [0, 1]) {
    $('sel-img' + i).src = ASSET(`assets/retratos/${SKINS[skinIdx[i]].id}.jpg`);
    $('sel-nome' + i).textContent = SKINS[skinIdx[i]].nome;
    $(i === 0 ? 'sel-p0' : 'sel-p1x').classList.toggle('confirmado', sel.conf[i]);
  }
  $('sel-mapa').style.display = sel.fase === 'mapa' ? 'block' : 'none';
  $('sel-mapa-nome').textContent = MAPAS[mapaIdx].nome;
}
function mostrarSelecao() {
  score[0] = score[1] = 0;
  updateScore();
  sel.fase = 'skins';
  sel.conf[0] = sel.conf[1] = false;
  $('selecao').style.display = 'flex';
  showMsg('');
  state = 'selecao';
  atualizarSelecao();
}
function startIntro(roundN) {
  state = 'intro';
  introStep = 0;
  stateUntil = simNow + 0.9;
  showMsg('ROUND ' + roundN);
}
function iniciarLuta() {
  $('selecao').style.display = 'none';
  p1.reset(); p2.reset(); mapa.reset?.();
  som.confirmar();
  startIntro(1);
}

// Seleção por teclado
addEventListener('keydown', (e) => {
  if (state !== 'selecao') return;
  const mexer = (i, dir) => { setSkin(i, skinIdx[i] + dir); som.selecionar(); };
  if (sel.fase === 'skins') {
    if (!sel.conf[0] && e.code === 'KeyA') mexer(0, -1);
    if (!sel.conf[0] && e.code === 'KeyD') mexer(0, 1);
    if (!sel.conf[0] && e.code === 'KeyF') { sel.conf[0] = true; som.confirmar(); }
    if (!sel.conf[1] && e.code === 'ArrowLeft') mexer(1, -1);
    if (!sel.conf[1] && e.code === 'ArrowRight') mexer(1, 1);
    if (!sel.conf[1] && e.code === 'KeyK') { sel.conf[1] = true; som.confirmar(); }
    if (sel.conf[0] && sel.conf[1]) sel.fase = 'mapa';
  } else {
    if (e.code === 'KeyA') { setMapa(mapaIdx - 1); som.selecionar(); }
    if (e.code === 'KeyD') { setMapa(mapaIdx + 1); som.selecionar(); }
    if (e.code === 'KeyF') { iniciarLuta(); return; }
  }
  atualizarSelecao();
});
// Seleção por gamepad (detecção de borda)
const gpMenuPrev = [{ x: 0, a: false }, { x: 0, a: false }];
function menuGamepad() {
  for (let i = 0; i < 2; i++) {
    const gp = readGamepad(i);
    if (!gp) continue;
    const prev = gpMenuPrev[i];
    const esq = gp.move.x < -0.5 && prev.x >= -0.5;
    const dir = gp.move.x > 0.5 && prev.x <= 0.5;
    const a = gp.jump && !prev.a;
    prev.x = gp.move.x;
    prev.a = gp.jump;
    if (state !== 'selecao') continue;
    if (sel.fase === 'skins') {
      if (!sel.conf[i]) {
        if (esq) { setSkin(i, skinIdx[i] - 1); som.selecionar(); }
        if (dir) { setSkin(i, skinIdx[i] + 1); som.selecionar(); }
        if (a) { sel.conf[i] = true; som.confirmar(); }
      }
      if (sel.conf[0] && sel.conf[1]) sel.fase = 'mapa';
      atualizarSelecao();
    } else if (i === 0) {
      if (esq) { setMapa(mapaIdx - 1); som.selecionar(); }
      if (dir) { setMapa(mapaIdx + 1); som.selecionar(); }
      if (a) { iniciarLuta(); return; }
      atualizarSelecao();
    }
  }
}

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
setMapa(parseInt(new URLSearchParams(location.search).get('mapa'), 10) || 0);
if (new URLSearchParams(location.search).has('direto')) {
  // dev: pula a tela de seleção
  $('selecao').style.display = 'none';
  state = 'luta';
} else {
  mostrarSelecao();
}

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
    const y1 = p1.parts.pelvis.translation().y;
    const y2 = p2.parts.pelvis.translation().y;
    if (y1 < -8 || y2 < -8) {
      const winner = y1 < -8 ? 1 : 0;
      score[winner]++;
      updateScore();
      state = 'ponto';
      stateUntil = now + 1.6;
      const nome = SKINS[skinIdx[winner]].nome;
      som.queda();
      som.torcidaOh();
      if (score[winner] >= WIN_SCORE) {
        state = 'fim';
        som.vitoria();
        showMsg('🏆 ' + nome + ' VENCEU!', 'Aperte R pra voltar à seleção');
      } else {
        som.ponto();
        showMsg('PONTO DO ' + nome + '!');
      }
    }
  } else if (state === 'ponto' && now > stateUntil) {
    p1.reset(); p2.reset(); mapa.reset?.();
    startIntro(score[0] + score[1] + 1);
  } else if (state === 'fim' && isDown('KeyR')) {
    p1.reset(); p2.reset(); mapa.reset?.();
    mostrarSelecao();
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

  const IDLE_IN = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };
  while (acc >= FIXED_DT) {
    acc -= FIXED_DT;
    simNow += FIXED_DT;
    const lutando = state === 'luta';
    p1.update(FIXED_DT, simNow, lutando ? mergeInput(readInput(MAPS.p1), readGamepad(0)) : IDLE_IN);
    p2.update(FIXED_DT, simNow, lutando ? mergeInput(readInput(MAPS.p2), readGamepad(1)) : IDLE_IN);
    world.step();
    handleRounds(simNow);
  }
  menuGamepad();

  syncVisual(p1, visuals[0], simNow);
  syncVisual(p2, visuals[1], simNow);

  // Objetos do mapa seguem a física
  for (const [body, mesh] of mapa.syncPairs) {
    const tp = body.translation();
    const rp = body.rotation();
    mesh.position.set(tp.x, tp.y, tp.z);
    mesh.quaternion.set(rp.x, rp.y, rp.z, rp.w);
  }
  mapa.update?.();

  // Bolada: bola de demolição em velocidade atordoa quem ela atropela
  for (const bolaB of mapa.bolas) {
    const bv = bolaB.linvel();
    if (Math.hypot(bv.x, bv.y, bv.z) < 3) continue;
    const bp = bolaB.translation();
    for (const p of [p1, p2]) {
      if (simNow < (p._bolaCd ?? 0)) continue;
      const tp = p.parts.torso.translation();
      if (Math.hypot(bp.x - tp.x, bp.y - tp.y, bp.z - tp.z) < 0.95) {
        p._bolaCd = simNow + 1.2;
        p.stun(simNow + 1.1);
        p.lastHitLandedAt = simNow;
        som.bolada();
        trauma = Math.min(1, trauma + 0.5);
      }
    }
  }

  // Efeitos de impacto: estrelas + POF! + chacoalhada quando um soco conecta,
  // poeira quando alguém desaba
  for (const p of [p1, p2]) {
    if (p.lastHitLandedAt > 0 && p.lastHitLandedAt > (p._fxVisto ?? -1)) {
      p._fxVisto = p.lastHitLandedAt;
      const pos = p.parts.head.translation();
      burstEstrelas(pos);
      powFx(pos);
      som.acerto();
      trauma = Math.min(1, trauma + 0.55);
    }
    if (p.stunUntil > 0 && p.stunUntil > (p._stunVisto ?? 0)) {
      p._stunVisto = p.stunUntil;
      puffFx(p.parts.pelvis.translation());
    }
    // Ganchos de som (a física marca o instante; aqui a gente toca)
    if (p.lastPunchStartAt > (p._sSoco ?? -1)) { p._sSoco = p.lastPunchStartAt; som.soco(); }
    if (p.lastJumpAt > (p._sPulo ?? -1)) { p._sPulo = p.lastJumpAt; som.pulo(); }
    if (p.lastGrabAt > (p._sGarra ?? -1)) { p._sGarra = p.lastGrabAt; som.agarra(); }
    if (p.lastThrowAt > (p._sArr ?? -1)) { p._sArr = p.lastThrowAt; som.arremesso(); }
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
