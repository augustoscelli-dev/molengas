import * as THREE from '../libs/three.module.js';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from './ragdoll.js';
import { MAPS, readInput, isDown } from './input.js';
import { SKINS, getFaceTexture, toonMat, addOutline, vinilMat } from './skins.js';
import { som, initSom } from './som.js';
import { readGamepad, mergeInput } from './gamepad.js';

await RAPIER.init();

const WIN_SCORE = 5;
const IDLE_IN = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };

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
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  r3.setSize(innerWidth, innerHeight);
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
  mapa.semSoco = !!MAPAS[mapaIdx].semSoco;
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
  // Direção aprovada F1: corpo de gominha translúcida com verniz de vinil
  const opCorpo = skin.opacidade ?? 0.9;
  const matFor = (cat) => mats[cat] ||= vinilMat(THREE, skin.cores[cat], opCorpo);
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
      // Barril arredondado (estilo Gang Beasts), não bola
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
        matTorso = vinilMat(THREE, 0xffffff, 1); // skins "vestidas" são opacas
        matTorso.map = skin._texTorso;
      }
      obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.18, 6, 16), matTorso);
      obj.scale.set(1.15, 1.05, 0.9);
      obj.castShadow = true;
      addOutline(THREE, obj);
      obj._baseY = 1.05;
      if (!skin.semBarriga) {
        const corBarriga = skin.cores.barriga ?? clarear(skin.cores.torso, 0.38);
        const barriga = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), vinilMat(THREE, corBarriga, Math.min(1, opCorpo + 0.06)));
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
      // Luvas e botas em vinil opaco mais escuro (peças do brinquedo)
      if (spec.name.startsWith('forearm')) {
        const mao = bolinha(mats.maos ||= vinilMat(THREE, escurecer(skin.cores.arms, 0.28), 1), spec.r * 1.55);
        mao.position.y = -(spec.hh + spec.r * 0.5);
        obj.add(mao);
      }
      if (spec.name.startsWith('calf')) {
        // Botinha: capsulinha deitada apontando pra frente
        const pe = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.062, 0.09, 6, 12),
          mats.pes ||= vinilMat(THREE, escurecer(skin.cores.legs, 0.28), 1),
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

function syncVisual(rag, meshes, now) {
  for (const spec of PARTS) {
    const b = rag.parts[spec.name];
    const m = meshes[spec.name];
    const t = b.translation();
    const r = b.rotation();
    m.position.set(t.x, t.y, t.z);
    m.quaternion.set(r.x, r.y, r.z, r.w);
  }
  // Respiração sutil
  meshes.torso.scale.y = meshes.torso._baseY * (1 + 0.028 * Math.sin(now * 2.6 + meshes._fase));
  // Squash & stretch da cabeça no impacto
  const desdeHit = now - rag.lastHitLandedAt;
  if (desdeHit >= 0 && desdeHit < 0.18) {
    const k = 0.32 * (1 - desdeHit / 0.18);
    meshes.head.scale.set(1.42 * (1 + k), 1.42 * (1 - k * 0.65), 1.42 * (1 + k));
  } else {
    meshes.head.scale.setScalar(1.42);
  }
  // Carinha: nocaute > piscada > normal
  const piscando = ((now + meshes._fase) % 3.4) < 0.13;
  const variante = rag.isStunned(now) ? 'x' : (piscando ? 'blink' : 'ok');
  meshes._face.material.map = getFaceTexture(THREE, meshes._skin.face, variante);
}

// ---------- Lutadores (2 a 4, humanos e bots) ----------
// tipos de controle: 'kb1' (WASD+gp0) | 'kb2' (setas+gp1) | 'gp' | 'cpu'
const VOZES = [0.9, 1.15, 0.75, 1.35]; // timbre por slot
let lutadores = [];

function montarLutadores(configs) {
  for (const l of lutadores) {
    destroyVisual(l.meshes);
    l.rag.destroy();
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
    const meshes = buildVisual(SKINS[cfg.skin], i * 1.9);
    return { rag, meshes, cfg, slot: i, vivo: true, score: 0 };
  });
  for (const l of lutadores) l.rag.rivals = lutadores.filter((o) => o !== l).map((o) => o.rag);
}

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
    // agarrou alguém? arrasta pra borda mais próxima
    if (l.rag.grabJoints[0] || l.rag.grabJoints[1]) {
      const rl = Math.hypot(me.x, me.z) || 1;
      out.move.x = me.x / rl;
      out.move.z = me.z / rl;
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
    l.meshes = buildVisual(SKINS[selCfg[i].skin], i * 1.9);
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
  const configs = selCfg.filter((c) => c.ativo).map((c) => ({ ...c }));
  montarLutadores(configs);
  mapa.reset?.(true);
  updateScore();
  som.confirmar();
  som.musica('luta');
  startIntro(1);
}

function updateScore() {
  if (!lutadores.length) { $('placar').innerHTML = ''; return; }
  $('placar').innerHTML = lutadores.map((l) => {
    const s = SKINS[l.cfg.skin];
    return `<img class="retrato" src="${ASSET(`assets/retratos/${s.id}.jpg`)}" onerror="this.style.display='none'">` +
      `<span>${l.score}</span>`;
  }).join(' &nbsp;·&nbsp; ');
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
      v = { skin: pl.sk, meshes: buildVisual(SKINS[pl.sk % SKINS.length], pl.s * 1.9) };
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
  const shake = trauma * trauma * 0.2;
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;
  r3.render(scene, camera);
}

// ---------- Loop ----------
const FIXED_DT = 1 / 60;
world.timestep = FIXED_DT;
let acc = 0;
let last = performance.now();
let simNow = 0;
let trauma = 0;
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
    r3.render(scene, camera);
    return;
  }

  acc += fdt;
  while (acc >= FIXED_DT) {
    acc -= FIXED_DT;
    simNow += FIXED_DT;
    const lutando = state === 'luta';
    for (const l of lutadores) {
      let inp = lutando && l.vivo ? inputDoLutador(l) : IDLE_IN;
      if (inp !== IDLE_IN) {
        if (mapa.semSoco && inp.punch) inp = { ...inp, punch: false };
        if (l.cfg.tipo !== 'cpu') detectarDash(l, inp, simNow);
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
      trauma = Math.min(1, trauma + 0.55);
    }
    if (p.stunUntil > 0 && p.stunUntil > (p._stunVisto ?? 0)) {
      p._stunVisto = p.stunUntil;
      puffFx(p.parts.pelvis.translation());
    }
    if (p.lastPunchStartAt > (p._sSoco ?? -1)) { p._sSoco = p.lastPunchStartAt; som.soco(); som.vozSoco(VOZES[l.slot]); }
    if (p.lastJumpAt > (p._sPulo ?? -1)) { p._sPulo = p.lastJumpAt; som.pulo(); }
    if (p.lastGrabAt > (p._sGarra ?? -1)) {
      p._sGarra = p.lastGrabAt;
      som.agarra();
      if (p.hangingOnLedge()) som.vozUe(VOZES[l.slot]);
    }
    if (p.lastThrowAt > (p._sArr ?? -1)) { p._sArr = p.lastThrowAt; som.arremesso(); }
    if (p.lastDashAt > (p._sDash ?? -1)) {
      p._sDash = p.lastDashAt;
      som.arremesso();
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
  const shake = trauma * trauma * 0.2;
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;

  r3.render(scene, camera);
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
requestAnimationFrame(frame);
