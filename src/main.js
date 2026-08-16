import * as THREE from '../libs/three.module.js';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from './ragdoll.js';
import { MAPS, readInput, isDown } from './input.js';
import { SKINS, getFaceTexture, toonMat, addOutline, vinilMat } from './skins.js';
import { som, initSom } from './som.js';
import { readGamepad, mergeInput } from './gamepad.js';
import { initTouch, readTouch, touchAtivo } from './touch.js';
import { AJUSTES } from './ajustes.js';
import { initEditor } from './editor.js';
import { GLTFLoader } from '../libs/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from '../libs/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../libs/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../libs/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../libs/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from '../libs/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from '../libs/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from '../libs/jsm/environments/RoomEnvironment.js';

await RAPIER.init();

// Carimbo visível na tela — se o número não bater com o do repo, é cache velho
const VERSAO = 'v15-cidade';

let WIN_SCORE = 5; // rounds pra vencer a partida (definido pelo modo escolhido)
// Modos de jogo (escolhidos no menu com a tecla N)
const MODOS = [
  { nome: 'MELHOR DE 5', ico: '🏆', desc: 'primeiro a fazer 5 pontos', vitorias: 5, caos: false },
  { nome: 'MELHOR DE 3', ico: '⚡', desc: 'partida rápida: 3 pontos', vitorias: 3, caos: false },
  { nome: 'MORTE SÚBITA', ico: '💀', desc: 'um round só, sem choro', vitorias: 1, caos: false },
  { nome: 'CAOS', ico: '⚔️', desc: 'armas caindo sem parar', vitorias: 5, caos: true },
  { nome: 'REI DO MORRO', ico: '👑', desc: 'domine o centro por 10s', vitorias: 3, caos: false, morro: true },
  { nome: 'DUPLAS 2v2', ico: '🤝', desc: 'você + aliado vs. a dupla rival', vitorias: 3, caos: false, times: true },
];
let modoIdx = 0;
let MODO_CAOS = false; // partida atual usa drop de armas acelerado?
let MODO_MORRO = false;    // partida atual é rei do morro?
let MODO_TIMES = false;    // partida atual é duplas 2v2?
const timeDe = (l) => l.slot % 2; // time 🔴 = slots 0/2 · time 🔵 = slots 1/3
// rivais de um lutador (em DUPLAS, o parceiro não é rival: sem fogo amigo)
const rivaisDe = (l, soVivos) => lutadores.filter((o) =>
  o !== l && (!soVivos || o.vivo) && (!MODO_TIMES || timeDe(o) !== timeDe(l)));
const MORRO_RAIO = 1.25, MORRO_ALVO = 10; // ficar 10s na zona central ganha o round
let morroVis = null, morroTickAt = 0;
const CORES_TIME = [0xff5252, 0x40a0ff]; // 🔴 slots pares · 🔵 slots ímpares
const NOMES_TIME = ['🔴 VERMELHA', '🔵 AZUL'];
let aneisTime = []; // anéis no chão marcando o time de cada lutador (DUPLAS)
function limparAneisTime() {
  for (const a of aneisTime) { scene.remove(a); a.geometry.dispose(); a.material.dispose(); }
  aneisTime = [];
}
// Um anel colorido sob cada lutador pra ler os times de longe (só em DUPLAS).
function criarAneisTime() {
  limparAneisTime();
  if (!MODO_TIMES) return;
  for (const l of lutadores) {
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: CORES_TIME[timeDe(l)], transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    );
    anel.rotation.x = -Math.PI / 2;
    scene.add(anel);
    l._anelTime = anel;
    aneisTime.push(anel);
  }
}
// Dificuldade dos bots: reação, agressividade e mira mudam com o nível.
const NIVEIS = [
  { nome: 'Fácil', reacao: 1.7, esquiva: 0.25, ataque: 1.4, mira: 0.9 },
  { nome: 'Médio', reacao: 1.0, esquiva: 0.55, ataque: 1.0, mira: 0.55 },
  { nome: 'Difícil', reacao: 0.6, esquiva: 0.85, ataque: 0.7, mira: 0.28 },
];
let nivelIdx = 1;
// Modificadores de festa (tecla G na tela de mapa): bagunçam a física da partida toda.
const MODIFS = [
  { id: 'nenhum', nome: 'nenhum' },
  { id: 'lua', nome: 'LUA 🌙 gravidade fraca' },
  { id: 'turbo', nome: 'TURBO ⚡ todo mundo rápido' },
  { id: 'fortoes', nome: 'FORTÕES 💪 socos brutais' },
];
let modifIdx = 0;
function aplicarModificador() {
  const m = MODIFS[modifIdx].id;
  world.gravity = { x: 0, y: m === 'lua' ? -4.2 : -9.81, z: 0 };
  AJUSTES.forcaSoco = m === 'fortoes' ? 1.55 : 1;
  AJUSTES.turbo = m === 'turbo' ? 1.45 : 1; // consumido em aplicarClasse (tração)
}
// Personalidades dos bots (variedade no caos): pesos que enviesam a IA.
//   ataque/esquiva multiplicam a cadência/defesa · borda = quanto busca ring-out · arma = fome de arma
const PERSONAS = [
  { nome: 'brigão',      ataque: 0.82, esquiva: 0.70, borda: 0.8, arma: 1.0 },
  { nome: 'empurrador',  ataque: 0.95, esquiva: 0.90, borda: 1.7, arma: 0.8 },
  { nome: 'oportunista', ataque: 1.00, esquiva: 1.00, borda: 1.2, arma: 1.4 },
  { nome: 'cauteloso',   ataque: 1.18, esquiva: 1.35, borda: 0.9, arma: 1.0 },
];
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
let composer = null, bloomPass = null, smaaPass = null, gradePass = null;
if (USA_BLOOM) {
  composer = new EffectComposer(r3);
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.4, 0.9); // força, raio, limiar
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  // Grade de cor "pôster" DEPOIS do tone map (display-referred): saturação,
  // um S de contraste, calor sutil e vignette. ?nogrande desliga só o grade.
  if (!PARAMS.has('nogrande')) {
    gradePass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, forca: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float forca; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = mix(vec3(l), c.rgb, mix(1.0, 1.14, forca));            // saturação
          c.rgb = (c.rgb - 0.5) * mix(1.0, 1.055, forca) + 0.5 + 0.006 * forca; // contraste
          c.rgb *= mix(vec3(1.0), vec3(1.02, 1.0, 0.985), forca);        // calor sutil
          vec2 q = vUv - 0.5;
          c.rgb *= 1.0 - dot(q, q) * 0.40 * forca;                       // vignette
          gl_FragColor = c;
        }`,
    });
    composer.addPass(gradePass);
  }
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
// Identidade visual por arena: sobrescreve só o que o mapa pedir (o resto fica padrão).
// setMapa restaura o AMBIENTE_PADRAO antes de cada build, então não vaza entre mapas.
function climaMapa(o) {
  if (o.ceu != null) hemi.color.setHex(o.ceu);
  if (o.chao != null) hemi.groundColor.setHex(o.chao);
  if (o.hemiInt != null) hemi.intensity = o.hemiInt;
  if (o.sol != null) sun.color.setHex(o.sol);
  if (o.solInt != null) sun.intensity = o.solInt;
  if (o.fog != null) scene.fog.color.setHex(o.fog);
  if (o.fogNear != null) scene.fog.near = o.fogNear;
  if (o.fogFar != null) scene.fog.far = o.fogFar;
  if (o.expo != null) r3.toneMappingExposure = o.expo;
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
function setFundoTex(tex) { // fundo pintado em canvas (sem depender de arquivo)
  ++fundoPedido; // invalida qualquer load de arquivo em andamento
  backMesh.material.map = tex;
  backMesh.material.color.set(0xffffff);
  backMesh.material.needsUpdate = true;
}
setFundo('assets/fundo.jpg');

// Texturas suaves reusadas na decoração dos mapas (floco de neve / nuvem / fagulha)
const texBolinha = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

// ---------- Fundos pintados (procedurais, por arena) ----------
// Cada um é lazy + memoizado: só desenha na primeira vez que a arena abre.
function fundoCanvas(desenha) {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    desenha(c.getContext('2d'), 1024, 512);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
}
const FUNDOS = {
  tempestade: fundoCanvas((g, W, H) => {
    const ceu = g.createLinearGradient(0, 0, 0, H);
    ceu.addColorStop(0, '#1a2430'); ceu.addColorStop(0.7, '#33424e'); ceu.addColorStop(1, '#46565e');
    g.fillStyle = ceu; g.fillRect(0, 0, W, H);
    // nuvens pesadas em camadas
    for (const [y, r, cor] of [[70, 90, '#222e3a'], [120, 70, '#28343f'], [95, 110, '#1e2a35']]) {
      g.fillStyle = cor;
      for (let x = -40; x < W + 60; x += r * 0.9) {
        g.beginPath(); g.ellipse(x + (y % 50), y + Math.sin(x * 0.02) * 18, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
      }
    }
    // raios
    g.strokeStyle = '#ffe98a'; g.lineWidth = 4; g.lineJoin = 'round';
    for (const x0 of [220, 700]) {
      g.beginPath(); g.moveTo(x0, 120);
      g.lineTo(x0 - 22, 210); g.lineTo(x0 + 8, 220); g.lineTo(x0 - 30, 330);
      g.stroke();
    }
    // chuva diagonal
    g.strokeStyle = 'rgba(200,220,235,.28)'; g.lineWidth = 2;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 14, y + 26); g.stroke();
    }
  }),
  vulcao: fundoCanvas((g, W, H) => {
    const ceu = g.createLinearGradient(0, 0, 0, H);
    ceu.addColorStop(0, '#12060a'); ceu.addColorStop(0.62, '#3a0e0c'); ceu.addColorStop(1, '#7a2410');
    g.fillStyle = ceu; g.fillRect(0, 0, W, H);
    // vulcão com brilho
    g.fillStyle = '#1c0c0c';
    g.beginPath(); g.moveTo(300, H); g.lineTo(470, 150); g.lineTo(520, 150); g.lineTo(700, H); g.closePath(); g.fill();
    const brilho = g.createRadialGradient(495, 150, 8, 495, 150, 130);
    brilho.addColorStop(0, 'rgba(255,150,40,.95)'); brilho.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = brilho; g.fillRect(360, 40, 280, 240);
    g.fillStyle = '#ffb347';
    g.beginPath(); g.ellipse(495, 152, 30, 8, 0, 0, Math.PI * 2); g.fill();
    // rio de lava no horizonte
    g.fillStyle = '#ff7a20'; g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#ffc060';
    for (let x = 0; x < W; x += 34) g.fillRect(x, H - 26, 16, 5);
    // fagulhas
    g.fillStyle = '#ffd080';
    for (let i = 0; i < 60; i++) g.fillRect(Math.random() * W, Math.random() * (H - 80), 3, 3);
  }),
  aurora: fundoCanvas((g, W, H) => {
    const ceu = g.createLinearGradient(0, 0, 0, H);
    ceu.addColorStop(0, '#060c22'); ceu.addColorStop(1, '#12304a');
    g.fillStyle = ceu; g.fillRect(0, 0, W, H);
    // estrelas
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 110; i++) g.fillRect(Math.random() * W, Math.random() * H * 0.6, 2, 2);
    // aurora boreal (faixas translúcidas onduladas)
    for (const [cor, y0, amp] of [['rgba(80,255,180,.30)', 120, 40], ['rgba(120,200,255,.25)', 170, 55], ['rgba(180,120,255,.18)', 90, 30]]) {
      g.fillStyle = cor;
      g.beginPath(); g.moveTo(0, y0);
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y0 + Math.sin(x * 0.012 + y0) * amp);
      for (let x = W; x >= 0; x -= 32) g.lineTo(x, y0 + 90 + Math.sin(x * 0.012 + y0) * amp * 0.7);
      g.closePath(); g.fill();
    }
    // montanhas nevadas
    g.fillStyle = '#dceefb';
    g.beginPath(); g.moveTo(0, H);
    for (const [x, y] of [[0, 400], [140, 300], [260, 390], [420, 260], [560, 380], [720, 290], [860, 400], [1024, 330], [1024, 512]]) g.lineTo(x, y);
    g.closePath(); g.fill();
    g.fillStyle = '#b8d8ee';
    g.beginPath(); g.moveTo(0, H);
    for (const [x, y] of [[0, 460], [200, 380], [380, 460], [600, 360], [800, 450], [1024, 400], [1024, 512]]) g.lineTo(x, y);
    g.closePath(); g.fill();
  }),
  circo: fundoCanvas((g, W, H) => {
    // interior de tenda: listras radiais saindo do topo
    g.fillStyle = '#7a1e2e'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffdf9e';
    const cx = W / 2, cy = -40;
    for (let i = 0; i < 16; i += 2) {
      const a0 = (i / 16) * Math.PI, a1 = ((i + 1) / 16) * Math.PI;
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, 1200, a0, a1); g.closePath(); g.fill();
    }
    // varal de luzinhas
    g.strokeStyle = 'rgba(40,10,10,.55)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 180); g.quadraticCurveTo(W / 2, 300, W, 180); g.stroke();
    const CORES = ['#ffd94a', '#7ee0ff', '#ff5c8a', '#7ed957'];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = t * W, y = 180 + Math.sin(Math.PI * t) * 118;
      g.fillStyle = CORES[i % CORES.length];
      g.beginPath(); g.arc(x, y + 8, 7, 0, Math.PI * 2); g.fill();
    }
  }),
  noite: fundoCanvas((g, W, H) => {
    const ceu = g.createLinearGradient(0, 0, 0, H);
    ceu.addColorStop(0, '#04060f'); ceu.addColorStop(1, '#101830');
    g.fillStyle = ceu; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 130; i++) g.fillRect(Math.random() * W, Math.random() * H * 0.75, 2, 2);
    // lua
    g.fillStyle = '#f4f0dc'; g.beginPath(); g.arc(820, 90, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#04060f'; g.beginPath(); g.arc(836, 80, 34, 0, Math.PI * 2); g.fill();
    // skyline apagado com janelinhas raras acesas
    g.fillStyle = '#0a0e1c';
    let x = 0;
    while (x < W) {
      const w = 60 + Math.random() * 80, h = 120 + Math.random() * 200;
      g.fillRect(x, H - h, w, h);
      g.fillStyle = '#ffd94a';
      for (let i = 0; i < 3; i++) if (Math.random() < 0.5) g.fillRect(x + 8 + Math.random() * (w - 20), H - h + 12 + Math.random() * (h - 30), 6, 8);
      g.fillStyle = '#0a0e1c';
      x += w + 12;
    }
  }),
  fabrica: fundoCanvas((g, W, H) => {
    const parede = g.createLinearGradient(0, 0, 0, H);
    parede.addColorStop(0, '#23262e'); parede.addColorStop(1, '#3a3e49');
    g.fillStyle = parede; g.fillRect(0, 0, W, H);
    // janelões altos
    g.fillStyle = 'rgba(140,190,220,.20)';
    for (let x = 60; x < W; x += 190) g.fillRect(x, 40, 110, 170);
    // canos
    g.strokeStyle = '#171a20'; g.lineWidth = 18;
    g.beginPath(); g.moveTo(0, 250); g.lineTo(W, 250); g.stroke();
    g.beginPath(); g.moveTo(180, 250); g.lineTo(180, 0); g.stroke();
    g.beginPath(); g.moveTo(760, 250); g.lineTo(760, 0); g.stroke();
    // engrenagens de silhueta
    g.fillStyle = '#14161c';
    for (const [cx, cy, r] of [[330, 330, 70], [430, 380, 46], [880, 340, 60]]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(cx + Math.cos(a) * r - 9, cy + Math.sin(a) * r - 9, 18, 18);
      }
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3a3e49'; g.beginPath(); g.arc(cx, cy, r * 0.35, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#14161c';
    }
    // faixa de perigo
    g.fillStyle = '#ffd94a'; g.fillRect(0, H - 46, W, 46);
    g.fillStyle = '#1c1e24';
    for (let x = -40; x < W; x += 80) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 40, H - 46); g.lineTo(x + 80, H - 46); g.lineTo(x + 40, H); g.closePath(); g.fill(); }
  }),
  ceuAberto: fundoCanvas((g, W, H) => {
    const ceu = g.createLinearGradient(0, 0, 0, H);
    ceu.addColorStop(0, '#4aa3e8'); ceu.addColorStop(1, '#bfe4ff');
    g.fillStyle = ceu; g.fillRect(0, 0, W, H);
    // sol com halo
    const halo = g.createRadialGradient(160, 90, 10, 160, 90, 120);
    halo.addColorStop(0, 'rgba(255,240,180,.95)'); halo.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = halo; g.fillRect(20, -30, 300, 260);
    // nuvens fofas em camadas (a de baixo dá sensação de altura)
    const nuvem = (x, y, s, alpha) => {
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      for (const [dx, dy, r] of [[0, 0, 34], [28, -12, 26], [-30, -8, 24], [54, 4, 20], [-52, 6, 18]]) {
        g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); g.fill();
      }
    };
    nuvem(300, 190, 0.9, 0.95); nuvem(650, 120, 0.7, 0.9); nuvem(900, 220, 1.1, 0.92);
    nuvem(140, 330, 1.5, 0.98); nuvem(520, 400, 1.9, 1); nuvem(880, 380, 1.6, 0.97);
  }),
};

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
  martelo: {
    icone: '🔨',
    y0: 0.6, massa: 4.6, alcance: 0.82, forca: 22, // pesadão: swing lento mas manda longe (ring-out fácil)
    collider: () => RAPIER.ColliderDesc.capsule(0.3, 0.09),
    mesh: () => {
      const g = new THREE.Group();
      const cabo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.82, 12), toonMat(THREE, 0x7a4b28));
      const cabeca = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.17), new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.7, roughness: 0.4 }));
      cabeca.position.y = 0.4; g.add(cabo, cabeca);
      return g;
    },
  },
  bomba: {
    icone: '💣',
    y0: 0.4, massa: 2.0, alcance: 0.5, forca: 4,
    bomba: true, fuse: 3.2, raio: 2.5, forcaExpl: 18, // acende ao pegar; joga no rival antes de estourar
    collider: () => RAPIER.ColliderDesc.ball(0.17),
    mesh: () => {
      const g = new THREE.Group();
      const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.5, roughness: 0.5 }));
      const pavio = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.13, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a3a }));
      pavio.position.set(0, 0.22, 0); pavio.rotation.z = 0.35;
      const faisca = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcc33 }));
      faisca.position.set(0.04, 0.29, 0); faisca.name = 'faisca';
      g.add(corpo, pavio, faisca);
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
  // 🪝 GANCHO: soco com ele na mão ARPOA o rival mais próximo à frente e o PUXA.
  gancho: {
    icone: '🪝',
    y0: 0.4, massa: 1.6, alcance: 0.45, forca: 4,
    puxa: true, alcancePuxa: 4.5, cadencia: 1.2,
    collider: () => RAPIER.ColliderDesc.capsule(0.18, 0.07),
    mesh: () => {
      const g = new THREE.Group();
      const mMetal = new THREE.MeshStandardMaterial({ color: 0x8890a0, metalness: 0.85, roughness: 0.3 });
      const cabo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.4, 10), toonMat(THREE, 0x6a4a28));
      const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), mMetal);
      haste.position.y = 0.3;
      const curva = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 10, 16, Math.PI * 1.25), mMetal);
      curva.position.y = 0.42; curva.rotation.z = Math.PI * 0.62;
      g.add(cabo, haste, curva);
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

// Índice de tipo de arma no protocolo online (espelha ARMA_TIPOS do servidor)
const ARMA_TIPOS_CLI = ['bastao', 'cano', 'martelo', 'laser', 'bomba'];
const POWER_TIPOS_CLI = ['cura', 'vel', 'forca', 'escudo']; // espelha POWER_TIPOS do servidor
// Só o mesh de uma arma (usado no online, que recebe a arma pronta do servidor)
function armaMeshDe(tipo) {
  const def = ARMAS_DEF[tipo] || ARMAS_DEF.bastao;
  const mesh = (def.glb && armaGLBcache[def.glb]) ? armaGLBcache[def.glb].clone(true) : def.mesh();
  mesh.castShadow = true;
  return mesh;
}

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
    bomba: !!def.bomba, fuse: def.fuse || 3.2, raio: def.raio || 2.4, forcaExpl: def.forcaExpl || 17, explodeEm: null,
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
    alvo.rag._agr = l.rag; alvo.rag._agrAt = simNow; // autor do tiro
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
// Explosão da bomba: empurrão radial + dano em todo mundo por perto + FX.
function explodirBomba(m, arma) {
  const p = arma.body.translation();
  for (const l of lutadores) if (l.rag.grabJoints.some((g) => g && g.body === arma.body)) l.rag.releaseGrabs();
  for (const l of lutadores) {
    if (!l.vivo) continue;
    const tp = l.rag.parts.torso.translation();
    const dx = tp.x - p.x, dy = tp.y - p.y, dz = tp.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > arma.raio) continue;
    const f = arma.forcaExpl * (1 - d / arma.raio), nl = d || 1;
    for (const pn of ['torso', 'pelvis', 'head']) l.rag.parts[pn].applyImpulse({ x: (dx / nl) * f, y: 3 + f * 0.25, z: (dz / nl) * f }, true);
    l.rag.dano = Math.min(4, l.rag.dano + 2);
    l.rag.stun(simNow + 1.4);
    if (l.rag.dano >= 4 && !l.rag.isDowned(simNow)) l.rag.knockdown(simNow);
    l.rag.lastHitLandedAt = simNow;
  }
  powFx(p); burstEstrelas(p); puffFx(p);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spawnFx(puffTex, p, { escala: 0.5, vida: 0.5, cresce: 2, cor: i % 2 ? 0xff8a3c : 0xffd24a, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: 1.5 }); }
  som.bolada?.(); trauma = 1; hitStop = Math.max(hitStop, 0.1);
  removerArma(m, arma);
}
// Base escura sob a arena: dá espessura/acabamento de "plataforma flutuante"
function baseArena(m, hx, hz) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 2 - 0.35, 1.5, hz * 2 - 0.35),
    new THREE.MeshStandardMaterial({ color: 0x241d38, roughness: 0.95 }),
  );
  base.position.y = -1.35;
  scene.add(base);
  m.meshes.push(base);
  m._base = base; // referência pro online (ABISMO esconde o pedestal)
}
// Pedra escura com listras de perigo nas bordas (ABISMO offline e online)
const texAbismo = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4458'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#3e3950';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 22, 10);
  for (const y of [0, 244]) for (let x = 0; x < 256; x += 24) {
    g.fillStyle = (x / 24) % 2 ? '#ffd94a' : '#221d30'; g.fillRect(x, y, 24, 12);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function chaoFixo(m, hx, hz, mat, atrito = 0.8) {
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(atrito).setCollisionGroups(GROUND_GROUPS), g);
  m.bodies.push(g);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.6, hz * 2), mat);
  deck.position.y = -0.3;
  deck.receiveShadow = true;
  scene.add(deck);
  m.meshes.push(deck);
  m._deck = deck; // referência pro online (variantes de arena mudam o chão)
  baseArena(m, hx, hz);
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
    desc: 'bola de demolição no meio',
    build(m) {
      chaoFixo(m, ARENA.halfX, ARENA.halfZ, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // Ringue de verdade: postes nos cantos + cordas (decoração, sem física)
      const px = ARENA.halfX - 0.2, pz = ARENA.halfZ - 0.2;
      for (const [cx, cz] of [[-px, -pz], [px, -pz], [-px, pz], [px, pz]]) {
        const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 10), toonMat(THREE, 0xd63b30));
        poste.position.set(cx, 0.5, cz); poste.castShadow = true;
        scene.add(poste); m.meshes.push(poste);
      }
      const matCorda = new THREE.MeshBasicMaterial({ color: 0xf5f0ff, transparent: true, opacity: 0.85 });
      for (const h of [0.38, 0.72]) {
        for (const [w, d, x, z] of [[px * 2, 0.04, 0, -pz], [px * 2, 0.04, 0, pz], [0.04, pz * 2, -px, 0], [0.04, pz * 2, px, 0]]) {
          const corda = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), matCorda);
          corda.position.set(x, h, z);
          scene.add(corda); m.meshes.push(corda);
        }
      }
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
    desc: 'a arena inclina com o peso',
    build(m) {
      climaMapa({ ceu: 0xffd8e8, chao: 0x4a2a3a, fog: 0x2a1435, sol: 0xffd0b0, solInt: 1.45 }); // entardecer rosa
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
    desc: 'buracos — cuidado onde pisa',
    build(m) {
      climaMapa({ ceu: 0xfff3c0, chao: 0x5a4410, fog: 0x3a2c0e, sol: 0xffe28a, solInt: 1.5 }); // banho de queijo
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
    desc: 'escorrega que é uma beleza',
    fundoTex: FUNDOS.aurora,
    amb: 'neve',
    trilha: 'gelada',
    build(m) {
      climaMapa({ ceu: 0xd8f0ff, chao: 0x1c3a4a, fog: 0x16283a, sol: 0xcfe8ff, solInt: 1.35, expo: 1.05 }); // frio azulado
      // Pista escorregadia: atrito quase zero + tração reduzida
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: texGelo, roughness: 0.15 }), 0.03);
      m.controle = 0.35;
      fazerCaixote(m, -2.8, 2.2);
      fazerCaixote(m, 2.8, -2.2);
      // neve caindo devagarinho
      const flocos = [];
      for (let i = 0; i < 150; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBolinha, transparent: true, opacity: 0.85, depthWrite: false }));
        s.scale.setScalar(0.05 + Math.random() * 0.06);
        s.position.set((Math.random() * 2 - 1) * 8, Math.random() * 6, (Math.random() * 2 - 1) * 6);
        scene.add(s); m.meshes.push(s);
        flocos.push({ s, v: 0.35 + Math.random() * 0.5, seed: Math.random() * 10 });
      }
      // NEVE ACUMULANDO: camada branca com manchas (alphaMap) que vai cobrindo a
      // pista ao longo da luta — nevasca de verdade, não só enfeite caindo.
      const texNeve = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 340; i++) {
          const r = 8 + Math.random() * 26;
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
          gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.save(); g.translate(Math.random() * 256, Math.random() * 256);
          g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.restore();
        }
        return new THREE.CanvasTexture(c);
      })();
      const manto = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 8),
        new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, transparent: true, opacity: 0, alphaMap: texNeve, depthWrite: false }),
      );
      manto.rotation.x = -Math.PI / 2; manto.position.y = 0.045; manto.receiveShadow = true;
      scene.add(manto); m.meshes.push(manto);
      m.update = (t) => {
        for (const f of flocos) {
          f.s.position.y -= f.v / 60;
          f.s.position.x += Math.sin(t * 0.8 + f.seed) * 0.004;
          if (f.s.position.y < 0) { f.s.position.y = 5.5 + Math.random(); f.s.position.x = (Math.random() * 2 - 1) * 8; f.s.position.z = (Math.random() * 2 - 1) * 6; }
        }
        manto.material.opacity = Math.min(0.85, t * 0.011); // ~80s pra nevasca cobrir tudo
      };
      m.reset = () => resetCaixotes(m);
    },
  },
  {
    nome: 'MORTE SÚBITA',
    desc: 'a plataforma encolhe a cada round',
    build(m) {
      climaMapa({ ceu: 0xffb0a0, chao: 0x401010, fog: 0x330d0d, sol: 0xff8a70, solInt: 1.4, expo: 1.08 }); // vermelho tenso
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
    desc: 'braço giratório varre a arena',
    build(m) {
      climaMapa({ ceu: 0xd0b8ff, chao: 0x2a1440, fog: 0x241040, sol: 0xe8d0ff, solInt: 1.45 }); // arcade roxo
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
      if (eixo.configureMotorVelocity) eixo.configureMotorVelocity(0.7, 260);
      // o braço ACELERA ao longo do round: começa manso, vira um liquidificador
      let t0m = -1;
      m.update = (t) => {
        if (t0m < 0) t0m = t;
        if (eixo.configureMotorVelocity) eixo.configureMotorVelocity(Math.min(2.4, 0.7 + (t - t0m) * 0.05), 260);
      };
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
        t0m = -1; // velocidade volta ao manso a cada round
        braco.setTranslation({ x: 1.95, y: 0.62, z: 0 }, true);
        braco.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        braco.setLinvel({ x: 0, y: 0, z: 0 }, true);
        braco.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
    },
  },
  {
    nome: 'SUMÔ',
    desc: 'sem soco: empurra e arremessa',
    semSoco: true,
    build(m) {
      climaMapa({ ceu: 0xffe2b0, chao: 0x3a2a10, fog: 0x2e2410, sol: 0xffd080, solInt: 1.5 }); // templo dourado
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
    desc: 'a bomba pula de mão em mão',
    build(m) {
      climaMapa({ ceu: 0xffc9a0, chao: 0x3a1c08, fog: 0x2e1608, sol: 0xffa060, solInt: 1.4 }); // alerta laranja
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
    desc: 'prédios desabam e viram arma',
    fundo: 'assets/fundo-cidade.jpg',
    build(m) {
      climaMapa({ ceu: 0x9fb0ff, chao: 0x101430, fog: 0x0d1230, sol: 0xaCC4ff, solInt: 1.2, expo: 1.02 }); // noite neon
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
    desc: 'luta à beira da lagoa',
    fundo: 'assets/fundo-rio.png',
    amb: 'agua',
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
      const matAgua = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.13, metalness: 0.32, transparent: true, opacity: 0.94,
        emissive: 0x14323d, emissiveIntensity: 0.18,
      });
      // Fresnel: na RASANTE a água vira espelho do céu de pôr-do-sol (a cor
      // própria só aparece olhando de cima) — receita da ref. de óptica de água.
      matAgua.onBeforeCompile = (sh) => {
        sh.uniforms.uCeuAgua = { value: new THREE.Color(0xffd9a8).convertSRGBToLinear() };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uCeuAgua;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            {
              vec3 vDir = normalize(vViewPosition);
              float fres = pow(1.0 - abs(dot(vDir, normalize(normal))), 4.0);
              totalEmissiveRadiance += uCeuAgua * min(fres, 0.55) * 0.38;
            }`);
      };
      const agua = new THREE.Mesh(gA, matAgua);
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
        if (m._dead) return; // trocou de mapa antes do GLB chegar: não vaza mesh na cena
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
          if (m._dead) return;
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
        if (m._dead) return; // trocou de mapa: não cria casas (mesh + física) órfãs
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
  {
    nome: 'ESTEIRAS',
    desc: 'o chão te leva — ande contra!',
    fundoTex: FUNDOS.fabrica,
    build(m) {
      // Duas esteiras rolantes em direções opostas — parou de andar, foi levado pra fora
      const texEst = (dir) => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#3a3f4c'; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#262a33'; g.lineWidth = 5;
        for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
        g.fillStyle = '#ffd94a';
        for (let x = 20; x < 256; x += 64) for (let y = 34; y < 256; y += 62) {
          g.beginPath();
          if (dir > 0) { g.moveTo(x, y); g.lineTo(x + 26, y + 14); g.lineTo(x, y + 28); }
          else { g.moveTo(x + 26, y); g.lineTo(x, y + 14); g.lineTo(x + 26, y + 28); }
          g.closePath(); g.fill();
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.5);
        return t;
      };
      const t1 = texEst(1), t2 = texEst(-1);
      const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(5.5, 0.3, 4).setFriction(0.4).setCollisionGroups(GROUND_GROUPS), g);
      m.bodies.push(g);
      const faixa1 = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 4), new THREE.MeshStandardMaterial({ map: t1, roughness: 0.9 }));
      faixa1.position.set(0, -0.3, -2); faixa1.receiveShadow = true; scene.add(faixa1); m.meshes.push(faixa1);
      const faixa2 = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 4), new THREE.MeshStandardMaterial({ map: t2, roughness: 0.9 }));
      faixa2.position.set(0, -0.3, 2); faixa2.receiveShadow = true; scene.add(faixa2); m.meshes.push(faixa2);
      baseArena(m, 5.5, 4);
      m.update = (t) => {
        t1.offset.x = (t * 0.55) % 1; t2.offset.x = (-t * 0.55) % 1;
        const dt = 1 / 60;
        for (const l of lutadores) {
          if (!l.vivo) continue;
          const p = l.rag.parts.pelvis.translation();
          if (p.y > 1.4 || Math.abs(p.x) > 5.5 || Math.abs(p.z) > 4) continue; // no ar/fora
          const dir = p.z < 0 ? 1 : -1; // faixa de trás empurra pra +x, da frente pra -x
          l.rag.parts.pelvis.applyImpulse({ x: dir * 15 * dt, y: 0, z: 0 }, true);
        }
      };
    },
  },
  {
    nome: 'VENDAVAL',
    desc: 'rajadas empurram todo mundo',
    fundoTex: FUNDOS.tempestade,
    amb: 'vento',
    build(m) {
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // céu de tempestade
      hemi.color.setHex(0xaebfd0); hemi.groundColor.setHex(0x2e3a3a); hemi.intensity = 0.9;
      sun.color.setHex(0xdfe8ee); sun.intensity = 1.15;
      scene.fog.color.setHex(0x2a3440); scene.fog.near = 16; scene.fog.far = 48;
      fazerCaixote(m, -2.8, 2.2); fazerCaixote(m, 2.8, -2.2);
      // riscos de vento (sprites esticados, aparecem só na rajada)
      const riscoTex = (() => {
        const c = document.createElement('canvas'); c.width = 128; c.height = 16;
        const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, 128, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 5, 128, 6);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const riscos = [];
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: riscoTex, transparent: true, opacity: 0, depthWrite: false }));
        s.scale.set(1.6, 0.1, 1); scene.add(s); m.meshes.push(s);
        riscos.push({ s, seed: Math.random() * 20 });
      }
      // biruta no canto: aponta pra onde o vento vai soprar (leia e se prepare!)
      const posteB = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), toonMat(THREE, 0xd8d8e2));
      posteB.position.set(4.8, 1.1, -3.4); posteB.castShadow = true;
      scene.add(posteB); m.meshes.push(posteB);
      const biruta = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.85, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xff7a2f, side: THREE.DoubleSide, roughness: 0.8 }),
      );
      biruta.rotation.z = Math.PI / 2; // cone deitado
      const birutaPivo = new THREE.Group();
      birutaPivo.position.set(4.8, 2.05, -3.4);
      birutaPivo.add(biruta); biruta.position.x = 0.45;
      scene.add(birutaPivo); m.meshes.push(birutaPivo);
      let prox = 0, fase = 'calmo', faseAte = 0, dirV = { x: 1, z: 0 };
      m.reset = () => { fase = 'calmo'; prox = 0; resetCaixotes(m); for (const r of riscos) r.s.material.opacity = 0; };
      m.update = (t) => {
        if (prox === 0) prox = t + 5 + Math.random() * 4;
        if (fase === 'calmo' && t > prox) {
          const a = Math.random() * Math.PI * 2; dirV = { x: Math.cos(a), z: Math.sin(a) };
          fase = 'aviso'; faseAte = t + 1.0; som.selecionar?.();
        } else if (fase === 'aviso' && t > faseAte) {
          fase = 'rajada'; faseAte = t + 0.9; trauma = Math.min(1, trauma + 0.25);
        } else if (fase === 'rajada' && t > faseAte) {
          fase = 'calmo'; prox = t + 6 + Math.random() * 5;
        }
        const dt = 1 / 60;
        const forca = fase === 'rajada' ? 42 : 0;
        if (forca) {
          for (const l of lutadores) {
            if (!l.vivo) continue;
            l.rag.parts.pelvis.applyImpulse({ x: dirV.x * forca * dt, y: 2 * dt, z: dirV.z * forca * dt }, true);
            l.rag.parts.torso.applyImpulse({ x: dirV.x * forca * 0.6 * dt, y: 0, z: dirV.z * forca * 0.6 * dt }, true);
          }
          for (const [cb] of m._caixotes) cb.applyImpulse({ x: dirV.x * 10 * dt, y: 0, z: dirV.z * 10 * dt }, true);
        }
        const vis = fase === 'aviso' ? 0.35 : fase === 'rajada' ? 0.9 : 0;
        for (const r of riscos) {
          r.s.material.opacity += (vis - r.s.material.opacity) * 0.2;
          if (vis > 0) {
            const k = ((t * (fase === 'rajada' ? 2.2 : 1.1) + r.seed) % 3) / 3; // 0..1 varrendo a arena
            r.s.position.set(dirV.x * (k * 12 - 6) - dirV.z * ((r.seed % 2.4) - 1.2) * 2.6,
              0.5 + (r.seed % 1.7), dirV.z * (k * 12 - 6) + dirV.x * ((r.seed % 2.4) - 1.2) * 2.6);
            r.s.material.rotation = Math.atan2(-dirV.z, dirV.x);
          }
        }
        // biruta gira pro vento que vem; murcha na calmaria
        const alvoRot = Math.atan2(-dirV.z, dirV.x);
        birutaPivo.rotation.y += (alvoRot - birutaPivo.rotation.y) * 0.08;
        const infla = fase === 'rajada' ? 1 : fase === 'aviso' ? 0.8 : 0.45;
        biruta.scale.x += (infla - biruta.scale.x) * 0.1;
        biruta.rotation.x = Math.sin(t * (fase === 'calmo' ? 2 : 9)) * 0.12;
      };
    },
  },
  {
    nome: 'CHÃO QUENTE',
    desc: 'placas esquentam e caem',
    fundoTex: FUNDOS.vulcao,
    amb: 'lava',
    trilha: 'quente',
    build(m) {
      // Placas esquentam (ficam vermelhas) e caem — leia o aviso e sai de cima!
      hemi.color.setHex(0xffc8a0); hemi.groundColor.setHex(0x50201a); hemi.intensity = 0.95;
      scene.fog.color.setHex(0x3a1410); scene.fog.near = 18; scene.fog.far = 50;
      sun.color.setHex(0xffb37a); sun.intensity = 1.3;
      const tiles = [];
      const NX = 4, NZ = 3, HX = 0.65, HZ = 0.9; // 4×3 placas de 1.3×1.8 (cobre os spawns)
      for (let ix = 0; ix < NX; ix++) for (let iz = 0; iz < NZ; iz++) {
        const cx = (ix - (NX - 1) / 2) * HX * 2, cz = (iz - (NZ - 1) / 2) * HZ * 2;
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, -0.3, cz));
        world.createCollider(RAPIER.ColliderDesc.cuboid(HX - 0.02, 0.3, HZ - 0.02).setFriction(0.8).setCollisionGroups(GROUND_GROUPS), body);
        m.bodies.push(body);
        const mat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, emissive: 0xff2200, emissiveIntensity: 0 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 - 0.06, 0.6, HZ * 2 - 0.06), mat);
        mesh.position.set(cx, -0.3, cz); mesh.receiveShadow = true;
        scene.add(mesh); m.meshes.push(mesh);
        tiles.push({ body, mesh, mat, cx, cz, estado: 'ok', ate: 0 });
      }
      // fagulhas de lava subindo ao redor da arena
      const fagulhas = [];
      for (let i = 0; i < 40; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBolinha, color: 0xff9040, transparent: true, opacity: 0.9, depthWrite: false }));
        s.scale.setScalar(0.05 + Math.random() * 0.05);
        s.position.set((Math.random() * 2 - 1) * 7, Math.random() * 3, (Math.random() * 2 - 1) * 5.5);
        scene.add(s); m.meshes.push(s);
        fagulhas.push({ s, v: 0.4 + Math.random() * 0.7, seed: Math.random() * 10 });
      }
      let prox = 0;
      m.reset = () => {
        prox = 0;
        for (const t of tiles) { t.estado = 'ok'; t.mat.emissiveIntensity = 0; t.body.setTranslation({ x: t.cx, y: -0.3, z: t.cz }, true); t.mesh.position.y = -0.3; }
      };
      m.update = (t) => {
        if (prox === 0) prox = t + 4;
        if (t > prox) {
          prox = t + 3.2 + Math.random() * 1.6;
          const livres = tiles.filter((x) => x.estado === 'ok');
          for (let i = 0; i < Math.min(3, livres.length - 4); i++) { // nunca derruba tudo
            const tile = livres.splice((Math.random() * livres.length) | 0, 1)[0];
            tile.estado = 'quente'; tile.ate = t + 1.5;
          }
        }
        for (const tile of tiles) {
          if (tile.estado === 'quente') {
            tile.mat.emissiveIntensity = 0.25 + 0.55 * Math.abs(Math.sin(t * 9)); // pisca vermelho
            if (t > tile.ate) { tile.estado = 'caiu'; tile.ate = t + 2.4; tile.body.setTranslation({ x: tile.cx, y: -7, z: tile.cz }, true); }
          } else if (tile.estado === 'caiu') {
            tile.mesh.position.y += (-5 - tile.mesh.position.y) * 0.2; tile.mat.emissiveIntensity *= 0.9;
            if (t > tile.ate) { tile.estado = 'ok'; tile.body.setTranslation({ x: tile.cx, y: -0.3, z: tile.cz }, true); }
          } else {
            tile.mat.emissiveIntensity *= 0.85;
            tile.mesh.position.y += (-0.3 - tile.mesh.position.y) * 0.25;
          }
        }
        for (const f of fagulhas) {
          f.s.position.y += f.v / 60;
          f.s.position.x += Math.sin(t * 1.4 + f.seed) * 0.004;
          f.s.material.opacity = 0.5 + 0.4 * Math.sin(t * 6 + f.seed);
          if (f.s.position.y > 3.4) { f.s.position.y = -0.4; f.s.position.x = (Math.random() * 2 - 1) * 7; f.s.position.z = (Math.random() * 2 - 1) * 5.5; }
        }
      };
    },
  },
  {
    nome: 'TRAMPOLIM',
    desc: 'todo mundo quica — voadora!',
    fundoTex: FUNDOS.circo,
    build(m) {
      // Chão elástico: todo mundo quica — a voadora vira a arma principal
      const texTramp = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 512;
        const g = c.getContext('2d');
        g.fillStyle = '#274a8a'; g.fillRect(0, 0, 512, 512);
        g.strokeStyle = '#1a3560'; g.lineWidth = 4;
        for (let i = 64; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
        g.strokeStyle = '#d63b30'; g.lineWidth = 26; g.strokeRect(13, 13, 486, 486);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.3, 3.6).setFriction(0.8).setRestitution(1.6).setCollisionGroups(GROUND_GROUPS), g);
      m.bodies.push(g);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 7.2), new THREE.MeshStandardMaterial({ map: texTramp, roughness: 0.75 }));
      deck.position.y = -0.3; deck.receiveShadow = true; scene.add(deck); m.meshes.push(deck);
      baseArena(m, 5, 3.6);
      // postes de circo + varal de bandeirinhas
      const texBand = (() => {
        const c = document.createElement('canvas'); c.width = 512; c.height = 64;
        const g = c.getContext('2d');
        const CORES = ['#ff5c8a', '#ffd94a', '#7ee0ff', '#7ed957', '#c490ff'];
        g.strokeStyle = 'rgba(40,20,20,.8)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, 4); g.lineTo(512, 4); g.stroke();
        for (let i = 0; i < 10; i++) {
          g.fillStyle = CORES[i % CORES.length];
          g.beginPath(); g.moveTo(i * 51 + 4, 4); g.lineTo(i * 51 + 47, 4); g.lineTo(i * 51 + 25, 56); g.closePath(); g.fill();
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      for (const [x1, z1, x2, z2] of [[-4.7, -3.3, 4.7, -3.3], [-4.7, 3.3, 4.7, 3.3]]) {
        for (const [px, pz] of [[x1, z1], [x2, z2]]) {
          const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8), toonMat(THREE, 0xd63b30));
          poste.position.set(px, 1.3, pz); poste.castShadow = true;
          scene.add(poste); m.meshes.push(poste);
        }
        const larg = Math.hypot(x2 - x1, z2 - z1);
        const varal = new THREE.Mesh(new THREE.PlaneGeometry(larg, 0.34), new THREE.MeshBasicMaterial({ map: texBand, transparent: true, side: THREE.DoubleSide }));
        varal.position.set((x1 + x2) / 2, 2.42, (z1 + z2) / 2);
        varal.rotation.y = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2;
        scene.add(varal); m.meshes.push(varal);
      }
    },
  },
  {
    nome: 'BLACKOUT',
    desc: 'as luzes apagam do nada 😱',
    fundoTex: FUNDOS.noite,
    trilha: 'tensa',
    build(m) {
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      fazerCaixote(m, -2.8, 2.2); fazerCaixote(m, 2.8, -2.2);
      // De tempos em tempos o estádio APAGA — 2s de escuridão e volta
      let prox = 0, fase = 'aceso', faseAte = 0;
      const alvoEscuro = { hemi: 0.06, sun: 0.04, rim: 0.1, expo: 0.62 };
      const alvoClaro = { hemi: AMBIENTE_PADRAO.hemiInt, sun: AMBIENTE_PADRAO.sunInt, rim: AMBIENTE_PADRAO.rimInt, expo: AMBIENTE_PADRAO.expo };
      m.reset = () => { fase = 'aceso'; prox = 0; resetCaixotes(m); };
      m.update = (t) => {
        if (prox === 0) prox = t + 7 + Math.random() * 4;
        if (fase === 'aceso' && t > prox) { fase = 'apagando'; faseAte = t + 2.0; som.selecionar?.(); }
        else if (fase === 'apagando' && t > faseAte) { fase = 'aceso'; prox = t + 8 + Math.random() * 5; }
        const alvo = fase === 'apagando' ? alvoEscuro : alvoClaro;
        const k = 0.12;
        hemi.intensity += (alvo.hemi - hemi.intensity) * k;
        sun.intensity += (alvo.sun - sun.intensity) * k;
        rim.intensity += (alvo.rim - rim.intensity) * k;
        r3.toneMappingExposure += (alvo.expo - r3.toneMappingExposure) * k;
      };
    },
  },
  {
    nome: 'PALANQUE',
    desc: 'suba no centro — quem tá em cima manda',
    build(m) {
      climaMapa({ ceu: 0xffe8c8, chao: 0x3a2c18, fog: 0x2c2010, sol: 0xffd894, solInt: 1.5 }); // fim de tarde dourado
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 }));
      // palanque central elevado + 2 rampas (a física adora um morro de verdade)
      const matPal = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.8, color: 0xffe2b8 });
      const palco = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.25, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.25, 1.25).setFriction(0.85).setCollisionGroups(GROUND_GROUPS), palco);
      m.bodies.push(palco);
      const palcoMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 2.5), matPal);
      palcoMesh.position.y = 0.25; palcoMesh.receiveShadow = true; palcoMesh.castShadow = true;
      scene.add(palcoMesh); m.meshes.push(palcoMesh);
      // rampas dos dois lados (rotação leve — o ragdoll sobe andando)
      const ang = Math.atan2(0.5, 1.5);
      for (const lado of [-1, 1]) {
        const rx = lado * (1.5 + 0.72);
        const rot = { x: 0, y: 0, z: Math.sin((-lado * ang) / 2), w: Math.cos((-lado * ang) / 2) };
        const rampa = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(rx, 0.22, 0).setRotation(rot));
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.06, 1.25).setFriction(0.9).setCollisionGroups(GROUND_GROUPS), rampa);
        m.bodies.push(rampa);
        const rampaMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 2.5), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, color: 0xd8c098 }));
        rampaMesh.position.set(rx, 0.22, 0);
        rampaMesh.rotation.z = -lado * ang;
        rampaMesh.receiveShadow = true; rampaMesh.castShadow = true;
        scene.add(rampaMesh); m.meshes.push(rampaMesh);
      }
      fazerCaixote(m, 0, 3.2); fazerCaixote(m, 0, -3.2);
      m.reset = () => resetCaixotes(m);
    },
  },
  {
    nome: 'PLATAFORMAS',
    desc: 'ilhas móveis sobre o abismo',
    fundoTex: FUNDOS.ceuAberto,
    build(m) {
      // Ilha central + duas plataformas que passeiam sobre o abismo
      const matIlha = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 });
      chaoFixo(m, 1.35, 3.2, matIlha); // faixa central cobre os spawns de cima/baixo
      const texMetal = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#5a6474'; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#414957'; g.lineWidth = 3;
        for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(0, i * 40 + 18); g.lineTo(256, i * 40 + 18); g.stroke(); }
        g.fillStyle = '#ffd94a'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 242, 256, 14);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      const plats = [];
      for (const lado of [-1, 1]) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(lado * 2.9, -0.3, 0));
        world.createCollider(RAPIER.ColliderDesc.cuboid(1.15, 0.3, 0.95).setFriction(1.0).setCollisionGroups(GROUND_GROUPS), body);
        m.bodies.push(body);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.6, 1.9), new THREE.MeshStandardMaterial({ map: texMetal, roughness: 0.7 }));
        mesh.receiveShadow = true; scene.add(mesh); m.meshes.push(mesh);
        m.syncPairs.push([body, mesh]);
        plats.push({ body, lado, seed: lado * Math.PI * 0.5 });
      }
      // nuvens passeando abaixo da arena (sensação de altitude)
      const nuvens = [];
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBolinha, transparent: true, opacity: 0.55, depthWrite: false }));
        s.scale.set(2.2 + Math.random() * 2, 0.9 + Math.random() * 0.5, 1);
        s.position.set((Math.random() * 2 - 1) * 9, -2.6 + Math.random() * 1.4, (Math.random() * 2 - 1) * 6);
        scene.add(s); m.meshes.push(s);
        nuvens.push({ s, v: 0.15 + Math.random() * 0.25 });
      }
      let t0 = 0;
      m.reset = () => { t0 = -1; };
      m.update = (t) => {
        if (t0 < 0) t0 = t; // fase zera no round: plataformas começam no centro (spawn seguro)
        for (const p of plats) {
          const z = Math.sin((t - t0) * 0.55 + p.seed) * 1.7;
          p.body.setNextKinematicTranslation({ x: p.lado * 2.9, y: -0.3, z });
        }
        for (const n of nuvens) {
          n.s.position.x += n.v / 60;
          if (n.s.position.x > 10) n.s.position.x = -10;
        }
      };
    },
  },
  {
    nome: 'ABISMO',
    desc: 'sem chão — arrasta o rival pro buraco',
    fundoTex: FUNDOS.noite,
    amb: 'vento',
    trilha: 'tensa',
    pontes: true,       // bots andam eixo por eixo (diagonal = queda no vão)
    semHolofotes: true, // no vazio só a luz fria da noite (cones lavariam o breu)
    build(m) {
      // Vazio total embaixo: caiu, morreu. Ilhas + pontes finas — o jogo aqui é
      // AGARRAR e arrastar o rival até a beirada (ou derrubar ele da ponte).
      climaMapa({ ceu: 0x8090c0, chao: 0x10142a, fog: 0x0a0d20, sol: 0xb8c8ff, solInt: 1.25, expo: 1.02 });
      const mat = new THREE.MeshStandardMaterial({ map: texAbismo, roughness: 0.9 });
      const bloco = (x, z, hx, hz) => {
        const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, -0.3, z));
        world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(0.9).setCollisionGroups(GROUND_GROUPS), b);
        m.bodies.push(b);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.6, hz * 2), mat);
        mesh.position.set(x, -0.3, z); mesh.receiveShadow = true;
        scene.add(mesh); m.meshes.push(mesh);
        return mesh;
      };
      bloco(0, 0, 1.05, 1.05); // ilha central
      bloco(-3, 0, 0.9, 0.9); bloco(3, 0, 0.9, 0.9);     // ilhas dos spawns (E/O)
      bloco(0, -3.1, 0.9, 0.9); bloco(0, 3.1, 0.9, 0.9); // ilhas dos spawns (N/S)
      bloco(-1.6, 0, 0.56, 0.26); bloco(1.6, 0, 0.56, 0.26); // pontes finas
      bloco(0, -1.65, 0.26, 0.58); bloco(0, 1.65, 0.26, 0.58);
      // pedregulhos flutuando lá embaixo (sensação de abismo sem fim)
      const pedras = [];
      for (let i = 0; i < 9; i++) {
        const s = 0.4 + Math.random() * 0.8;
        const p = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 1 }));
        p.position.set((Math.random() * 2 - 1) * 7, -3 - Math.random() * 3, (Math.random() * 2 - 1) * 5);
        p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        scene.add(p); m.meshes.push(p);
        pedras.push({ p, y0: p.position.y, ph: Math.random() * 6.3 });
      }
      m.update = (t) => { for (const r of pedras) r.p.position.y = r.y0 + Math.sin(t * 0.4 + r.ph) * 0.25; };
    },
  },
  {
    nome: 'JARDIM',
    desc: 'grama alta que amassa na briga',
    fundoTex: FUNDOS.ceuAberto,
    semHolofotes: true, // dia claro: holofote viraria clarão
    build(m) {
      // Gramado ensolarado com ~900 lâminas de grama INSTANCIADAS: balançam com
      // o vento e AMASSAM onde os bonecos pisam (levantando devagar depois).
      climaMapa({ ceu: 0x9fd4f0, chao: 0x2e5c1e, fog: 0x8fc4a8, sol: 0xffeab0, solInt: 1.15, expo: 0.95 });
      const texGrama = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#3f7a2c'; g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 260; i++) {
          g.strokeStyle = `hsl(${100 + Math.random() * 20}, 45%, ${26 + Math.random() * 14}%)`;
          const x = Math.random() * 256, y = Math.random() * 256;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() * 6 - 3), y - 6 - Math.random() * 6); g.stroke();
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 3);
        return t;
      })();
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: texGrama, roughness: 0.95 }));
      // 2600 lâminas AFILADAS (afunilam e inclinam pra ponta — receita da
      // campina estilizada), vento no VERTEX SHADER (CPU não recompõe matriz
      // nenhuma pra balançar) e gradiente raiz-escura/ponta-clara no fragment.
      const N = 2600;
      const geoL = (() => {
        const pos = [], nor = [], uv = [], idx = [];
        const SEG = 3, H = 0.34, W = 0.05;
        for (let s = 0; s <= SEG; s++) {
          const t = s / SEG, afila = Math.pow(1 - t, 1.3), inclina = Math.pow(t, 1.8) * 0.09;
          for (const lado of [-1, 1]) {
            pos.push(lado * W * (0.06 + 0.94 * afila), t * H, inclina);
            nor.push(0, 0.25, 1); uv.push(lado < 0 ? 0 : 1, t);
          }
        }
        for (let s = 0; s < SEG; s++) { const r = s * 2; idx.push(r, r + 1, r + 2, r + 1, r + 3, r + 2); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeBoundingSphere();
        return g;
      })();
      const matL = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 });
      matL.userData.uTempo = { value: 0 };
      matL.onBeforeCompile = (sh) => {
        sh.uniforms.uTempo = matL.userData.uTempo;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTempo; varying float vAltura;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vAltura = uv.y;
            #ifdef USE_INSTANCING
              vec2 pRaiz = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
              float fase = dot(pRaiz, vec2(1.7, 2.3));
              float dobra = sin(uTempo * 1.7 + fase) * 0.12 + sin(uTempo * 3.9 + fase * 1.7) * 0.035;
              transformed.x += dobra * uv.y * uv.y;
            #endif`)
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vAltura;')
          .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.45, 1.28, vAltura);');
      };
      const inst = new THREE.InstancedMesh(geoL, matL, N);
      scene.add(inst); m.meshes.push(inst);
      const laminas = [];
      const cor = new THREE.Color();
      const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), E4 = new THREE.Euler(), V4 = new THREE.Vector3(), S4 = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const d = { x: (Math.random() * 2 - 1) * 5.2, z: (Math.random() * 2 - 1) * 3.7, rot: Math.random() * 6.3, esc: 0.75 + Math.random() * 0.55, alt: 1, vis: 0 };
        laminas.push(d);
        inst.setColorAt(i, cor.setHSL(0.26 + Math.random() * 0.09, 0.55, 0.3 + Math.random() * 0.14));
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      m.update = (t) => {
        matL.userData.uTempo.value = t;
        let mudou = false;
        for (let i = 0; i < N; i++) {
          const d = laminas[i];
          let alvo = 1;
          for (const l of lutadores) { // pisou/caiu em cima: amassa
            const pp = l.rag.parts.pelvis.translation();
            const ax = pp.x - d.x, az = pp.z - d.z;
            if (ax * ax + az * az < 0.32 && pp.y < 1.3) { alvo = 0.16; break; }
          }
          d.alt += (alvo - d.alt) * (alvo < d.alt ? 0.5 : 0.018); // amassa rápido, levanta devagar
          if (Math.abs(d.alt - d.vis) < 0.01) continue; // parada: matriz fica como está
          d.vis = d.alt; mudou = true;
          E4.set(0, d.rot, 0); Q4.setFromEuler(E4);
          M4.compose(V4.set(d.x, 0, d.z), Q4, S4.set(d.esc, Math.max(0.12, d.alt) * d.esc, d.esc));
          inst.setMatrixAt(i, M4);
        }
        if (mudou) inst.instanceMatrix.needsUpdate = true;
      };
      // borboletas passeando 🦋
      const bors = [];
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBolinha, color: [0xffd94a, 0xff9ad0, 0x9ad0ff][i % 3], transparent: true, depthWrite: false }));
        s.scale.setScalar(0.12); scene.add(s); m.meshes.push(s);
        bors.push({ s, f: Math.random() * 6.3, r: 2 + Math.random() * 2.5 });
      }
      const upGrama = m.update;
      m.update = (t) => {
        upGrama(t);
        for (const b of bors) b.s.position.set(Math.sin(t * 0.4 + b.f) * b.r, 0.7 + Math.sin(t * 2.2 + b.f) * 0.25, Math.cos(t * 0.33 + b.f) * (b.r * 0.7));
      };
    },
  },
  {
    nome: 'DOJO',
    desc: 'treino livre — sacos de pancada',
    build(m) {
      // Tatame zen com 3 sacos de pancada pendurados por mola: teste golpes,
      // socão e tintas sem pressão (dá pra jogar partida normal aqui também).
      climaMapa({ ceu: 0xf2e4c8, chao: 0x6a5a3a, fog: 0xd8c8a8, sol: 0xfff0d0, solInt: 1.4 });
      const texTatame = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#9ab06a'; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#7a9050'; g.lineWidth = 4;
        for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2.2);
        return t;
      })();
      chaoFixo(m, 5.5, 4, new THREE.MeshStandardMaterial({ map: texTatame, roughness: 0.9 }));
      for (const [sx, sz] of [[-2.6, -1.6], [0, 2], [2.6, -1.6]]) {
        const anc = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sx, 3.4, sz));
        const saco = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(sx, 1.5, sz).setLinearDamping(0.5).setAngularDamping(0.7));
        world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.26).setMass(10).setFriction(0.5).setCollisionGroups(PROP_GROUPS), saco);
        world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 1.9, z: 0 }), anc, saco, true);
        m.bodies.push(anc, saco);
        const grp = new THREE.Group();
        const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.84, 6, 14), toonMat(THREE, 0xc0392b));
        const topo = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.2, 10), toonMat(THREE, 0x4a3a28));
        topo.position.y = 0.62;
        grp.add(corpo, topo);
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        scene.add(grp); m.meshes.push(grp);
        m.syncPairs.push([saco, grp]);
        m.props.push(saco); // dá pra socar E agarrar o saco
      }
    },
  },
];

let mapaIdx = 0;
let mapa = null;
function setMapa(idx) {
  if (mapa) {
    mapa._dead = true; // loaders assíncronos do mapa antigo desistem (senão vazam mesh/física)
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
  if (MAPAS[mapaIdx].fundoTex) setFundoTex(MAPAS[mapaIdx].fundoTex());
  else setFundo(MAPAS[mapaIdx].fundo ?? 'assets/fundo.jpg');
  som.ambiente(MAPAS[mapaIdx].amb || null); // camada sonora da arena (vento/lava/neve/água)
  for (const h of holofotes) h.visible = !MAPAS[mapaIdx].semHolofotes;
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
  if (ESTILO === 'j' || skin.modelo) {
    for (const spec of PARTS) { const o = new THREE.Object3D(); scene.add(o); meshes[spec.name] = o; }
    meshes.torso._baseS = [1, 1, 1];
    meshes._jrig = null;
    const nomesGLB = MODELO_GLB.split(',');
    meshes._modeloJ = ''; // preenchido abaixo com o nome do modelo (pra classe Jaeger/Kaiju)
    const bruto = (nomesGLB[slot] || nomesGLB[0] || '').trim();
    let nomeGLB, fallbackGLB = null;
    if (skin.modelo || skin.modeloHint) {
      // a própria fantasia diz qual modelo é (Jaeger/Kaiju escolhidos no menu).
      // .modelo força o GLB (offline); .modeloHint só informa o modelo quando o
      // estilo 'j' já está ligado (online), pra não furar o fallback de performance.
      nomeGLB = skin.modelo || skin.modeloHint;
      if (/kaiju/i.test(nomeGLB)) fallbackGLB = 'jaeger-rigado';
    } else if (bruto && bruto !== 'jaeger-low') {
      nomeGLB = bruto; // usuário escolheu explicitamente (?glb=jaeger-rigado,kaiju-rigado)
    } else {
      // Padrão automático por paridade: slot par = Jaeger, ímpar = Kaiju (times
      // robôs x monstros). Se o kaiju-rigado ainda não existe, cai pro Jaeger.
      const ehKaiju = slot % 2 === 1;
      nomeGLB = ehKaiju ? 'kaiju-rigado' : 'jaeger-rigado';
      if (ehKaiju) fallbackGLB = 'jaeger-rigado';
    }
    meshes._modeloJ = nomeGLB;
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
    const montarJ = (gltf) => {
      const armature = gltf.scene; let skinned = null, skeleton = null;
      // o visual foi trocado/destruído enquanto o GLB carregava: descarta e não deixa órfão na cena
      if (meshes._dead) { disporArmature(armature); return; }
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
            // sem textura (caso do jaeger-rigado): aço tingido pela cor do jogador.
            // skin.matx = tinta especial da loja (ouro/cromo/neon/sombra) 🛒
            o.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(0x8b95a6).lerp(tinta, skin.matx ? 0.85 : 0.5),
              metalness: skin.matx?.metalness ?? 0.6,
              roughness: skin.matx?.roughness ?? 0.48,
              emissive: new THREE.Color(tinta).multiplyScalar(skin.matx?.emissivoK ?? 0.06),
            });
          }
        }
      });
      if (!skinned) { console.log('estilo j: GLB sem SkinnedMesh (não rigado)'); return; }
      armature.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(skinned), sz = new THREE.Vector3(); box.getSize(sz);
      const s = 1.9 / (sz.y || 1); // altura alvo ~1.9
      const achata = /kaiju/i.test(nomeGLB) ? 0.9 : 1; // Kaiju é mais largo: fica um pouco mais baixo
      armature.scale.set(s, s * achata, s);
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
    };
    const carregarJ = (nome, onErr) =>
      new GLTFLoader().load(ASSET('assets/modelos/' + nome + '.glb'), montarJ, undefined, onErr);
    carregarJ(nomeGLB, fallbackGLB
      ? () => { console.log(`estilo j: ${nomeGLB}.glb não achado, usando ${fallbackGLB}`); carregarJ(fallbackGLB); }
      : undefined);
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
  meshes._dead = true; // cancela loads GLB em andamento (montarJ desiste se chegar depois)
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
  // Estilo 'j' (Jaeger/Kaiju rigado): remove a armature e descarta a memória GPU
  if (meshes._armature) { scene.remove(meshes._armature); disporArmature(meshes._armature); meshes._armature = null; }
}
// Libera geometrias/materiais/texturas de uma armature GLB (evita vazar memória GPU nas trocas)
function disporArmature(arm) {
  arm.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (m && m.map) m.map.dispose(); if (m) m.dispose(); } }
  });
}

// Flash de dano: coleta os materiais do lutador que têm canal emissivo, guardando
// o valor base pra restaurar. Funciona em todos os estilos (vinil/toon/standard/GLB).
const COR_FLASH = new THREE.Color(1.0, 0.55, 0.5); // branco-quente avermelhado (dor)
const COR_ESQUIVA = new THREE.Color(0.35, 0.85, 1.0); // ciano (invencível na esquiva)
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
    // Esquiva: brilho ciano pulsante enquanto está invencível (i-frames)
    if (rag.isEsquivando(now)) {
      const pulso = 0.5 + 0.5 * Math.sin(now * 42);
      meshes._flashOn = true;
      for (const fm of meshes._flashMats) {
        fm.mat.emissive.copy(fm.base).lerp(COR_ESQUIVA, 0.55 + 0.35 * pulso);
        fm.mat.emissiveIntensity = fm.baseInt + 0.8 + pulso * 0.9;
      }
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
function atualizarSkinMesh(mm) {
  if (!mm) return;
  if (mm._skel) { mm._rootBones.updateMatrixWorld(true); mm._skel.update(); }
  if (mm._jrig) {
      // corpos da física (trackers preenchidos por syncVisual/interpolação) -> matrizes world
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
function atualizarSkins() { for (const l of lutadores) atualizarSkinMesh(l.meshes); }

// ---------- Lutadores (2 a 4, humanos e bots) ----------
// tipos de controle: 'kb1' (WASD+gp0) | 'kb2' (setas+gp1) | 'gp' | 'cpu'
const VOZES = [0.9, 1.15, 0.75, 1.35]; // timbre por slot
let lutadores = [];

// Classe do lutador pelo modelo: Kaiju = brutamontes (bate forte, aguenta tranco,
// menos ágil); Jaeger = ágil (um tiquinho mais rápido). Só vale no estilo 'j'.
function aplicarClasse(rag, meshes) {
  const nome = (meshes && meshes._modeloJ) || '';
  rag.forcaSoco = 1; rag.resistencia = 1;
  let mul = 1; // fator de tração (agilidade)
  if (/kaiju/i.test(nome)) { rag.forcaSoco = 1.3; rag.resistencia = 1.45; mul = 0.9; }
  else if (/jaeger/i.test(nome)) { mul = 1.08; }
  rag.controle = (mapa.controle ?? 1) * mul * (AJUSTES.turbo || 1); // recalcula do zero (sem acumular)
}

function montarLutadores(configs) {
  for (const l of lutadores) {
    destroyVisual(l.meshes);
    l.rag.destroy();
    if (l._sight) { scene.remove(l._sight.grp); l._sight = null; }
    if (l._gauge) { scene.remove(l._gauge.spr); l._gauge.tex.dispose(); l._gauge = null; } // manômetro do SOCÃO
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
    const meshes = buildVisual(corSkin(SKINS[cfg.skin], PALETA[cfg.corIdx || 0]), i * 1.9, i);
    aplicarClasse(rag, meshes);
    return { rag, meshes, cfg, slot: i, vivo: true, score: 0 };
  });
  for (const l of lutadores) l.rag.rivals = rivaisDe(l, false).map((o) => o.rag);
}

// Tecla M: alterna entre o estilo base e o Jaeger rigado ('j') em runtime,
// reconstruindo os visuais dos lutadores em cena (mesmo caminho da troca de skin).
function alternarModelo3D() {
  ESTILO = ESTILO === 'j' ? (ESTILO_BASE === 'j' ? 'a' : ESTILO_BASE) : 'j';
  for (const l of lutadores) {
    destroyVisual(l.meshes);
    l.meshes = buildVisual(SKINS[l.cfg.skin], l.slot * 1.9, l.slot);
    aplicarClasse(l.rag, l.meshes); // liga/desliga a classe Jaeger/Kaiju junto
  }
  som.selecionar?.();
}
addEventListener('keydown', (e) => { if (e.code === 'KeyM') alternarModelo3D(); });

function inputDoLutador(l) {
  if (l.cfg.tipo === 'cpu') return botInput(l);
  if (l.cfg.tipo === 'kb1') return mergeInput(mergeInput(readInput(MAPS.p1), readGamepad(0)), readTouch());
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
// Perfil do estilo humano (IA que aprende): amostrado a cada 0.5s durante a luta.
// EMA lenta (~20s) — o bot "percebe" teu jeito: spam de soco, agarrão, viver na beirada.
const perfilHumano = { spamSoco: 0, agarrador: 0, beirada: 0 };
let perfilProxAt = 0;
function atualizarPerfilHumano() {
  if (simNow < perfilProxAt) return;
  const dt = 0.5; perfilProxAt = simNow + dt;
  let socoRate = 0, grabFrac = 0, edgeFrac = 0, n = 0;
  for (const l of lutadores) {
    if (l.cfg.tipo === 'cpu' || !l.vivo) continue;
    n++;
    const s = l.rag.stats.socos;
    socoRate += (s - (l._pfSocos ?? s)) / dt; l._pfSocos = s;
    grabFrac += l.rag.grabbedRival() ? 1 : 0;
    const p = l.rag.parts.pelvis.translation();
    edgeFrac += Math.hypot(p.x, p.z) > 2.8 ? 1 : 0;
  }
  if (!n) return;
  const a = 0.12;
  perfilHumano.spamSoco += a * (Math.min(1, (socoRate / n) / 1.2) - perfilHumano.spamSoco);
  perfilHumano.agarrador += a * ((grabFrac / n) - perfilHumano.agarrador);
  perfilHumano.beirada += a * ((edgeFrac / n) - perfilHumano.beirada);
}

function botInput(l) {
  atualizarPerfilHumano(); // barato (amostra a cada 0.5s)
  const out = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false, esquiva: false };
  const me = l.rag.parts.pelvis.translation();
  // MANEQUIM do tutorial: passeia devagar perto do centro e NUNCA ataca
  if (l.cfg.manequim) {
    out.move.x = Math.sin(simNow * 0.5) * 0.25 - me.x * 0.2;
    out.move.z = Math.cos(simNow * 0.4) * 0.2 - me.z * 0.2;
    return out;
  }
  const nv0 = NIVEIS[nivelIdx]; // dificuldade escolhida no menu
  if (!l._persona) l._persona = PERSONAS[(l.slot ?? 0) % PERSONAS.length];
  const P = l._persona;
  // DDA (ajuste dinâmico): mantém a luta no "flow" — bots afiam se os humanos estão
  // na frente e aliviam se estão atrás. Modulação suave, presa em ±18% no pico.
  let sH = -1, sB = -1, temHumano = false;
  for (const o of lutadores) {
    if (o.cfg.tipo === 'cpu') sB = Math.max(sB, o.score);
    else { temHumano = true; sH = Math.max(sH, o.score); }
  }
  const gap = temHumano ? Math.max(-3, Math.min(3, sH - sB)) : 0;
  const dda = 1 + gap * 0.06 * (AJUSTES.dda ?? 1); // >1 = bots mais afiados
  const PH = perfilHumano; // estilo aprendido: spammer de soco leva mais esquiva, etc.
  const nv = {
    reacao: nv0.reacao / dda,
    esquiva: Math.min(0.95, nv0.esquiva * dda * P.esquiva * (1 + PH.spamSoco * 0.6)),
    ataque: (nv0.ataque / dda) * P.ataque,
    mira: nv0.mira / dda,
  };
  const bordaP = P.borda * (1 + PH.beirada * 0.8); // quem vive na beirada é caçado lá
  const alvos = rivaisDe(l, true);
  if (!alvos.length) return out;
  // Escolha de alvo por utilidade: o mais perto, com bônus pra quem está na beirada
  // (ring-out fácil) — quanto a persona valoriza isso vem de P.borda.
  let alvo = alvos[0], best = Infinity, dAlvo = Infinity;
  for (const a of alvos) {
    const q = a.rag.parts.pelvis.translation();
    const d = Math.hypot(q.x - me.x, q.z - me.z);
    const aR = Math.hypot(q.x, q.z);
    const util = d - Math.max(0, aR - 2.4) * 0.6 * bordaP;
    if (util < best) { best = util; alvo = a; dAlvo = d; }
  }
  const ap = alvo.rag.parts.pelvis.translation();
  // Antecipação: bots melhores perseguem onde o alvo VAI estar (interceptação),
  // não onde ele está. O ponto previsto fica preso dentro da arena — prever
  // rumo à borda seria isca fácil pra puxar o bot pro abismo.
  const av = alvo.rag.parts.pelvis.linvel();
  const lead = Math.min(0.55, dAlvo * 0.14) * (1 - Math.min(0.85, nv.mira));
  let px = ap.x + av.x * lead, pz = ap.z + av.z * lead;
  const pR = Math.hypot(px, pz);
  if (pR > 3.2) { px *= 3.2 / pR; pz *= 3.2 / pR; }
  let dx = px - me.x, dz = pz - me.z;
  // Ofensiva de ring-out: se o alvo está perto da beirada, o bot busca o lado de DENTRO
  // dele (entre o alvo e o centro) pra que o soco jogue o alvo pra fora da arena.
  const apR = Math.hypot(ap.x, ap.z);
  const alvoNaBorda = apR > 2.6;
  if (alvoNaBorda && dAlvo < 2.4) {
    // recuo pequeno (≤0.35m) pro lado de dentro: fica center-side MAS ainda fecha pra socar
    const off = Math.min(0.35, 0.25 * bordaP);
    const rec = off / Math.max(0.001, apR);
    dx = ap.x * (1 - rec) - me.x;
    dz = ap.z * (1 - rec) - me.z;
  }
  // REI DO MORRO: sem briga por perto, o bot disputa a zona central
  if (MODO_MORRO && dAlvo > 1.4) {
    dx = dx * 0.35 - me.x * 0.9;
    dz = dz * 0.35 - me.z * 0.9;
  }
  // fugir da bola de demolição em velocidade
  for (const b of mapa.bolas) {
    const bp = b.translation();
    const bv = b.linvel();
    if (Math.hypot(bp.x - me.x, bp.z - me.z) < 1.7 && Math.hypot(bv.x, bv.z) > 2.5) {
      dx = me.x - bp.x;
      dz = me.z - bp.z;
    }
  }
  // medo da beirada: longe do centro, puxa pra dentro (não vale em mapa de pontes)
  const rC = Math.hypot(me.x, me.z);
  if (rC > 3.3 && !MAPAS[mapaIdx].pontes) {
    dx = dx * 0.35 - me.x * 0.65;
    dz = dz * 0.35 - me.z * 0.65;
  }
  // Mapa de PONTES (ABISMO): anda em L, um eixo por vez — diagonal cai no vão
  if (MAPAS[mapaIdx].pontes && dAlvo > 1.1) {
    if (Math.abs(dx) > Math.abs(dz)) dz = 0; else dx = 0;
  }
  const dl = Math.hypot(dx, dz) || 1;
  if (dAlvo > 0.85 || rC > 3.3) {
    out.move.x = dx / dl;
    out.move.z = dz / dl;
  }
  // Armas: se segura uma, usa; senão vai buscar a mais próxima. Serve pra qualquer
  // posição da arena (não só no centro), respeitando o medo da beirada.
  const fx = dx / dl, fz = dz / dl;
  const minhaArma = mapa.armas && mapa.armas.find((a) => l.rag.grabJoints.some((g) => g && g.body === a.body));
  if (minhaArma) {
    out.grab = true;
    if (minhaArma.tiro) {
      // Arma de tiro: mira de longe. Só avança se o alvo saiu do alcance; senão
      // fica no lugar mirando e atira em cadência.
      const longe = dAlvo > minhaArma.alcanceTiro - 1;
      out.move.x = fx * (longe ? 1 : 0.28); out.move.z = fz * (longe ? 1 : 0.28); // move pequeno = mira sem sair correndo
      if (dAlvo < minhaArma.alcanceTiro && simNow > (l._botFire ?? 0)) { out.punch = true; l._botFire = simNow + 0.5 * nv.ataque; }
    } else {
      out.move.x = fx; out.move.z = fz; // arma branca: encara e parte pra cima
      if (dAlvo < 1.2 && simNow > (l._botFire ?? 0)) { out.punch = true; l._botFire = simNow + 0.7 * nv.ataque; }
    }
    if (rC > 3.4) { out.move.x = -me.x / (rC || 1); out.move.z = -me.z / (rC || 1); } // beira: volta pro centro
    return out;
  }
  if (mapa.armas && mapa.armas.length && !l.rag.grabJoints.some((g) => g) && rC < 3.4) {
    let aw = null, ad = 3.6 * P.arma; // raio de busca (persona "fominha de arma" busca de mais longe)
    for (const a of mapa.armas) { const q = a.body.translation(); const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < ad) { ad = d; aw = a; } }
    if (aw) { const q = aw.body.translation(); const wx = q.x - me.x, wz = q.z - me.z, wl = Math.hypot(wx, wz) || 1; out.move.x = wx / wl; out.move.z = wz / wl; if (ad < 0.85) out.grab = true; return out; }
  }
  // SOCÃO do bot: contra alvo atordoado/caído, segura o soco (carrega) e solta o pancadão.
  if (simNow < (l._botCargaAte ?? 0)) {
    out.punch = true; // segue segurando — quando parar, o release dispara o socão sozinho
    out.move.x = fx * 0.5; out.move.z = fz * 0.5; // avança devagar mirando
    return out;
  }
  if (nivelIdx >= 1 && dAlvo < 2.1 && dAlvo > 0.7 && simNow > (l._botCd ?? 0)
      && (alvo.rag.isStunned(simNow) || alvo.rag.isDowned(simNow)) && Math.random() < 0.03) {
    l._botCargaAte = simNow + 0.78; // ~carga cheia
    l._botCd = simNow + 2.2 * nv.ataque;
    out.punch = true;
    return out;
  }
  // Esquiva reativa: se o alvo armou um golpe pertinho e está encarando, o bot desvia de lado
  if (dAlvo < 1.5 && simNow > (l._botEsq ?? 0) && !l.rag.grabbedRival()) {
    const ra = alvo.rag;
    const armouGolpe = simNow - (ra.lastPunchStartAt ?? -9) < 0.16;
    const rdx = Math.sin(ra.heading), rdz = Math.cos(ra.heading);
    const tox = me.x - ap.x, toz = me.z - ap.z, tl = Math.hypot(tox, toz) || 1;
    const encara = (rdx * tox + rdz * toz) / tl > 0.45;
    if (armouGolpe && encara && Math.random() < nv.esquiva) {
      out.esquiva = true;
      out.move.x = -rdz; out.move.z = rdx; // sidestep perpendicular ao golpe
      l._botEsq = simNow + 1.4 * nv.reacao;
      return out;
    }
  }
  // decidir soco ou agarrão quando chega perto
  if (dAlvo < 0.95 && simNow > (l._botCd ?? 0)) {
    // alvo na beirada: prioriza o soco que empurra pra fora; contra agarrador, soco preventivo
    if (Math.random() < (alvoNaBorda ? 0.85 : 0.55 + PH.agarrador * 0.3)) {
      out.punch = true;
      l._botCd = simNow + (0.9 + Math.random() * 0.7) * nv.ataque;
    } else {
      l._botGrabAte = simNow + 1.3 + Math.random() * 0.6;
      l._botCd = simNow + (2 + Math.random()) * nv.ataque;
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

// Marcador "VOCÊ" (online): seta amarela sobre o seu boneco no meio da bagunça
const voceTex = texturaCanvas(128, (g) => {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 32px "Segoe UI", system-ui, sans-serif';
  g.lineJoin = 'round'; g.strokeStyle = '#241640'; g.lineWidth = 6;
  g.strokeText('VOCÊ', 64, 36); g.fillStyle = '#ffe04a'; g.fillText('VOCÊ', 64, 36);
  g.beginPath(); g.moveTo(42, 64); g.lineTo(86, 64); g.lineTo(64, 98); g.closePath();
  g.fillStyle = '#ffe04a'; g.fill(); g.stroke();
});

// Plaquinha com o apelido do jogador (online), presa na cabeça do boneco.
// Sprite = sempre de frente pra câmera; vai embora junto com o visual (é filha da cabeça).
function nomeTexCanvas(nome) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 30px "Fredoka", "Segoe UI", system-ui, sans-serif';
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(20,12,40,.9)'; g.lineWidth = 7;
  g.strokeText(nome, 128, 34); g.fillStyle = '#ffffff'; g.fillText(nome, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function garantirNomeSprite(v, slot) {
  const nome = (online.nomes && online.nomes.get(slot)) || '';
  if (v._nomeTxt === nome) return;
  v._nomeTxt = nome;
  if (v._nomeSpr) { v._nomeSpr.parent?.remove(v._nomeSpr); v._nomeSpr.material.map?.dispose(); v._nomeSpr.material.dispose(); v._nomeSpr = null; }
  if (!nome || !v.meshes?.head) return;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: nomeTexCanvas(nome), transparent: true, depthWrite: false, fog: false }));
  spr.scale.set(0.95, 0.24, 1);
  spr.position.set(0, 0.42, 0);
  v.meshes.head.add(spr);
  v._nomeSpr = spr;
}

const efeitos = [];
function spawnFx(tex, pos, opts) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.position.set(pos.x + (opts.dx || 0), pos.y + (opts.dy || 0), pos.z + (opts.dz || 0));
  s.scale.setScalar(opts.escala ?? 0.24);
  if (opts.cor != null) s.material.color.set(opts.cor);
  scene.add(s);
  efeitos.push({
    s, vida: opts.vida ?? 0.55, vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0,
    grav: opts.grav ?? 0, giro: opts.giro ?? 0, cresce: opts.cresce ?? 0, teto: opts.teto ?? 9,
  });
}
// Fogos de artifício (ring-out): 3 explosões coloridas no alto da arena
function fogosFx() {
  const CORES = [0xff5c8a, 0x7ee0ff, 0xffd94a, 0x7ed957, 0xc490ff];
  for (let b = 0; b < 3; b++) {
    const cx = (Math.random() * 2 - 1) * 3, cz = (Math.random() * 2 - 1) * 2, cy = 3.1 + Math.random() * 1.3;
    const cor = CORES[(Math.random() * CORES.length) | 0];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, v = 2.1 + Math.random() * 1.3;
      spawnFx(starTex, { x: cx, y: cy, z: cz }, {
        escala: 0.2, vida: 0.85 + Math.random() * 0.35, grav: 2.2, giro: 4, cor,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, vz: (Math.random() - 0.5) * 0.9,
      });
    }
  }
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
// Rastro colorido: um blob que some rápido, deixado ao longo do movimento
function trailFx(pos, cor, escala = 0.42) {
  spawnFx(puffTex, pos, { escala, vida: 0.3, cresce: 0.5, cor });
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
// 💧 Anéis de ondulação na água (estilo água anime): expandem e somem
const ondas = [];
function ondaAgua(x, z, y, esc = 1, atraso = 0) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.24, 40),
    new THREE.MeshBasicMaterial({ color: 0xdffaff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.03, z);
  m.visible = false;
  scene.add(m);
  ondas.push({ m, t: -atraso, esc });
}
function updateOndas(dt) {
  for (let i = ondas.length - 1; i >= 0; i--) {
    const o = ondas[i];
    o.t += dt;
    if (o.t < 0) continue; // ainda esperando a vez (anéis em sequência)
    o.m.visible = true;
    const k = 1 + o.t * 3.4 * o.esc;
    o.m.scale.set(k, k, 1);
    o.m.material.opacity = Math.max(0, 0.8 * (1 - o.t / 0.9));
    if (o.t > 0.9) {
      scene.remove(o.m); o.m.geometry.dispose(); o.m.material.dispose();
      ondas.splice(i, 1);
    }
  }
}
function updateEfeitos(dt) {
  updateOndas(dt);
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

// ---------- Power-ups (pickups flutuantes que aplicam efeito por proximidade) ----------
function texPower(emoji, cor) {
  return texturaCanvas(128, (g) => {
    const c = '#' + cor.toString(16).padStart(6, '0');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, c); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.font = '62px "Segoe UI Emoji", "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 64, 70);
  });
}
const POWERDEF = {
  cura:  { emoji: '❤️', cor: 0xff5a6a, aplica: (rag) => { rag.dano = 0; rag.folego = 1; } },
  vel:   { emoji: '⚡', cor: 0xffe04a, aplica: (rag, now) => { rag.buffVel = 1.6; rag.buffVelAte = now + 6; } },
  forca: { emoji: '💪', cor: 0xff9a3c, aplica: (rag, now) => { rag.buffForca = 1.8; rag.buffForcaAte = now + 6; } },
  escudo: { emoji: '🛡️', cor: 0x6ec8ff, aplica: (rag) => { rag.escudo = 1; } },
};
for (const k in POWERDEF) POWERDEF[k].tex = texPower(POWERDEF[k].emoji, POWERDEF[k].cor);
const powerups = [];
let proxPowerEm = 0;
function spawnPower(tipo, x, z) {
  const def = POWERDEF[tipo];
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: def.tex, transparent: true, depthWrite: false }));
  s.scale.setScalar(0.62); s.position.set(x, 1.4, z); scene.add(s);
  powerups.push({ s, tipo, x, z, vida: 16, base: 1.4 });
}
function limparPowerups() {
  for (const p of powerups) { scene.remove(p.s); p.s.material.dispose(); }
  powerups.length = 0;
}
function updatePowerups(dt, now) {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.vida -= dt;
    p.s.position.y = p.base + Math.sin(now * 3) * 0.12;                 // flutua
    p.s.material.opacity = p.vida < 3 ? (Math.sin(now * 20) * 0.4 + 0.6) : 1; // pisca no fim
    let coletou = false;
    for (const l of lutadores) {
      if (!l.vivo) continue;
      const t = l.rag.parts.torso.translation();
      if (Math.hypot(t.x - p.x, t.y - p.s.position.y, t.z - p.z) < 0.78) {
        POWERDEF[p.tipo].aplica(l.rag, now);
        powFx({ x: p.x, y: p.s.position.y, z: p.z }); burstEstrelas(t); som.ponto?.();
        coletou = true; break;
      }
    }
    if (coletou || p.vida <= 0) { scene.remove(p.s); p.s.material.dispose(); powerups.splice(i, 1); }
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
// Fantasias jogáveis no menu: só Jaeger e Kaiju (os modelos 3D de verdade).
const IDX_JAEGER = SKINS.findIndex((s) => s.id === 'jaeger');
const IDX_KAIJU = SKINS.findIndex((s) => s.id === 'kaiju');
const MENU_SKINS = [IDX_JAEGER, IDX_KAIJU];
const lerSkin = (k, padrao) => {
  const v = parseInt(store.get(k), 10);
  return MENU_SKINS.includes(v) ? v : padrao; // só aceita as fantasias jogáveis
};
// 🎨 Tinta do boneco: cada jogador pinta o seu. null = cor original da fantasia.
// Entradas podem ser um número (cor) ou {id, cor, matx} (tinta especial da loja).
const PALETA = [null, 0xff5252, 0xff9a3c, 0xffd94a, 0x7ed957, 0x2fbfa4, 0x66e0ff, 0x4a7dff, 0xc77dff, 0xff5a99, 0xf2f2f2, 0x30303c];
const corDe = (e) => (e && typeof e === 'object' ? e.cor : e);
const matDe = (e) => (e && typeof e === 'object' ? e.matx : null);
const corSkin = (skin, ent) => {
  const cor = corDe(ent), matx = matDe(ent);
  if (cor == null && !matx) return skin;
  return { ...skin, matx: matx || undefined, cores: { ...skin.cores, torso: cor ?? skin.cores.torso, barriga: undefined } };
};
const cssCor = (c) => '#' + c.toString(16).padStart(6, '0');
const lerCorIdx = (k) => { const v = parseInt(store.get(k), 10); return v >= 0 && v < PALETA.length ? v : 0; };

// ---------- LOJA 🛒 — moedas de brincadeira, ganhas JOGANDO (nada de dinheiro real) ----------
const TINTAS_LOJA = [
  { id: 'ouro', nome: 'OURO', preco: 250, cor: 0xffc832, matx: { metalness: 1.0, roughness: 0.2, emissivoK: 0.12 } },
  { id: 'cromo', nome: 'CROMADO', preco: 250, cor: 0xdde4f0, matx: { metalness: 1.0, roughness: 0.06, emissivoK: 0.03 } },
  { id: 'neon', nome: 'NEON', preco: 200, cor: 0x39ff88, matx: { metalness: 0.1, roughness: 0.5, emissivoK: 0.6 } },
  { id: 'sombra', nome: 'SOMBRA', preco: 150, cor: 0x14141c, matx: { metalness: 0.15, roughness: 0.95, emissivoK: 0 } },
];
const loja = (() => {
  let d = {};
  try { d = JSON.parse(store.get('wobblers_loja') || '{}') || {}; } catch { /* carteira nova */ }
  return { moedas: d.moedas | 0, skins: Array.isArray(d.skins) ? d.skins : [], tintas: Array.isArray(d.tintas) ? d.tintas : [] };
})();
const salvarLoja = () => store.set('wobblers_loja', JSON.stringify(loja));
if (PARAMS.has('moedas')) { loja.moedas += parseInt(PARAMS.get('moedas'), 10) || 0; salvarLoja(); } // dev/teste
function avisoMoedas(txt) {
  const d = document.createElement('div');
  d.className = 'moeda-toast'; d.textContent = txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function ganharMoedas(n) {
  loja.moedas += n;
  salvarLoja();
  avisoMoedas(`+${n} 🪙  (total: ${loja.moedas})`);
  atualizarSaldoLoja();
}
function atualizarSaldoLoja() {
  if ($('tit-moedas')) $('tit-moedas').textContent = loja.moedas;
  if ($('loja-saldo')) $('loja-saldo').textContent = `🪙 ${loja.moedas}`;
}
// ---------- CARREIRA 📊 + CONQUISTAS 🏅 (pagam moedas da loja) ----------
const carreira = (() => {
  const base = { partidas: 0, vitorias: 0, rounds: 0, socos: 0, acertos: 0, quedas: 0, pendurado: 0, conq: [] };
  try { return { ...base, ...(JSON.parse(store.get('wobblers_carreira') || '{}') || {}) }; } catch { return base; }
})();
const salvarCarreira = () => store.set('wobblers_carreira', JSON.stringify(carreira));
const CONQUISTAS = [
  { id: 'v1', nome: 'PRIMEIRA VITÓRIA', desc: 'vença uma partida', premio: 50, ok: (c) => c.vitorias >= 1 },
  { id: 'v5', nome: 'PENTACAMPEÃO', desc: 'vença 5 partidas', premio: 100, ok: (c) => c.vitorias >= 5 },
  { id: 'v15', nome: 'LENDA DO RINGUE', desc: 'vença 15 partidas', premio: 250, ok: (c) => c.vitorias >= 15 },
  { id: 'p10', nome: 'MARATONISTA', desc: 'jogue 10 partidas', premio: 75, ok: (c) => c.partidas >= 10 },
  { id: 'a100', nome: 'MÃO PESADA', desc: 'acerte 100 socos', premio: 75, ok: (c) => c.acertos >= 100 },
  { id: 'a500', nome: 'BRITADEIRA', desc: 'acerte 500 socos', premio: 200, ok: (c) => c.acertos >= 500 },
  { id: 'r25', nome: 'FECHADOR DE ROUNDS', desc: 'vença 25 rounds', premio: 100, ok: (c) => c.rounds >= 25 },
  { id: 'q50', nome: 'OSSO DURO', desc: 'caia 50 vezes (e volte!)', premio: 60, ok: (c) => c.quedas >= 50 },
  { id: 'pend60', nome: 'UNHAS DE GATO', desc: 'some 60s pendurado na beirada', premio: 80, ok: (c) => c.pendurado >= 60 },
];
function checarConquistas() {
  for (const q of CONQUISTAS) {
    if (carreira.conq.includes(q.id) || !q.ok(carreira)) continue;
    carreira.conq.push(q.id);
    salvarCarreira();
    avisoMoedas(`🏅 CONQUISTA: ${q.nome}!`);
    ganharMoedas(q.premio);
  }
}
// Soma os stats dos HUMANOS da partida na carreira (chamado no fim da partida)
function somarCarreira(venceu) {
  for (const l of lutadores) {
    if (l.cfg.tipo === 'cpu') continue;
    const s = l.rag.stats;
    carreira.socos += s.socos; carreira.acertos += s.acertos;
    carreira.quedas += s.quedas; carreira.pendurado += Math.round(s.pendurado);
  }
  carreira.partidas++;
  if (venceu) carreira.vitorias++;
  salvarCarreira();
  checarConquistas();
}

// Aplica o que já foi comprado: tintas entram na paleta.
// (Lutadores novos virão dos modelos do Meshy — entram no MENU_SKINS quando chegarem.)
function aplicarComprasLoja() {
  for (const t of TINTAS_LOJA) {
    if (loja.tintas.includes(t.id) && !PALETA.some((e) => e && e.id === t.id)) PALETA.push({ id: t.id, cor: t.cor, matx: t.matx });
  }
}
aplicarComprasLoja();
const selCfg = [
  { tipo: 'kb1', ativo: true, conf: false, skin: lerSkin('molengas_skin0', IDX_JAEGER), corIdx: lerCorIdx('wobblers_cor0') },
  { tipo: 'kb2', ativo: true, conf: false, skin: lerSkin('molengas_skin1', IDX_KAIJU), corIdx: lerCorIdx('wobblers_cor1') },
  { tipo: 'gp', gp: 2, ativo: false, conf: false, skin: IDX_JAEGER, corIdx: 0 },
  { tipo: 'gp', gp: 3, ativo: false, conf: false, skin: IDX_KAIJU, corIdx: 0 },
];
let selFase = 'skins'; // skins | mapa
// ?skins=a,b força as fantasias (debug/screenshot)
if (PARAMS.get('skins')) {
  const ns = PARAMS.get('skins').split(',').map((n) => parseInt(n, 10));
  ns.forEach((n, i) => { if (Number.isFinite(n) && selCfg[i]) selCfg[i].skin = ((n % SKINS.length) + SKINS.length) % SKINS.length; });
}

function setSkinDireto(i, skinIdx) {
  selCfg[i].skin = skinIdx;
  store.set('molengas_skin' + i, skinIdx);
  som.selecionar();
  // lutador em cena? troca ao vivo (com a tinta escolhida)
  const l = lutadores.find((x) => x.slot === i);
  if (l) {
    destroyVisual(l.meshes);
    l.meshes = buildVisual(corSkin(SKINS[skinIdx], PALETA[selCfg[i].corIdx || 0]), i * 1.9, i);
    l.cfg.skin = skinIdx;
  }
  atualizarSelecao();
}
// 🎨 Pinta o boneco do jogador i (cicla a paleta; o enfeite no palco troca na hora)
function trocarCor(i, dir) {
  selCfg[i].corIdx = ((selCfg[i].corIdx || 0) + dir + PALETA.length) % PALETA.length;
  store.set('wobblers_cor' + i, selCfg[i].corIdx);
  som.selecionar();
  const l = lutadores.find((x) => x.slot === i);
  if (l) {
    destroyVisual(l.meshes);
    l.meshes = buildVisual(corSkin(SKINS[selCfg[i].skin], PALETA[selCfg[i].corIdx]), i * 1.9, i);
  }
  atualizarSelecao();
}
function trocarSkin(i, dir) {
  const cur = MENU_SKINS.indexOf(selCfg[i].skin);
  const base = cur < 0 ? 0 : cur;
  setSkinDireto(i, MENU_SKINS[((base + dir) % MENU_SKINS.length + MENU_SKINS.length) % MENU_SKINS.length]);
}

const ROTULO_J = ['P1', 'P2', 'P3', 'P4'];
const CORES_J = ['#ff5252', '#40a0ff', '#ffd94a', '#7ed957'];
const CLASSE_SKIN = { jaeger: 'ÁGIL ⚡', kaiju: 'BRUTAMONTES 💪' };
function atualizarSelecao() {
  // Cards do elenco (um por fantasia jogável) com os "cursores" dos jogadores em cima
  MENU_SKINS.forEach((skinIdx, k) => {
    const img = $('sel-card-img' + k);
    if (!img) return;
    const s = SKINS[skinIdx];
    $('sel-card-nome' + k).textContent = s.nome;
    $('sel-card-cl' + k).textContent = CLASSE_SKIN[s.id] || '';
    $('sel-badges' + k).innerHTML = selCfg.map((c, i) => (c.ativo && c.skin === skinIdx)
      ? `<span class="sel-badge pj${i}${c.conf ? ' conf' : ''}">${c.tipo === 'cpu' ? '🤖' : ROTULO_J[i]}</span>` : '').join('');
    const card = document.querySelector(`.sel-card[data-k="${k}"]`);
    if (card) card.classList.toggle('sob', selCfg.some((c) => c.ativo && c.skin === skinIdx));
  });
  // Chips de status por jogador (quem entrou, quem já confirmou, e a tinta 🎨)
  if ($('sel-chips')) {
    $('sel-chips').innerHTML = selCfg.map((c, i) => {
      if (!c.ativo) return `<span class="sel-chip vazio">🎮 ${ROTULO_J[i]} · aperte A</span>`;
      const cor = corDe(PALETA[c.corIdx || 0]);
      const bola = cor != null
        ? `<i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cssCor(cor)};border:1px solid rgba(0,0,0,.4);vertical-align:-1px;margin-right:2px"></i>`
        : '';
      return `<span class="sel-chip" style="--cj:${CORES_J[i]}">${c.tipo === 'cpu' ? '🤖 BOT' : ROTULO_J[i]} · ${bola}${SKINS[c.skin].nome} ${c.conf ? '✔' : '…'}</span>`;
    }).join('');
  }
  $('selecao').classList.toggle('fase-mapa', selFase === 'mapa');
  $('selecao').classList.toggle('fase-modo', selFase === 'modo');
  if ($('sel-tit')) {
    $('sel-tit').textContent = selFase === 'mapa' ? 'ESCOLHA A ARENA'
      : selFase === 'modo' ? 'MODO DE JOGO' : 'ESCOLHA SEU LUTADOR';
  }
  // Carrossel coverflow: o selecionado gigante no centro, vizinhos inclinados
  // espiando dos lados (deslocamento circular pra A/D dar a volta suave)
  const mg = $('mapa-grid');
  if (mg && selFase === 'mapa') {
    const N = MAPAS.length;
    mg.querySelectorAll('.mapa-card').forEach((c) => {
      const i = parseInt(c.dataset.i, 10);
      let off = ((i - mapaIdx) % N + N) % N;
      if (off > N / 2) off -= N;
      const longe = Math.abs(off) > 3;
      c.style.opacity = longe ? '0' : String(1 - Math.abs(off) * 0.16);
      c.style.pointerEvents = longe ? 'none' : 'auto';
      c.style.zIndex = String(30 - Math.abs(off));
      c.style.transform = `translate(calc(-50% + ${off * 58}%), -50%) rotateY(${-off * 16}deg) `
        + `scale(${off === 0 ? 1 : Math.max(0.5, 0.66 - (Math.abs(off) - 1) * 0.06)})`;
      c.classList.toggle('sel', off === 0);
    });
  }
  const og = $('modo-grid');
  if (og) og.querySelectorAll('.modo-card').forEach((c) => c.classList.toggle('sel', parseInt(c.dataset.i, 10) === modoIdx));
  $('sel-mapa-nome').textContent = MAPAS[mapaIdx].nome;
  if ($('sel-mapa-desc')) $('sel-mapa-desc').textContent = MAPAS[mapaIdx].desc || '';
  if ($('sel-modo-nome')) $('sel-modo-nome').textContent = MODOS[modoIdx].nome;
  if ($('sel-jaeger')) $('sel-jaeger').textContent = ESTILO === 'j' ? 'SIM 🤖' : 'não';
  if ($('sel-nivel')) $('sel-nivel').textContent = NIVEIS[nivelIdx].nome;
  if ($('sel-modif')) $('sel-modif').textContent = MODIFS[modifIdx].nome;
}
// Monta as grades (1x): cards de mapa com foto e cards de modo
const slugMapa = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
{
  const mg = $('mapa-grid');
  if (mg) {
    mg.innerHTML = MAPAS.map((m, i) => `<div class="mapa-card" data-i="${i}">`
      + `<img src="${ASSET('assets/mapas/' + slugMapa(m.nome) + '.jpg')}" alt="" loading="lazy" onerror="this.remove()">`
      + `<div class="mc-nome">${m.nome}</div></div>`).join('');
    mg.querySelectorAll('.mapa-card').forEach((c) => c.addEventListener('click', () => {
      if (state !== 'selecao' || selFase !== 'mapa') return;
      const i = parseInt(c.dataset.i, 10);
      if (mapaIdx === i) { selFase = 'modo'; som.confirmar(); } // 2º clique confirma
      else { setMapa(i); som.selecionar(); }
      atualizarSelecao();
    }));
  }
  const og = $('modo-grid');
  if (og) {
    og.innerHTML = MODOS.map((m, i) => `<div class="modo-card" data-i="${i}">`
      + `<div class="mo-ico">${m.ico}</div><div class="mo-nome">${m.nome}</div><div class="mo-desc">${m.desc}</div></div>`).join('');
    og.querySelectorAll('.modo-card').forEach((c) => c.addEventListener('click', () => {
      if (state !== 'selecao' || selFase !== 'modo') return;
      const i = parseInt(c.dataset.i, 10);
      if (modoIdx === i) { iniciarLuta(); return; } // 2º clique começa
      modoIdx = i; som.selecionar(); atualizarSelecao();
    }));
  }
}
// Monta o elenco da seleção (Jaeger, Kaiju + bonecos comprados na loja 🛒).
// Clicar num card escolhe a fantasia do J1; clicar de novo confirma (bom pra mouse).
function montarRoster() {
  const r = $('sel-roster');
  if (!r) return;
  r.classList.toggle('muitos', MENU_SKINS.length > 4);
  r.innerHTML = MENU_SKINS.map((skinIdx, k) => `<div class="sel-card" data-k="${k}">`
    + `<div class="sel-badges" id="sel-badges${k}"></div>`
    + `<img id="sel-card-img${k}" alt="" src="${ASSET(`assets/retratos/${SKINS[skinIdx].id}.jpg`)}" onerror="this.style.visibility='hidden'">`
    + `<div class="sel-card-nome" id="sel-card-nome${k}"></div>`
    + `<div class="sel-card-classe" id="sel-card-cl${k}"></div></div>`).join('');
  r.querySelectorAll('.sel-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (state !== 'selecao' || selFase !== 'skins') return;
      const skinIdx = MENU_SKINS[parseInt(card.dataset.k, 10)];
      if (selCfg[0].skin !== skinIdx && !selCfg[0].conf) {
        setSkinDireto(0, skinIdx);
      } else if (!selCfg[0].conf) {
        selCfg[0].conf = true; som.confirmar(); checarFaseMapa();
      }
      atualizarSelecao();
    });
  });
}
montarRoster();
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
  slot.skin = MENU_SKINS[Math.floor(Math.random() * MENU_SKINS.length)];
  som.confirmar();
  atualizarSelecao();
}
function mostrarSelecao() {
  if (morroVis) { scene.remove(morroVis); morroVis = null; }
  if (telao) telao.m.visible = false;
  limparAneisTime();
  for (const l of lutadores) l._anelTime = null;
  world.gravity = { x: 0, y: -9.81, z: 0 }; // desfaz modificador de festa no menu
  AJUSTES.forcaSoco = 1; AJUSTES.turbo = 1;
  selFase = 'skins';
  for (const c of selCfg) {
    c.conf = false;
    if (c.tipo === 'cpu') { c.ativo = false; c.tipo = 'gp'; }
  }
  $('titulo').style.display = 'none';
  $('selecao').style.display = 'flex';
  document.body.classList.add('menu');
  for (const l of lutadores) l.rag.reset(); // arruma os enfeites no palco
  showMsg('');
  state = 'selecao';
  som.musica('menu');
  atualizarSelecao();
}
// Tela de título (cartoon arcade): JOGAR / ONLINE / COMO JOGAR
function mostrarTitulo() {
  state = 'titulo';
  $('titulo').style.display = 'flex';
  $('selecao').style.display = 'none';
  document.body.classList.add('menu');
  som.musica('menu');
}
function startIntro(roundN) {
  state = 'intro';
  introStep = 0;
  stateUntil = simNow + 0.9;
  replayBuf.length = 0;
  for (const l of lutadores) l._morroT = 0; // rei do morro zera a coroa por round
  morroTickAt = 0;
  const elM = document.getElementById('mapa');
  if (elM) elM.textContent = 'MAPA: ' + MAPAS[mapaIdx].nome;
  limparPowerups();
  proxPowerEm = 0;
  // Round decisivo: alguém (ou uma dupla) está a 1 ponto de fechar a partida
  const decisivo = WIN_SCORE > 1 && lutadores.some((l) => l.score === WIN_SCORE - 1);
  showMsg('ROUND ' + roundN, decisivo ? '🔥 ROUND DECISIVO!' : '');
}
function iniciarLuta() {
  $('selecao').style.display = 'none';
  document.body.classList.remove('menu');
  WIN_SCORE = MODOS[modoIdx].vitorias;   // aplica o modo escolhido
  MODO_CAOS = MODOS[modoIdx].caos;
  MODO_MORRO = !!MODOS[modoIdx].morro;
  MODO_TIMES = !!MODOS[modoIdx].times;
  if (morroVis) { scene.remove(morroVis); morroVis = null; }
  if (MODO_MORRO) { // zona dourada no centro
    morroVis = new THREE.Mesh(
      new THREE.RingGeometry(MORRO_RAIO - 0.16, MORRO_RAIO, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    morroVis.rotation.x = -Math.PI / 2; morroVis.position.y = 0.03;
    scene.add(morroVis);
  }
  aplicarModificador(); // festa: lua/turbo/fortões (ou volta ao normal)
  const configs = selCfg.filter((c) => c.ativo).map((c) => ({ ...c }));
  // DUPLAS: completa a sala até 4 com bots (seus aliados e rivais)
  if (MODO_TIMES) while (configs.length < 4) configs.push({ tipo: 'cpu', skin: MENU_SKINS[configs.length % MENU_SKINS.length], ativo: true, conf: true });
  montarLutadores(configs);
  criarAneisTime(); // anel colorido do time sob cada lutador (só em DUPLAS)
  mapa.reset?.(true);
  melhorClip = null; finalWinner = null; // zera a melhor jogada da partida
  updateScore();
  som.confirmar();
  som.musica(MAPAS[mapaIdx].trilha || 'luta'); // trilha temática do bioma
  startIntro(1);
}

// 📺 Telão holográfico: placar ciano flutuando sobre a arena (offline)
let telao = null;
function garantirTelao() {
  if (telao) return;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.44),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  m.position.set(0, 3.7, -5.2);
  m.rotation.x = 0.15; // levemente inclinado pra câmera (que olha de cima)
  scene.add(m);
  telao = { cv, tex, m };
}
function desenharTelao() {
  if (!telao || !lutadores.length) return;
  const g = telao.cv.getContext('2d');
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = 'rgba(6,24,44,0.72)'; g.fillRect(0, 0, 512, 160); // vidro escuro (legível em céu claro)
  g.fillStyle = 'rgba(40,220,255,0.08)'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = 'rgba(80,230,255,0.9)'; g.lineWidth = 3; g.strokeRect(4, 4, 504, 152);
  g.fillStyle = 'rgba(80,230,255,0.06)'; // scanlines de holograma
  for (let y = 8; y < 160; y += 8) g.fillRect(0, y, 512, 3);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lutadores.length, w = 512 / n;
  lutadores.forEach((l, i) => {
    const x = w * i + w / 2;
    g.font = "800 46px 'Titan One','Fredoka',sans-serif";
    g.fillStyle = '#bff3ff';
    g.fillText(String(l.score), x, 60);
    g.font = "700 19px 'Fredoka',sans-serif";
    g.fillStyle = 'rgba(160,240,255,0.9)';
    g.fillText(SKINS[l.cfg.skin].nome.slice(0, 10), x, 114);
    if (i < n - 1) { g.strokeStyle = 'rgba(80,230,255,0.3)'; g.beginPath(); g.moveTo(w * (i + 1), 20); g.lineTo(w * (i + 1), 140); g.stroke(); }
  });
  telao.tex.needsUpdate = true;
}
function updateScore() {
  const placar = $('placar');
  if (!lutadores.length) { placar.innerHTML = ''; return; }
  if (!online) { garantirTelao(); desenharTelao(); } // visibilidade é por frame (updateHudBarras)
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
  if (telao) { // telão só durante a partida offline, com tremeluz de holograma
    telao.m.visible = !online && ['luta', 'intro', 'ponto', 'replay', 'fim'].includes(state);
    if (telao.m.visible) telao.m.material.opacity = 0.78 + Math.sin(now * 9) * 0.07;
  }
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

// Tela de vitória: retrato do campeão + placar de estatísticas (MVP destacado) + confete
function mostrarVitoria(winner) {
  const linhas = lutadores.map((l) => {
    const s = l.rag.stats;
    const prec = s.socos ? Math.round((s.acertos / s.socos) * 100) : 0;
    const eu = MODO_TIMES ? timeDe(l) === timeDe(winner) : l === winner;
    return `<div class="vit-linha${eu ? ' mvp' : ''}"><span class="vl-nome">${eu ? '🏆 ' : ''}${SKINS[l.cfg.skin].nome}</span>` +
      `<span>👊 ${s.acertos}/${s.socos} (${prec}%) · 🤸 ${s.arremessos} · ⏱️ ${s.pendurado.toFixed(0)}s</span></div>`;
  }).join('');
  const titulo = MODO_TIMES ? `🏆 DUPLA ${NOMES_TIME[timeDe(winner)]} VENCEU!` : `🏆 ${SKINS[winner.cfg.skin].nome} VENCEU!`;
  const retrato = ASSET(`assets/retratos/${SKINS[winner.cfg.skin].id}.jpg`);
  const btnClip = (melhorClip && window.MediaRecorder)
    ? `<button id="vit-baixar" type="button">🎬 BAIXAR A MELHOR JOGADA</button>` : '';
  if (torneio) torneioRegistrarVencedor(winner); // avança o vencedor na chave
  const dica = torneio
    ? (torneio.campeao != null ? 'Aperte F — TEMOS UM CAMPEÃO! 🏆' : 'Aperte F pra voltar à chave do torneio')
    : 'Aperte R pra voltar à seleção';
  $('msg').innerHTML =
    `<div class="vitoria"><img class="vit-retrato" src="${retrato}" alt="">` +
    `<div class="vit-tit">${titulo}</div>` +
    `<div class="vit-stats">${linhas}</div>` +
    btnClip +
    `<div class="vit-dica">${dica}</div></div>`;
  $('msg').style.display = 'block';
  $('vit-baixar')?.addEventListener('click', baixarMelhorJogada);
}

// Manômetro sci-fi do SOCÃO: dial escuro, escala de 270°, zona vermelha no fim
function desenharGauge(cv, carga) {
  const g = cv.getContext('2d'), C = 64;
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(C, C, 52, 0, 6.29);
  g.fillStyle = 'rgba(12,10,28,.88)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#2a1030'; g.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270° de escala
  g.lineWidth = 10; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.14)';
  g.beginPath(); g.arc(C, C, 38, a0, a1); g.stroke();
  g.strokeStyle = 'rgba(255,70,70,.45)'; // zona vermelha (25% finais)
  g.beginPath(); g.arc(C, C, 38, a0 + (a1 - a0) * 0.75, a1); g.stroke();
  g.strokeStyle = carga < 0.5 ? '#7ed957' : carga < 0.8 ? '#ffd94a' : '#ff5252';
  g.beginPath(); g.arc(C, C, 38, a0, a0 + (a1 - a0) * carga); g.stroke();
  const ang = a0 + (a1 - a0) * carga; // ponteiro
  g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(C, C); g.lineTo(C + Math.cos(ang) * 34, C + Math.sin(ang) * 34); g.stroke();
  g.beginPath(); g.arc(C, C, 5, 0, 6.29); g.fillStyle = '#fff'; g.fill();
  if (carga >= 1) { g.font = '26px sans-serif'; g.textAlign = 'center'; g.fillText('💥', C, C - 16); }
}
const CORES_CONFETE = ['#ff5a5a', '#ffd94a', '#7ed957', '#66e0ff', '#c77dff', '#ff9a3c'];
function confete(qtd = 70) {
  for (let i = 0; i < qtd; i++) {
    const d = document.createElement('div');
    d.className = 'confete';
    d.style.left = (Math.random() * 100) + 'vw';
    d.style.background = CORES_CONFETE[i % CORES_CONFETE.length];
    d.style.animationDuration = (1.6 + Math.random() * 1.8) + 's';
    d.style.animationDelay = (Math.random() * 0.7) + 's';
    if (Math.random() < 0.5) d.style.borderRadius = '50%';
    d.addEventListener('animationend', () => d.remove());
    document.body.appendChild(d);
  }
}

// Seleção por teclado
addEventListener('keydown', (e) => {
  if (state !== 'selecao') return;
  if (e.code === 'Escape') { // volta um passo: modo -> mapa -> skins -> título
    if (selFase === 'modo') { selFase = 'mapa'; atualizarSelecao(); }
    else if (selFase === 'mapa') mostrarSelecao();
    else mostrarTitulo();
    return;
  }
  if (selFase === 'skins') {
    if (!selCfg[0].conf && e.code === 'KeyA') trocarSkin(0, -1);
    if (!selCfg[0].conf && e.code === 'KeyD') trocarSkin(0, 1);
    if (!selCfg[0].conf && e.code === 'KeyW') trocarCor(0, 1);   // 🎨 J1 pinta
    if (!selCfg[0].conf && e.code === 'KeyS') trocarCor(0, -1);
    if (!selCfg[0].conf && e.code === 'KeyF') { selCfg[0].conf = true; som.confirmar(); }
    if (!selCfg[1].conf && e.code === 'ArrowLeft') trocarSkin(1, -1);
    if (!selCfg[1].conf && e.code === 'ArrowRight') trocarSkin(1, 1);
    if (!selCfg[1].conf && e.code === 'ArrowUp') trocarCor(1, 1); // 🎨 J2 pinta
    if (!selCfg[1].conf && e.code === 'ArrowDown') trocarCor(1, -1);
    if (!selCfg[1].conf && e.code === 'KeyK') { selCfg[1].conf = true; som.confirmar(); }
    if (e.code === 'KeyC') addBot(); // dá pra chamar o bot já na escolha
    checarFaseMapa();
  } else if (selFase === 'mapa') { // tela de arena (cards com foto, preview ao vivo atrás)
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { setMapa(mapaIdx - 1); som.selecionar(); }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') { setMapa(mapaIdx + 1); som.selecionar(); }
    if (e.code === 'KeyX') { setMapa((Math.random() * MAPAS.length) | 0); som.confirmar(); } // 🎲 sorteio
    if (e.code === 'KeyC') addBot();
    if (e.code === 'KeyN') { modoIdx = (modoIdx + 1) % MODOS.length; som.selecionar(); } // atalho antigo
    if (e.code === 'KeyJ') alternarModelo3D(); // liga/desliga o Jaeger (preview + partida)
    if (e.code === 'KeyF' || e.code === 'Enter') { selFase = 'modo'; som.confirmar(); }
  } else { // tela de modo de jogo
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { modoIdx = (modoIdx + MODOS.length - 1) % MODOS.length; som.selecionar(); }
    if (e.code === 'KeyD' || e.code === 'ArrowRight' || e.code === 'KeyN') { modoIdx = (modoIdx + 1) % MODOS.length; som.selecionar(); }
    if (e.code === 'KeyV') { nivelIdx = (nivelIdx + 1) % NIVEIS.length; som.selecionar(); } // dificuldade dos bots
    if (e.code === 'KeyG') { modifIdx = (modifIdx + 1) % MODIFS.length; som.selecionar(); } // modificador de festa
    if (e.code === 'KeyC') addBot();
    if (e.code === 'KeyJ') alternarModelo3D();
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
    } else if (g === 0 && selFase === 'mapa') {
      if (esq) { setMapa(mapaIdx - 1); som.selecionar(); }
      if (dir) { setMapa(mapaIdx + 1); som.selecionar(); }
      if (a) { selFase = 'modo'; som.confirmar(); }
      atualizarSelecao();
    } else if (g === 0) { // fase modo
      if (esq) { modoIdx = (modoIdx + MODOS.length - 1) % MODOS.length; som.selecionar(); }
      if (dir) { modoIdx = (modoIdx + 1) % MODOS.length; som.selecionar(); }
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

// ---------- Melhor jogada (Play of the Game) ----------
// Heurística: pontua momentos (nocaute/ring-out, golpe decisivo, autor) e guarda
// o clipe de maior nota da partida inteira, pra tocar no final.
let melhorClip = null;   // { frames, score, tipo, autorNome, autorSkin }
let finalWinner = null;  // vencedor da partida (pra cutscene)
let cutT = 0;            // tempo da cutscene
let gravandoClip = false, gravacao = null; // download da melhor jogada (.webm)
// Toca a melhor jogada DE NOVO gravando só o canvas (sem HUD) e baixa o .webm
function baixarMelhorJogada() {
  if (!melhorClip || state !== 'fim' || gravandoClip || !window.MediaRecorder) return;
  const btn = $('vit-baixar');
  if (btn) { btn.disabled = true; btn.textContent = '⏺️ gravando…'; }
  const stream = r3.domElement.captureStream(60);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((mm) => MediaRecorder.isTypeSupported(mm)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    window._replayBytes = blob.size; // teste automatizado espia aqui
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wobblers-melhor-jogada.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  gravacao = rec;
  rec.start();
  showMsg(''); // vídeo limpo: esconde a tela de vitória enquanto grava
  gravandoClip = true;
  state = 'melhor'; replayT = 0;
  som.lutem?.();
}
function considerarHighlight(vitima, tipo, decisiva) {
  if (replayBuf.length < 15) return;
  const autorRag = (simNow - (vitima.rag._agrAt ?? -10) < 3.5) ? vitima.rag._agr : null;
  const autorL = autorRag ? lutadores.find((l) => l.rag === autorRag) : null;
  let score = tipo === 'ringout' ? 100 : 55; // ring-out vale mais que nocaute
  if (decisiva) score += 60;                 // o golpe que decidiu a partida
  if (autorL) score += 20;                   // tem autor claro
  score += Math.random() * 6;                // desempate
  if (!melhorClip || score > melhorClip.score) {
    melhorClip = {
      frames: replayBuf.map((f) => f.slice()),
      score, tipo,
      autorNome: autorL ? SKINS[autorL.cfg.skin].nome : SKINS[vitima.cfg.skin].nome,
      autorSkin: autorL ? autorL.cfg.skin : vitima.cfg.skin,
      semAutor: !autorL,
    };
  }
}
function aplicarClipe(frames, idx) {
  const snap = frames[idx];
  if (!snap) return;
  let o = 0;
  for (const [, m] of corposDoReplay()) {
    m.position.set(snap[o], snap[o + 1], snap[o + 2]);
    m.quaternion.set(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]);
    o += 7;
  }
}

// Sequência de final: MELHOR JOGADA (replay em câmera lenta) -> cutscene do vencedor -> vitória
function iniciarSequenciaFinal(winner) {
  finalWinner = winner;
  som.vitoria();
  som.vozYay(VOZES[winner.slot]);
  // 🪙 partida fechada por gente de verdade: bônus da loja. O prêmio ESCALA com
  // o tamanho do modo (5 + 5×pontos) — morte súbita paga 10, melhor de 5 paga 30 —
  // senão farmar partida de 1 round vira a jogada esperta. Perdeu mas jogou: +8 de
  // consolação (derrota nunca é zero). No TORNEIO só o campeão é premiado (+40).
  const humanoVenceu = MODO_TIMES
    ? lutadores.some((l) => timeDe(l) === timeDe(winner) && l.cfg.tipo !== 'cpu')
    : winner.cfg.tipo !== 'cpu';
  if (!torneio) {
    if (humanoVenceu) ganharMoedas(5 + 5 * WIN_SCORE);
    else if (lutadores.some((l) => l.cfg.tipo !== 'cpu')) ganharMoedas(8);
  }
  somarCarreira(humanoVenceu); // 📊 estatísticas de carreira + conquistas 🏅
  if (melhorClip && melhorClip.frames.length > 15) {
    state = 'melhor'; replayT = 0;
    const quem = melhorClip.semAutor ? '' : `de ${melhorClip.autorNome}`;
    showMsg('<span class="mj-tit">🏆 MELHOR JOGADA</span>', quem);
    som.lutem?.();
  } else {
    iniciarCutscene();
  }
}
function iniciarCutscene() {
  state = 'cutscene'; cutT = 0;
  showMsg('');
  if (finalWinner) finalWinner.rag.emote?.(simNow); // vencedor comemora
  confete();
}
// Tratamento de CINEMA: letterbox (CSS body.cine) + lente fechando pra 46°.
// Chamar com true nos estados dirigidos e false no jogo normal (transição suave).
function aplicarCine(ligado) {
  const alvoFov = ligado ? 46 : 55;
  if (Math.abs(camera.fov - alvoFov) > 0.05) {
    camera.fov += (alvoFov - camera.fov) * 0.07;
    camera.updateProjectionMatrix();
  }
  document.body.classList.toggle('cine', ligado);
}
// Órbita dirigida (replay/melhor jogada): altura de ombro, dolly-in com o tempo
function camCineDirigida(ct, midX, midZ, spread = 0) {
  const ang = -0.85 + ct * 0.22;
  const raio = Math.max(3.4, 5.6 - ct * 0.45) + spread * 0.3;
  camPos.lerp(_v3cam.set(
    midX * 0.6 + Math.sin(ang) * raio,
    1.5 + ct * 0.14 + spread * 0.08,
    midZ * 0.3 + Math.cos(ang) * raio,
  ), 0.09);
  camera.position.copy(camPos);
  camera.lookAt(midX * 0.6, 0.95, midZ * 0.3);
}
// Média das pélvis de uma lista de {meshes} — foco das câmeras dirigidas
function meioDe(iteravel) {
  let mx = 0, mz = 0, n = 0;
  for (const v of iteravel) { const p = v.meshes.pelvis.position; mx += p.x; mz += p.z; n++; }
  return n ? [mx / n, mz / n] : [0, 0];
}
// Câmera orbitando o vencedor (cutscene)
function camVencedor(t) {
  if (!finalWinner) return;
  const p = finalWinner.meshes.pelvis.position;
  const ang = t * 0.0006;
  camera.position.set(p.x + Math.sin(ang) * 3.2, p.y + 1.5, p.z + Math.cos(ang) * 3.2);
  camera.lookAt(p.x, p.y + 0.6, p.z);
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
    const cairam = [];
    for (const l of lutadores) {
      if (l.vivo && l.rag.parts.pelvis.translation().y < -8) {
        l.vivo = false;
        l.rag.stats.quedas++;
        som.queda();
        som.vozChoro(VOZES[l.slot]);
        fogosFx(); // a plateia celebra o ring-out 🎆
        trauma = 1; hitStop = Math.max(hitStop, 0.11); // baque forte no nocaute/ring-out
        l.rag.rivals = [];
        cairam.push(l);
        for (const o of lutadores) o.rag.rivals = rivaisDe(o, true).map((x) => x.rag);
      }
    }
    // REI DO MORRO: ficar na zona central acumula a coroa; 10s fecham o round
    if (MODO_MORRO) {
      const dtm = morroTickAt ? Math.min(0.1, simNow - morroTickAt) : 0;
      morroTickAt = simNow;
      let lider = null;
      for (const l of lutadores) {
        if (!l.vivo) continue;
        const pp = l.rag.parts.pelvis.translation();
        if (Math.hypot(pp.x, pp.z) < MORRO_RAIO && pp.y > -1 && !l.rag.isDowned(simNow)) l._morroT = (l._morroT || 0) + dtm;
        if (!lider || (l._morroT || 0) > (lider._morroT || 0)) lider = l;
      }
      if (morroVis) {
        const dono = lider && (lider._morroT || 0) > 0.5;
        morroVis.material.opacity = 0.35 + 0.2 * Math.sin(simNow * 5);
        morroVis.material.color.setHex(dono ? SKINS[lider.cfg.skin].cores.torso : 0xffd94a);
      }
      const elM = document.getElementById('mapa');
      if (elM && lider && (lider._morroT || 0) > 0) {
        elM.textContent = `👑 ${SKINS[lider.cfg.skin].nome}: ${Math.min(MORRO_ALVO, lider._morroT).toFixed(1)}s / ${MORRO_ALVO}s`;
      }
      const rei = lutadores.find((l) => l.vivo && (l._morroT || 0) >= MORRO_ALVO);
      if (rei) { som.vitoria(); for (const l of lutadores) if (l !== rei) l.vivo = false; } // rei fecha o round
    }
    const v = vivos();
    // Guarda os ring-outs como candidatos a "melhor jogada" (decisivo = fecha a partida)
    if (cairam.length) {
      const decisiva = v.length <= 1 && v[0] && (v[0].score + 1) >= WIN_SCORE;
      for (const l of cairam) considerarHighlight(l, 'ringout', decisiva);
    }
    // DUPLAS: o round fecha quando só sobra gente de UM time
    const fimRound = MODO_TIMES ? new Set(v.map(timeDe)).size <= 1 : v.length <= 1;
    if (fimRound) {
      const winner = v[0] ?? null;
      if (winner && MODO_TIMES) { for (const l of lutadores) if (timeDe(l) === timeDe(winner)) l.score++; }
      else if (winner) winner.score++;
      // 🪙 round vencido por gente de verdade rende moedas da loja
      const humanoVenceu = winner && (MODO_TIMES
        ? lutadores.some((l) => timeDe(l) === timeDe(winner) && l.cfg.tipo !== 'cpu')
        : winner.cfg.tipo !== 'cpu');
      if (humanoVenceu && !torneio) { ganharMoedas(5); carreira.rounds++; salvarCarreira(); checarConquistas(); }
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
    for (const o of lutadores) o.rag.rivals = rivaisDe(o, false).map((x) => x.rag);
    mapa.reset?.(false);
    // em DUPLAS o score é por time — conta um representante de cada, senão o nº do round dobra
    startIntro(MODO_TIMES
      ? (lutadores.find((l) => timeDe(l) === 0)?.score || 0) + (lutadores.find((l) => timeDe(l) === 1)?.score || 0) + 1
      : lutadores.reduce((s, l) => s + l.score, 0) + 1);
  } else if (state === 'fim' && isDown('KeyR') && !torneio) { // no torneio o F/R volta pra chave
    for (const l of lutadores) { l.rag.reset(); l.vivo = true; }
    mapa.reset?.(true);
    mostrarSelecao();
  }
}
function fecharRound() {
  const winner = pendente;
  pendente = null;
  if (winner && winner.score >= WIN_SCORE) {
    iniciarSequenciaFinal(winner); // melhor jogada -> cutscene -> vitória
  } else {
    som.ponto();
    state = 'ponto';
    stateUntil = simNow + 1.4;
    showMsg(winner ? (MODO_TIMES ? 'PONTO DA DUPLA ' + NOMES_TIME[timeDe(winner)] + '!' : 'PONTO DO ' + SKINS[winner.cfg.skin].nome + '!') : 'EMPATE!');
  }
}

// ---------- Cliente online (LAN) ----------
// O servidor roda a física oficial; aqui só mandamos botões e
// interpolamos os snapshots que chegam (~20Hz) pra 60fps.
let online = null;
// Ordem IGUAL ao ARENAS_ON do servidor (índices da votação 🗳️)
const ARENAS_CLI = ['CLÁSSICA', 'GELO 🧊', 'ENCOLHE 😱', 'ABISMO 🕳️', 'RODÍZIO 🎲'];

function iniciarOnline() {
  $('selecao').style.display = 'none';
  if ($('titulo')) $('titulo').style.display = 'none';
  document.body.classList.remove('menu');
  online = { ws: null, slot: null, visuais: new Map(), armasVis: new Map(), powerVis: new Map(), buf: [], msgAtual: null, jaeger: false, forcarGominha: false, melhorPend: null, faseFinal: null, desconectou: false, inputTimer: null, aguardando: false, reconTimer: null, nomes: new Map(), nome: '' };
  online.marcador = new THREE.Sprite(new THREE.SpriteMaterial({ map: voceTex, transparent: true, depthWrite: false, fog: false }));
  online.marcador.scale.setScalar(0.55); online.marcador.visible = false; scene.add(online.marcador);
  // votação clicável do lobby (os cards são re-renderizados a cada snapshot,
  // então o clique vai por atributo onclick -> este hook global)
  window._votarArena = (i) => { if (online?.ws?.readyState === 1) online.ws.send(JSON.stringify({ t: 'arena', a: i })); };
  pedirApelido(); // pergunta o apelido (1x, fica salvo) e só então conecta

  // Telinha de apelido: input + entrar. Salva em localStorage pra próxima vez.
  function pedirApelido() {
    // ?sala=XXXX (link do amigo) ou ?sala=nova entram direto nessa sala
    if (PARAMS.get('sala')) online.salaDesejo = PARAMS.get('sala').toUpperCase();
    if (PARAMS.has('nome')) { // ?nome=X pula a telinha (links diretos e testes)
      online.nome = (PARAMS.get('nome') || '').slice(0, 12);
      online.corIdx = lerCorIdx('wobblers_corOn'); // tinta salva vale mesmo pulando a telinha
      conectarWS();
      return;
    }
    const salvo = (store.get('wobblers_nome') || '').slice(0, 12);
    const ov = document.createElement('div');
    ov.id = 'apelido-ov';
    ov.style.cssText = `position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(11,8,26,.88);backdrop-filter:blur(4px);font-family:'Fredoka',system-ui,sans-serif;`;
    ov.innerHTML = `
      <div style="font-family:'Titan One','Fredoka',sans-serif;font-size:clamp(26px,6vw,40px);color:#ffd94a;text-shadow:0 3px 0 rgba(0,0,0,.4)">SEU APELIDO</div>
      <input id="apelido-in" maxlength="12" placeholder="ex.: Guto" autocomplete="off" style="width:min(78vw,300px);padding:13px 18px;border-radius:14px;border:2px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font:700 20px 'Fredoka',sans-serif;text-align:center;outline:none">
      <div style="font-size:13px;color:#b0a6c8;margin-bottom:-6px">🎨 pinte seu boneco</div>
      <div id="apelido-cores" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:340px"></div>
      <button id="apelido-ok" type="button" style="border:0;border-radius:999px;cursor:pointer;padding:13px 40px;font:800 18px 'Titan One','Fredoka',sans-serif;color:#08201c;background:linear-gradient(180deg,#55e6c6,#16b79b);box-shadow:0 5px 0 #0c8a74">ENTRAR NA SALA</button>
      <div style="font-size:13px;color:#b0a6c8">aparece sobre o seu boneco e no placar</div>`;
    document.body.appendChild(ov);
    // 🎨 paleta de tintas (a 1ª bolinha é a cor original da fantasia)
    online.corIdx = lerCorIdx('wobblers_corOn');
    const caixa = ov.querySelector('#apelido-cores');
    const pintarSel = () => caixa.querySelectorAll('button').forEach((b, i) => {
      b.style.outline = i === online.corIdx ? '3px solid #fff' : 'none';
      b.style.transform = i === online.corIdx ? 'scale(1.18)' : 'none';
    });
    PALETA.forEach((ent, i) => {
      const cor = corDe(ent);
      const b = document.createElement('button');
      b.type = 'button';
      b.title = ent && ent.id ? ent.id.toUpperCase() + ' 🛒' : (cor == null ? 'cor original' : cssCor(cor));
      b.style.cssText = `width:28px;height:28px;border-radius:50%;cursor:pointer;border:2px solid rgba(0,0,0,.45);`
        + (cor == null ? 'background:conic-gradient(#ff5252,#ffd94a,#7ed957,#66e0ff,#c77dff,#ff5252);' : `background:${cssCor(cor)};`)
        + (ent && ent.matx && ent.matx.emissivoK > 0.3 ? `box-shadow:0 0 10px ${cssCor(cor)};` : '');
      b.addEventListener('click', () => { online.corIdx = i; store.set('wobblers_corOn', i); pintarSel(); som.selecionar?.(); });
      caixa.appendChild(b);
    });
    pintarSel();
    const inp = ov.querySelector('#apelido-in');
    inp.value = salvo; inp.focus();
    const confirmar = () => {
      const n = inp.value.trim().slice(0, 12);
      online.nome = n;
      if (n) store.set('wobblers_nome', n);
      ov.remove();
      if (online.salaDesejo) conectarWS(); // veio por link com sala: entra direto
      else escolherSala(); // senão: JOGAR AGORA / criar sala / código
    };
    ov.querySelector('#apelido-ok').addEventListener('click', confirmar);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmar(); e.stopPropagation(); });
  }

  // Telinha de sala: quick play, sala privada pros amigos, ou entrar com código
  function escolherSala() {
    const ov = document.createElement('div');
    ov.id = 'sala-ov';
    ov.style.cssText = `position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(11,8,26,.88);backdrop-filter:blur(4px);font-family:'Fredoka',system-ui,sans-serif;`;
    const btn = (grad, sombra) => `border:0;border-radius:999px;cursor:pointer;padding:14px 34px;font:800 19px 'Titan One','Fredoka',sans-serif;color:#08201c;background:${grad};box-shadow:0 5px 0 ${sombra};min-width:min(78vw,300px)`;
    ov.innerHTML = `
      <div style="font-family:'Titan One','Fredoka',sans-serif;font-size:clamp(24px,5.5vw,36px);color:#ffd94a;text-shadow:0 3px 0 rgba(0,0,0,.4)">JOGAR ONLINE</div>
      <button id="sala-agora" type="button" style="${btn('linear-gradient(180deg,#55e6c6,#16b79b)', '#0c8a74')}">🎲 JOGAR AGORA</button>
      <button id="sala-nova" type="button" style="${btn('linear-gradient(180deg,#ffd94a,#ffb52e)', '#b57a0c')}">🔑 CRIAR SALA (amigos)</button>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="sala-cod" maxlength="4" placeholder="CÓDIGO" autocomplete="off" style="width:120px;padding:12px;border-radius:14px;border:2px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font:800 20px 'Fredoka',sans-serif;text-align:center;letter-spacing:4px;text-transform:uppercase;outline:none">
        <button id="sala-entrar" type="button" style="border:0;border-radius:999px;cursor:pointer;padding:12px 22px;font:800 16px 'Titan One','Fredoka',sans-serif;color:#fff;background:linear-gradient(180deg,#7a6cff,#5546d6);box-shadow:0 4px 0 #38309c">ENTRAR</button>
      </div>
      <div style="font-size:13px;color:#b0a6c8;max-width:340px;text-align:center">🎲 cai numa sala pública com vaga &nbsp;·&nbsp; 🔑 cria uma sala só sua com código de 4 letras pros amigos</div>
      <div id="sala-lista" style="width:min(88vw,430px);max-height:30vh;overflow:auto;display:flex;flex-direction:column;gap:6px"></div>`;
    document.body.appendChild(ov);
    // Navegador de salas (estilo server browser): lista ao vivo das públicas
    const lista = ov.querySelector('#sala-lista');
    const linha = `display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font:600 14px 'Fredoka',sans-serif;color:#fff`;
    async function listarSalas() {
      try {
        const r = await fetch('/salas', { cache: 'no-store' });
        const d = await r.json();
        if (!ov.isConnected) return;
        const assinatura = JSON.stringify(d.salas);
        if (assinatura === lista._assinatura) return; // nada mudou: não re-renderiza (senão o clique escapa)
        lista._assinatura = assinatura;
        lista.innerHTML = d.salas.length
          ? `<div style="font-size:12px;letter-spacing:2px;color:#b0a6c8;text-align:center">SALAS ABERTAS</div>` + d.salas.map((s) =>
            `<div style="${linha}"><b style="letter-spacing:2px">${s.cd}</b>` +
            `<span style="opacity:.85">👥 ${s.na}/${s.cap}</span><span style="opacity:.7">${s.st}</span>` +
            `<span style="opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${s.an}</span>` +
            `<button data-sala="${s.cd}" type="button" style="border:0;border-radius:999px;cursor:pointer;padding:7px 16px;font:800 13px 'Titan One','Fredoka',sans-serif;color:#08201c;background:linear-gradient(180deg,#55e6c6,#16b79b)">ENTRAR</button></div>`).join('')
          : `<div style="font-size:13px;color:#b0a6c8;text-align:center">nenhuma sala aberta agora — crie a primeira! 🥊</div>`;
        for (const b of lista.querySelectorAll('[data-sala]')) b.addEventListener('click', () => ir(b.dataset.sala));
      } catch {}
    }
    listarSalas();
    const listaTimer = setInterval(() => { if (ov.isConnected) listarSalas(); else clearInterval(listaTimer); }, 2500);
    const ir = (sala) => { online.salaDesejo = sala; ov.remove(); clearInterval(listaTimer); conectarWS(); som.confirmar?.(); };
    ov.querySelector('#sala-agora').addEventListener('click', () => ir(''));
    ov.querySelector('#sala-nova').addEventListener('click', () => ir('NOVA'));
    const cod = ov.querySelector('#sala-cod');
    const entrarCod = () => { const c = cod.value.trim().toUpperCase(); if (c.length === 4) ir(c); else cod.focus(); };
    ov.querySelector('#sala-entrar').addEventListener('click', entrarCod);
    cod.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrarCod(); e.stopPropagation(); });
  }

  function conectarWS() {
  if (online.reconTimer) { clearTimeout(online.reconTimer); online.reconTimer = null; }
  showMsg(online.aguardando ? 'SALA CHEIA 😔' : 'CONECTANDO…', online.aguardando ? 'esperando abrir vaga — o host abre o modo até 20 no M' : '');
  // ws:// em rede local; wss:// quando a página vem por https (túnel/nuvem) — senão o navegador bloqueia
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(`${proto}${location.host}`);
  ws.binaryType = 'arraybuffer'; // snapshots vêm em binário (poses Int16)
  online.ws = ws; online.desconectou = false;
  ws.addEventListener('open', () => {
    const entC = PALETA[online.corIdx ?? 0]; // tinta escolhida (pode ser especial da loja)
    // reconexão volta pra MESMA sala (salaCod); entrada nova usa o que foi escolhido na telinha
    ws.send(JSON.stringify({ t: 'entrar', skin: selCfg[0].skin, kaiju: selCfg[0].skin === IDX_KAIJU, nome: online.nome, cor: corDe(entC) ?? undefined, mat: (entC && entC.id) || undefined, tk: online.tk || undefined, sala: online.salaCod || online.salaDesejo || undefined }));
    showMsg('NA SALA! 🌐', 'quando todos entrarem, o host (1º jogador) aperta F');
    online.inputTimer = setInterval(() => {
      if (ws.readyState !== 1) return;
      const inp = mergeInput(mergeInput(readInput(MAPS.p1), readGamepad(0)), readTouch());
      ws.send(JSON.stringify({
        t: 'input', m: [inp.move.x, inp.move.z],
        p: inp.punch, g: inp.grab, j: inp.jump, e: inp.emote, d: inp.esquiva,
      }));
    }, 33);
  });
  ws.addEventListener('close', () => {
    // cancela qualquer sequência final em andamento pra não sobrepor uma vitória falsa
    online.faseFinal = null; online.melhorPend = null;
    if (online.inputTimer) { clearInterval(online.inputTimer); online.inputTimer = null; }
    if (online.aguardando) {
      // sala cheia: fica na sala de espera e tenta de novo em alguns segundos (entra assim que abrir vaga)
      showMsg('SALA CHEIA 😔', 'esperando abrir vaga… tentando entrar de novo');
      online.reconTimer = setTimeout(() => { if (online && online.aguardando) conectarWS(); }, 4000);
      return;
    }
    // RECONEXÃO: com token, tenta religar sozinho (o servidor segura o slot 30s)
    online.reconN = (online.reconN || 0) + 1;
    if (online.tk && online.reconN <= 10) {
      showMsg('RECONECTANDO… 🔌', `tentativa ${online.reconN} de 10`);
      online.reconTimer = setTimeout(() => { if (online && !online.desconectou) conectarWS(); }, 2500);
      return;
    }
    online.desconectou = true;
    showMsg('DESCONECTOU 😵', 'o servidor fechou — recarrega a página');
    // limpa a cena pra não deixar bonecos/armas congelados
    for (const [, v] of online.visuais) destroyVisual(v.meshes);
    for (const [, a] of online.armasVis) scene.remove(a.mesh);
    for (const [, e] of online.powerVis) scene.remove(e.s);
    online.visuais.clear(); online.armasVis.clear(); online.powerVis.clear();
    if (online.marcador) online.marcador.visible = false;
    if (touchAtivo() && $('online-acoes')) $('online-acoes').style.display = 'none';
  });
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') { // oi / cheio / melhor (JSON)
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'oi') {
        const voltou = online.reconN > 0;
        online.slot = m.slot; online.aguardando = false;
        online.tk = m.tk || online.tk; online.reconN = 0;
        online.salaCod = m.cd || online.salaCod; online.publica = !!m.pb;
        if (voltou) { avisoOnline('🔌 RECONECTOU — de volta no seu boneco!'); showMsg(''); }
      }
      else if (m.t === 'sala404') {
        online.desconectou = true; online.tk = null;
        showMsg('SALA NÃO ENCONTRADA 😕', 'confere o código com quem criou (ou a sala já fechou) — recarrega a página');
      }
      else if (m.t === 'voto') { online.meuVoto = m.a; avisoOnline(`🗳️ seu voto: ${ARENAS_CLI[m.a] || '?'}`); som.selecionar?.(); }
      else if (m.t === 'cheio') { online.aguardando = true; showMsg('SALA CHEIA 😔', 'esperando abrir vaga…'); }
      else if (m.t === 'nomes') online.nomes = new Map(m.ns); // apelidos por slot
      else if (m.t === 'melhor') online.melhorPend = m; // clipe da melhor jogada
      return;
    }
    // Snapshot binário: cabeçalho JSON + poses Int16 (6 por parte)
    const dv = new DataView(e.data);
    const jsonLen = dv.getUint32(0, true);
    let meta;
    try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(e.data, 4, jsonLen))); } catch { return; }
    let off = 4 + jsonLen;
    const NP = PARTS.length;
    // defensivo: pacote curto/malformado é descartado em vez de estourar o handler
    if (!Array.isArray(meta.pl) || off + meta.pl.length * NP * 6 * 2 > e.data.byteLength) return;
    for (const pm of meta.pl) {
      const p = new Array(NP * 6);
      for (let k = 0; k < NP; k++) {
        const o = k * 6;
        p[o] = dv.getInt16(off, true) / 256; off += 2;
        p[o + 1] = dv.getInt16(off, true) / 256; off += 2;
        p[o + 2] = dv.getInt16(off, true) / 256; off += 2;
        p[o + 3] = dv.getInt16(off, true) / 32767; off += 2;
        p[o + 4] = dv.getInt16(off, true) / 32767; off += 2;
        p[o + 5] = dv.getInt16(off, true) / 32767; off += 2;
      }
      pm.p = p;
    }
    receberSnap(meta);
  });
  } // fim de conectarWS
  $('placar').style.flexWrap = 'wrap';
  $('placar').style.gap = '2px 12px';
  // Provocações no celular: mostra a coluninha de emojis e liga os cliques
  if (touchAtivo() && $('touch-gritos')) {
    $('touch-gritos').style.display = 'flex';
    for (const btn of $('touch-gritos').querySelectorAll('[data-grito]')) {
      btn.addEventListener('click', () => {
        if (online.ws && online.ws.readyState === 1) online.ws.send(JSON.stringify({ t: 'grito', g: +btn.dataset.grito }));
      });
    }
  }
  // "Copiar link" pra o host chamar a galera — inclui o código da sala, então o
  // amigo clica e cai DIRETO na sala certa (nem telinha de escolha aparece)
  if ($('cp-btn') && $('cp-link')) {
    const linkOnline = () => `${location.origin}${location.pathname}?servidor=1${online.salaCod ? `&sala=${online.salaCod}` : ''}`;
    const atualizarLink = () => { $('cp-link').textContent = linkOnline().replace(/^https?:\/\//, ''); };
    atualizarLink();
    online._linkTimer = setInterval(atualizarLink, 2000); // pega o código quando o 'oi' chegar
    $('cp-btn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkOnline()); }
      catch {
        const ta = document.createElement('textarea'); ta.value = linkOnline();
        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
      }
      const b = $('cp-btn'); b.textContent = 'copiado! ✓'; b.classList.add('ok');
      clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = 'copiar'; b.classList.remove('ok'); }, 1800);
    });
  }
  // Celular: botões de toque pro lobby (começar/trocar modo/pontos/jaeger)
  if (touchAtivo() && $('online-acoes')) {
    for (const btn of $('online-acoes').querySelectorAll('[data-act]')) {
      btn.addEventListener('click', () => { if (online.ws.readyState === 1) online.ws.send(JSON.stringify({ t: btn.dataset.act })); });
    }
  }
  addEventListener('keydown', (e) => {
    if (!online.ws || online.ws.readyState !== 1) return;
    if (e.code === 'KeyF') online.ws.send(JSON.stringify({ t: 'comecar' }));  // host começa
    if (e.code === 'KeyM') online.ws.send(JSON.stringify({ t: 'modo' }));     // host troca modo (8/20)
    if (e.code === 'KeyN') online.ws.send(JSON.stringify({ t: 'pontos' }));   // host troca pontuação
    if (e.code === 'KeyJ') online.ws.send(JSON.stringify({ t: 'jaeger' }));   // host liga robôs x monstros
    if (e.code === 'KeyT') online.ws.send(JSON.stringify({ t: 'lutador' }));  // QUALQUER um troca robô↔monstro
    if (e.code === 'KeyB') online.ws.send(JSON.stringify({ t: 'arena' }));    // host troca a variante de arena
    if (e.code === 'KeyH') online.ws.send(JSON.stringify({ t: 'morro' }));    // host liga o rei do morro 👑
    if (e.code === 'KeyY') online.ws.send(JSON.stringify({ t: 'times' }));    // host liga TIMES 🔴x🔵 (até 10x10)
    // provocações 😂💀😱❤️ nas teclas 1-4 (valem a qualquer momento)
    if (e.code === 'Digit1') online.ws.send(JSON.stringify({ t: 'grito', g: 0 }));
    if (e.code === 'Digit2') online.ws.send(JSON.stringify({ t: 'grito', g: 1 }));
    if (e.code === 'Digit3') online.ws.send(JSON.stringify({ t: 'grito', g: 2 }));
    if (e.code === 'Digit4') online.ws.send(JSON.stringify({ t: 'grito', g: 3 }));
  });
}

// Estilo efetivo do online = Jaeger se a sala pediu E o fallback de performance
// não desligou. Reconstrói os bonecos só quando o estilo muda de fato.
function aplicarEstiloOnline() {
  const querJ = online.jaeger && !online.forcarGominha;
  // se o estilo base já é 'j' (via ?estilo=j), o fallback precisa cair pra 'a' pra aliviar
  const novo = querJ ? 'j' : (ESTILO_BASE === 'j' ? 'a' : ESTILO_BASE);
  if (novo === ESTILO) return;
  ESTILO = novo;
  for (const [, v] of online.visuais) destroyVisual(v.meshes);
  online.visuais.clear();
}

// Avisinho que some sozinho (usa a linha de dica de baixo, vazia no online)
function avisoOnline(txt, ms = 4500) {
  const el = $('mapa'); if (!el) return;
  el.textContent = txt;
  clearTimeout(avisoOnline._t);
  avisoOnline._t = setTimeout(() => { if ($('mapa')) $('mapa').textContent = ''; }, ms);
}

// Tela de vitória do online: retrato do campeão + placar (top 6) + confete
function mostrarVitoriaOnline(m) {
  const ord = [...m.pl].sort((a, b) => b.sc - a.sc);
  const campeao = ord[0];
  if (!campeao) { showMsg(m.msg); return; }
  const nm = SKINS[campeao.sk % SKINS.length];
  const nomeDe = (pl) => online.nomes.get(pl.s) || SKINS[pl.sk % SKINS.length].nome;
  const top = ord.slice(0, 6).map((pl, i) => {
    const eu = pl.s === online.slot;
    return `<div class="vit-linha${i === 0 ? ' mvp' : ''}"><span class="vl-nome">${i === 0 ? '🏆 ' : ''}${nomeDe(pl)}${eu ? ' (você)' : ''}</span><span>${pl.sc} pts</span></div>`;
  }).join('');
  const resto = ord.length > 6 ? `<div class="vit-linha"><span class="vl-nome">+ ${ord.length - 6} jogadores</span><span></span></div>` : '';
  $('msg').innerHTML =
    `<div class="vitoria"><img class="vit-retrato" src="${ASSET(`assets/retratos/${nm.id}.jpg`)}" alt="">` +
    `<div class="vit-tit">🏆 ${nomeDe(campeao)} VENCEU!</div>` +
    `<div class="vit-stats">${top}${resto}</div>` +
    `<div class="vit-dica">host aperta F pra reiniciar</div></div>`;
  $('msg').style.display = 'block';
  confete();
  // 🪙 você venceu online: bônus da loja + carreira (1x por partida)
  if (!online._premiado && campeao && campeao.s === online.slot) {
    online._premiado = true;
    ganharMoedas(25);
    carreira.vitorias++; carreira.partidas++;
    salvarCarreira(); checarConquistas();
  }
}

// Aplica um frame do clipe da melhor jogada nos bonecos online (6 valores/parte, w reconstruído)
function aplicarClipeOnline(frame) {
  for (const pl of frame) {
    const v = online.visuais.get(pl.s); if (!v) continue;
    const p = pl.p; let o = 0;
    for (const spec of PARTS) {
      const msh = v.meshes[spec.name]; if (!msh) { o += 6; continue; }
      msh.position.set(p[o], p[o + 1], p[o + 2]);
      const x = p[o + 3], y = p[o + 4], z = p[o + 5], w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
      msh.quaternion.set(x, y, z, w).normalize();
      o += 6;
    }
  }
}
function camVencedorOnline(t) {
  const w = online.finalSnap ? [...online.finalSnap.pl].sort((a, b) => b.sc - a.sc)[0] : null;
  const v = w ? online.visuais.get(w.s) : null;
  if (!v) return;
  const p = v.meshes.pelvis.position, ang = t * 0.0006;
  camera.position.set(p.x + Math.sin(ang) * 3.2, p.y + 1.5, p.z + Math.cos(ang) * 3.2);
  camera.lookAt(p.x, p.y + 0.6, p.z);
}

function receberSnap(m) {
  online.buf.push({ rx: performance.now() / 1000, m });
  if (online.buf.length > 30) online.buf.shift();
  // Toggle Jaeger×Kaiju (o servidor manda 'jg'); aplica respeitando o fallback local
  if (m.jg !== undefined && !!m.jg !== online.jaeger) {
    online.jaeger = !!m.jg;
    aplicarEstiloOnline();
  }
  // Variante de arena (an) + escala do chão que encolhe (as)
  if (m.an && m.an !== online.arenaNome && mapa && mapa._deck) {
    online.arenaNome = m.an;
    if (!mapa._deckMatOrig) mapa._deckMatOrig = mapa._deck.material;
    if (online.abismoG) { // saiu do ABISMO: volta o chão normal
      scene.remove(online.abismoG); online.abismoG = null;
      mapa._deck.visible = true; if (mapa._base) mapa._base.visible = true;
    }
    if (/ABISMO/.test(m.an) && m.ah) {
      // moldura com buraco central, na MESMA geometria do servidor (m.ah = [hx,hz])
      mapa._deck.visible = false; if (mapa._base) mapa._base.visible = false;
      const [hx, hz] = m.ah, fx = hx * 0.42, fz = hz * 0.42;
      const matA = new THREE.MeshStandardMaterial({ map: texAbismo, roughness: 0.9 });
      const g = new THREE.Group();
      const add = (w, d, x, z) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), matA);
        b.position.set(x, -0.3, z); b.receiveShadow = true; g.add(b);
      };
      add(hx * 2, hz - fz, 0, (hz + fz) / 2); add(hx * 2, hz - fz, 0, -(hz + fz) / 2);
      add(hx - fx, fz * 2, (hx + fx) / 2, 0); add(hx - fx, fz * 2, -(hx + fx) / 2, 0);
      scene.add(g); online.abismoG = g;
    } else {
      mapa._deck.material = /GELO/.test(m.an)
        ? new THREE.MeshStandardMaterial({ map: texGelo, roughness: 0.15 })
        : mapa._deckMatOrig;
    }
  }
  // REI DO MORRO online: anel dourado no centro + HUD do líder
  const morroAtivo = !!m.mr && (m.st === 'luta' || m.st === 'intro');
  if (morroAtivo && !online.morroVis) {
    const raioM = 1.25 * (m.cap > 8 ? 1.9 : 1.2);
    online.morroVis = new THREE.Mesh(
      new THREE.RingGeometry(raioM - 0.16, raioM, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    online.morroVis.rotation.x = -Math.PI / 2; online.morroVis.position.y = 0.03;
    scene.add(online.morroVis);
  } else if (!morroAtivo && online.morroVis) {
    scene.remove(online.morroVis); online.morroVis = null;
    if ($('mapa')) $('mapa').textContent = 'MAPA: ' + MAPAS[mapaIdx].nome;
  }
  if (morroAtivo && $('mapa')) {
    if (m.kg) {
      const nomeK = online.nomes.get(m.kg[0]) || `JOGADOR ${m.kg[0] + 1}`;
      $('mapa').textContent = `👑 ${nomeK}: ${m.kg[1].toFixed(1)}s / 10s`;
    } else $('mapa').textContent = '👑 dominem o centro!';
  }
  if (online.morroVis) online.morroVis.material.opacity = 0.35 + 0.2 * Math.sin(performance.now() / 200);
  if (m.as != null && mapa && mapa._deck) {
    if (online.arenaEscala != null && m.as < online.arenaEscala - 0.01) {
      avisoOnline('😱 A ARENA ENCOLHEU!'); som.selecionar?.(); trauma = Math.min(1, trauma + 0.2);
    }
    online.arenaEscala = m.as;
    mapa._deck.scale.x += (m.as - mapa._deck.scale.x) * 0.2; // encolhe suave no visual
    mapa._deck.scale.z += (m.as - mapa._deck.scale.z) * 0.2;
  }
  for (const pl of m.pl) {
    let v = online.visuais.get(pl.s);
    if (!v || v.skin !== pl.sk || v.cor !== pl.cr || v.mt !== pl.mt) {
      if (v) { destroyVisual(v.meshes); if (v.anelT) { scene.remove(v.anelT); v.anelT = null; } }
      // online usa .modeloHint (não .modelo): o modelo segue a fantasia escolhida
      // quando o estilo 'j' está ligado, mas o fallback de performance ainda manda.
      const base = SKINS[pl.sk % SKINS.length];
      // 🎨 tinta do jogador (pl.mt = tinta especial da loja com material próprio)
      const ent = pl.mt
        ? { cor: pl.cr, matx: (TINTAS_LOJA.find((t) => t.id === pl.mt) || {}).matx }
        : (pl.cr ?? null);
      const skOn = corSkin({ ...base, modelo: undefined, modeloHint: base.modelo }, ent);
      v = { skin: pl.sk, cor: pl.cr, mt: pl.mt, meshes: buildVisual(skOn, pl.s * 1.9, pl.s) };
      online.visuais.set(pl.s, v);
    }
    garantirNomeSprite(v, pl.s); // plaquinha com o apelido sobre a cabeça
    // TIMES 🔴x🔵: anel colorido no chão marcando o time (slot par/ímpar)
    if (m.tm && !v.anelT) {
      v.anelT = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.42, 32),
        new THREE.MeshBasicMaterial({ color: CORES_TIME[pl.s % 2], transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
      );
      v.anelT.rotation.x = -Math.PI / 2;
      scene.add(v.anelT);
    } else if (!m.tm && v.anelT) { scene.remove(v.anelT); v.anelT = null; }
    if (v.anelT) v.anelT.visible = !!pl.v;
    if (pl.es && Math.random() < 0.35 && v.meshes.torso) { // 🛡️ escudo: bolhas azuis
      const tp = v.meshes.torso.position;
      spawnFx(texBolinha, { x: tp.x, y: tp.y, z: tp.z }, { escala: 0.12, vida: 0.4, cor: 0x6ec8ff, vy: 0.5 });
    }
  }
  for (const [s, v] of online.visuais) {
    if (!m.pl.some((p) => p.s === s)) {
      destroyVisual(v.meshes);
      if (v.anelT) scene.remove(v.anelT);
      online.visuais.delete(s);
    }
  }
  // Armas: cria/remove os meshes conforme o servidor (posições vêm na interpolação)
  if (m.wp) {
    const vistos = new Set();
    for (const w of m.wp) {
      vistos.add(w.id);
      if (!online.armasVis.has(w.id)) {
        const mesh = armaMeshDe(ARMA_TIPOS_CLI[w.ti] || 'bastao');
        scene.add(mesh);
        online.armasVis.set(w.id, { mesh });
      }
    }
    for (const [id, a] of online.armasVis) {
      if (!vistos.has(id)) { scene.remove(a.mesh); online.armasVis.delete(id); }
    }
  }
  // Power-ups: sprites flutuantes (posição fixa, com bob local no frameOnline)
  if (m.pu) {
    const vistosP = new Set();
    for (const pw of m.pu) {
      vistosP.add(pw.id);
      let e = online.powerVis.get(pw.id);
      if (!e) {
        const tipo = POWER_TIPOS_CLI[pw.ti] || 'cura';
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: POWERDEF[tipo].tex, transparent: true, depthWrite: false }));
        s.scale.setScalar(0.62); scene.add(s);
        e = { s, baseY: pw.p[1] }; online.powerVis.set(pw.id, e);
      }
      e.s.position.set(pw.p[0], pw.p[1], pw.p[2]); e.baseY = pw.p[1];
    }
    for (const [id, e] of online.powerVis) if (!vistosP.has(id)) { scene.remove(e.s); online.powerVis.delete(id); }
  }
  // Placar compacto (encolhe quando tem muita gente — até 20) + barra de nocaute
  const tam = m.pl.length > 6 ? 24 : 40;
  $('placar').innerHTML = m.pl.map((pl) => {
    const nm = SKINS[pl.sk % SKINS.length];
    const mortoOp = pl.v ? '' : 'opacity:.35;';
    const ko = Math.round(((pl.d || 0) / 4) * 100); // 0..100% até o nocaute
    const quase = (pl.d || 0) >= 3.5 ? 'box-shadow:0 0 6px rgba(255,60,50,.9);' : '';
    const apelido = online.nomes.get(pl.s) || '';
    const corTime = m.tm ? `border:3px solid ${pl.s % 2 ? '#40a0ff' : '#ff5252'};` : ''; // TIMES: moldura 🔴/🔵
    return `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;${mortoOp}">` +
      `<span style="display:inline-flex;align-items:center;gap:3px"><img class="retrato" style="width:${tam}px;height:${tam}px;margin:0 2px;${corTime}" src="${ASSET(`assets/retratos/${nm.id}.jpg`)}" onerror="this.style.display='none'"><b>${pl.sc}</b></span>` +
      (apelido ? `<span style="font-size:11px;font-weight:700;opacity:.9;max-width:${tam + 26}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apelido}</span>` : '') +
      `<span style="width:${tam + 12}px;height:4px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden;${quase}"><span style="display:block;height:100%;width:${ko}%;background:linear-gradient(90deg,#ffd34a,#ff7a2f);transition:width .1s"></span></span></span>`;
  }).join('');
  // Lobby: mostra modo + quantos na sala + o que o host aperta
  if (touchAtivo() && $('online-acoes')) $('online-acoes').style.display = (m.st === 'lobby' || m.st === 'fim') ? 'flex' : 'none';
  if ($('compartilhar')) $('compartilhar').style.display = (m.st === 'lobby' || m.st === 'fim') ? 'flex' : 'none';
  if (m.st === 'lobby') {
    // LOBBY estilo sala de espera: fileira de retratos de quem tá na sala
    // (⭐ host, 📵 caído esperando reconexão) + votação de arena CLICÁVEL.
    const lista = [...online.nomes.values()];
    let quem = m.cd ? `<br>🔑 código da sala: <b style="letter-spacing:3px;font-size:1.2em">${m.cd}</b> — fala pros amigos entrarem${online.publica ? ' (sala pública)' : ''}` : '';
    if (m.pl && m.pl.length) {
      const hostSlot = Math.min(...m.pl.map((p) => p.s));
      quem += `<br><span style="display:inline-flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:6px 0 2px">` + m.pl.map((pl) => {
        const nm = SKINS[pl.sk % SKINS.length];
        const apelido = online.nomes.get(pl.s) || `J${pl.s + 1}`;
        const off = pl.of ? 'filter:grayscale(1);opacity:.45;' : '';
        const eu = pl.s === online.slot ? 'outline:3px solid #ffd94a;' : '';
        return `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;max-width:64px">` +
          `<img class="retrato" style="width:44px;height:44px;border-radius:10px;${off}${eu}" src="${ASSET(`assets/retratos/${nm.id}.jpg`)}" onerror="this.style.display='none'">` +
          `<span style="font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px">${pl.s === hostSlot ? '⭐' : ''}${pl.of ? '📵' : ''}${apelido}</span></span>`;
      }).join('') + `</span>`;
    }
    quem += lista.length ? `<br>na sala: <b>${lista.slice(0, 8).join('</b> · <b>')}</b>${lista.length > 8 ? ` +${lista.length - 8}` : ''}` : '';
    if (m.rk && m.rk.length) quem += `<br>🏆 placar da noite: ${m.rk.map(([n, v]) => `<b>${n}</b> ${v}`).join(' &nbsp;·&nbsp; ')}`;
    // 🗳️ votação de arena clicável (cada card mostra a contagem ao vivo)
    quem += `<br><span style="display:inline-flex;gap:7px;flex-wrap:wrap;justify-content:center;margin-top:5px">` + ARENAS_CLI.map((nomeA, i) => {
      const votos = (m.vt && m.vt[i]) || 0;
      const meu = online.meuVoto === i;
      return `<button type="button" onclick="window._votarArena(${i})" style="border:0;border-radius:999px;cursor:pointer;padding:7px 13px;font:700 12.5px 'Fredoka',sans-serif;` +
        `color:${meu ? '#08201c' : '#fff'};background:${meu ? 'linear-gradient(180deg,#ffd94a,#ffb52e)' : 'rgba(255,255,255,.12)'};border:1px solid rgba(255,255,255,.22)">` +
        `${nomeA}${votos ? ` · <b>${votos}</b>` : ''}</button>`;
    }).join('') + `</span>`;
    const lobbyHTML = `${m.mo || ''} — <b>${m.na || 0}/${m.cap || 0}</b> na sala &nbsp;·&nbsp; ${m.pt || ''} &nbsp;·&nbsp; arena: <b>${m.an || 'CLÁSSICA'}</b>${m.mr ? ' &nbsp;·&nbsp; 👑 <b>REI DO MORRO</b>' : ''}${m.tm ? ' &nbsp;·&nbsp; 🔴🔵 <b>TIMES</b> (par x ímpar)' : ''}${quem}<br><b>T</b> troca 🤖↔🦖 &nbsp;·&nbsp; <b>B</b> vota arena 🗳️ &nbsp;·&nbsp; <b>1-4</b> provocam 😂 &nbsp;·&nbsp; host: <b>F</b> começa &nbsp;·&nbsp; <b>M</b> modo &nbsp;·&nbsp; <b>N</b> pontuação &nbsp;·&nbsp; <b>H</b> 👑 &nbsp;·&nbsp; <b>Y</b> 🔴🔵`;
    // só re-renderiza quando o conteúdo MUDA — senão o innerHTML a 15Hz engole o clique nos cards de voto
    if (lobbyHTML !== online._lobbyHTML) { online._lobbyHTML = lobbyHTML; showMsg('SALA ONLINE 🌐', lobbyHTML); }
    online.msgAtual = '__lobby__'; online._fimMostrado = false; online._premiado = false; online.faseFinal = null; online.melhorPend = null;
  } else if (m.st === 'fim') {
    if (!online._fimMostrado) {
      online._fimMostrado = true; online.msgAtual = m.msg; online.finalSnap = m;
      if (online.melhorPend && online.melhorPend.frames && online.melhorPend.frames.length > 8) {
        // toca MELHOR JOGADA -> cutscene -> vitória
        online.faseFinal = 'melhor'; online.melhorT = 0; online.melhorClip = online.melhorPend; online.melhorPend = null;
        const nomeAutor = online.melhorClip.sem ? '' : `de ${SKINS[online.melhorClip.autorSk % SKINS.length].nome}`;
        showMsg('<span class="mj-tit">🏆 MELHOR JOGADA</span>', nomeAutor); som.lutem?.();
      } else {
        mostrarVitoriaOnline(m);
      }
    }
  } else {
    online._fimMostrado = false; online.faseFinal = null; online.melhorPend = null; online._lobbyHTML = null; // novo round/partida
    if (m.msg !== online.msgAtual) { online.msgAtual = m.msg; showMsg(m.msg); }
  }
  for (const evn of m.ev) {
    const [tipo, x, y, z] = evn;
    if (tipo === 'hit') {
      const pos = { x, y, z };
      burstEstrelas(pos);
      powFx(pos);
      som.acerto(1 + (evn[5] || 0) * 0.15); // dano da vítima engorda o som
      if (evn[4] != null) som.vozDor(VOZES[evn[4] % VOZES.length]); // timbre de quem apanhou
      trauma = Math.min(1, trauma + 0.5);
    } else if (tipo === 'soco') som.soco();
    else if (tipo === 'pulo') som.pulo();
    else if (tipo === 'esquiva') som.esquiva?.();
    else if (tipo === 'dash') som.arremesso();
    else if (tipo === 'lutem') { som.lutem(); som.musica('luta'); }
    else if (tipo === 'ponto') { som.ponto(); som.torcidaOh(); }
    else if (tipo === 'queda') { som.queda(); if (evn[1] != null) som.vozChoro(VOZES[evn[1] % VOZES.length]); }
    else if (tipo === 'vitoria') { som.vitoria(); som.musica('menu'); }
    else if (tipo === 'bolada') som.bolada();
    else if (tipo === 'power') { const pos = { x: evn[1], y: evn[2], z: evn[3] }; powFx(pos); burstEstrelas(pos); som.ponto?.(); }
    else if (tipo === 'laser') { // [_, fx,fy,fz, ex,ey,ez]
      spawnBeam(evn[1], evn[2], evn[3], evn[4], evn[5], evn[6], 0x37e5ff);
      spawnFlash(evn[1], evn[2], evn[3], 0x37e5ff); som.laser?.();
      trauma = Math.min(1, trauma + 0.3);
    } else if (tipo === 'explosao') { // [_, x,y,z]
      const pos = { x: evn[1], y: evn[2], z: evn[3] };
      powFx(pos); burstEstrelas(pos); puffFx(pos);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spawnFx(puffTex, pos, { escala: 0.5, vida: 0.5, cresce: 2, cor: i % 2 ? 0xff8a3c : 0xffd24a, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: 1.5 }); }
      som.bolada?.(); trauma = 1;
    } else if (tipo === 'grito') { // [_, slot, idx] — provocação: balão de emoji sobre a cabeça
      mostrarGrito(evn[1], evn[2]);
    } else if (tipo === 'escudo') { // [_, x,y,z] — golpe bloqueado pelo escudo
      const pos = { x: evn[1], y: evn[2], z: evn[3] };
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spawnFx(texBolinha, pos, { escala: 0.16, vida: 0.4, cor: 0x8fd8ff, vx: Math.cos(a) * 2.4, vy: 1, vz: Math.sin(a) * 2.4 }); }
      som.esquiva?.();
    }
  }
}

// Balão de provocação (online): emoji grandão preso na cabeça por ~1.8s
const GRITOS = ['😂', '💀', '😱', '❤️'];
const gritosAtivos = [];
function mostrarGrito(slot, idx) {
  const v = online && online.visuais.get(slot);
  if (!v || !v.meshes?.head) return;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '92px system-ui, sans-serif';
  g.fillText(GRITOS[idx] || GRITOS[0], 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  spr.scale.setScalar(0.5); spr.position.set(0, 0.75, 0);
  v.meshes.head.add(spr);
  gritosAtivos.push({ spr, ate: performance.now() / 1000 + 1.8 });
  som.selecionar?.();
}
function updateGritos() {
  const agora = performance.now() / 1000;
  for (let i = gritosAtivos.length - 1; i >= 0; i--) {
    const gr = gritosAtivos[i];
    const resta = gr.ate - agora;
    if (resta <= 0) {
      gr.spr.parent?.remove(gr.spr); gr.spr.material.map?.dispose(); gr.spr.material.dispose();
      gritosAtivos.splice(i, 1);
    } else {
      gr.spr.position.y = 0.75 + Math.sin(agora * 10) * 0.02; // balancinho
      gr.spr.material.opacity = Math.min(1, resta * 3);
    }
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
      // Quaternion sem w: reconstrói (q e -q são a mesma rotação, então w >= 0)
      const x1 = pl1.p[o + 3], y1 = pl1.p[o + 4], z1 = pl1.p[o + 5], w1 = Math.sqrt(Math.max(0, 1 - x1 * x1 - y1 * y1 - z1 * z1));
      const x2 = pl2.p[o + 3], y2 = pl2.p[o + 4], z2 = pl2.p[o + 5], w2 = Math.sqrt(Math.max(0, 1 - x2 * x2 - y2 * y2 - z2 * z2));
      const s2 = (x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2) < 0 ? -1 : 1;
      msh.quaternion.set(lerp(x1 * s2, x2), lerp(y1 * s2, y2), lerp(z1 * s2, z2), lerp(w1 * s2, w2)).normalize();
      o += 6;
    }
    if (v.anelT) v.anelT.position.set(v.meshes.pelvis.position.x, 0.04, v.meshes.pelvis.position.z); // anel do time acompanha
    // Carinha + respiração só existem no estilo gominha; no Jaeger ('j') o esqueleto cuida
    if (v.meshes._face) {
      const piscando = ((agora + pl2.s * 1.9) % 3.4) < 0.13;
      v.meshes._face.material.map = getFaceTexture(THREE, v.meshes._skin.face, pl2.at ? 'x' : (piscando ? 'blink' : 'ok'));
      if (v.meshes.torso._baseY) v.meshes.torso.scale.y = v.meshes.torso._baseY * (1 + 0.028 * Math.sin(agora * 2.6 + pl2.s * 1.9));
    }
  }
  // props: aplica nos corpos locais (parados) e deixa o sync normal desenhar
  m2.pr.forEach((b2, idx) => {
    const b1 = m1.pr[idx] ?? b2;
    const body = mapa.props[idx];
    if (!body) return;
    body.setTranslation({ x: lerp(b1[0], b2[0]), y: lerp(b1[1], b2[1]), z: lerp(b1[2], b2[2]) }, false);
    body.setRotation({ x: b2[3], y: b2[4], z: b2[5], w: b2[6] }, false);
  });
  // armas: interpola o mesh de cada arma pelo id
  if (m2.wp) {
    for (const w2 of m2.wp) {
      const a = online.armasVis.get(w2.id);
      if (!a) continue;
      const w1 = (m1.wp && m1.wp.find((x) => x.id === w2.id)) || w2;
      const p1 = w1.p, p2 = w2.p;
      a.mesh.position.set(lerp(p1[0], p2[0]), lerp(p1[1], p2[1]), lerp(p1[2], p2[2]));
      a.mesh.quaternion.set(p2[3], p2[4], p2[5], p2[6]);
    }
  }
}

function frameOnline(t, fdt) {
  if (online.desconectou) { renderCena(); return; } // caiu a conexão: não roda sequência final
  // Sequência de final: MELHOR JOGADA (clipe) -> cutscene do vencedor -> vitória
  if (online.faseFinal === 'melhor') {
    online.melhorT += fdt;
    const frames = online.melhorClip.frames;
    const idx = Math.floor(online.melhorT * 7); // ~7 frames/s = câmera lenta
    if (idx >= frames.length) { online.faseFinal = 'cutscene'; online.cutT = 0; }
    else aplicarClipeOnline(frames[idx]);
    const [omx, omz] = meioDe(online.visuais.values());
    camCineDirigida(online.melhorT, omx, omz);
    aplicarCine(true);
    for (const v of online.visuais.values()) atualizarSkinMesh(v.meshes);
    updateEfeitos(fdt); mirarHolofotes(t / 1000); cairConfetes(fdt, t / 1000); renderCena();
    return;
  }
  if (online.faseFinal === 'cutscene') {
    online.cutT += fdt;
    camVencedorOnline(t);
    aplicarCine(true);
    for (const v of online.visuais.values()) atualizarSkinMesh(v.meshes);
    updateEfeitos(fdt); mirarHolofotes(t / 1000); cairConfetes(fdt, t / 1000); renderCena();
    if (online.cutT > 3.0) { online.faseFinal = null; if (online.finalSnap) mostrarVitoriaOnline(online.finalSnap); confete(); }
    return;
  }
  aplicarCine(false); // fora da sequência final: lente e tela normais
  // Fallback de performance: se o FPS ficar baixo com muitos Jaeger, cai pra gominha
  if (online.jaeger && !online.forcarGominha && !PARAMS.has('semfallback')) {
    online._fN = (online._fN || 0) + 1;
    if (!online._fT) online._fT = t;
    const dt = t - online._fT;
    if (dt >= 2000) {
      const fps = online._fN / (dt / 1000);
      online._fN = 0; online._fT = t;
      if (fps < 32 && online.visuais.size >= 8) {
        if ((online._baixo = (online._baixo || 0) + 1) >= 2) { // 2 janelas ruins seguidas
          online.forcarGominha = true;
          aplicarEstiloOnline();
          avisoOnline('⚡ Modo leve ativado (pra manter fluido com muita gente)');
        }
      } else online._baixo = 0;
    }
  }
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
  for (const e of online.powerVis.values()) e.s.position.y = e.baseY + Math.sin(t * 0.003) * 0.12; // bob dos power-ups
  for (const v of online.visuais.values()) atualizarSkinMesh(v.meshes); // esqueleto Jaeger/Kaiju online
  // marcador "VOCÊ" flutua sobre o seu boneco
  if (online.marcador) {
    const meu = online.slot != null ? online.visuais.get(online.slot) : null;
    if (meu && meu.meshes.head) {
      const h = meu.meshes.head.position;
      online.marcador.position.set(h.x, h.y + 0.7 + Math.sin(t * 0.005) * 0.05, h.z);
      online.marcador.visible = true;
    } else online.marcador.visible = false;
  }
  for (const [body, mesh] of mapa.syncPairs) {
    const tp = body.translation();
    const rp = body.rotation();
    mesh.position.set(tp.x, tp.y, tp.z);
    mesh.quaternion.set(rp.x, rp.y, rp.z, rp.w);
  }
  mapa.update?.(t / 1000);
  updateEfeitos(fdt);
  updateGritos();
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
  const shake = trauma * trauma * 0.26 * (AJUSTES.shake || 1);
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
const _v3cam = new THREE.Vector3(); // rascunho da câmera de replay

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

  // MELHOR JOGADA: toca o clipe de maior nota da partida, em câmera lenta e cinematográfica
  if (state === 'melhor') {
    replayT += fdt * 0.35;
    const idx = Math.floor(replayT * 60);
    if (idx >= melhorClip.frames.length) {
      if (gravandoClip) { // fim da regravação: para, baixa e volta pra tela de vitória
        gravandoClip = false;
        gravacao?.stop(); gravacao = null;
        state = 'fim';
        mostrarVitoria(finalWinner);
      } else iniciarCutscene();
    }
    else { aplicarClipe(melhorClip.frames, idx); }
    const [mmx, mmz] = meioDe(lutadores);
    camCineDirigida(replayT, mmx, mmz);
    aplicarCine(true);
    updateEfeitos(fdt); mirarHolofotes(simNow); cairConfetes(fdt, simNow); atualizarSkins(); renderCena();
    return;
  }

  // Cutscene do vencedor: física leve pra ele ficar em pé, câmera orbitando + confete
  if (state === 'cutscene') {
    cutT += fdt;
    acc += fdt;
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT; simNow += FIXED_DT;
      for (const l of lutadores) l.rag.update(FIXED_DT, simNow, IDLE_IN);
      world.step();
    }
    for (const l of lutadores) syncVisual(l.rag, l.meshes, simNow);
    camVencedor(t);
    aplicarCine(true);
    updateEfeitos(fdt); mirarHolofotes(simNow); cairConfetes(fdt, simNow); atualizarSkins(); renderCena();
    if (cutT > 3.6) { state = 'fim'; mostrarVitoria(finalWinner); confete(); }
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
        if (l.cfg.tipo !== 'cpu') detectarDash(l, inp, simNow);
        detectarEsquiva(l, inp, simNow); // humanos e bots podem esquivar
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
    // Bomba 💣: acende o pavio ao ser pega; explode quando o tempo acaba (batata quente)
    if (arma.bomba) {
      const segurada = lutadores.some((l) => l.rag.grabJoints.some((g) => g && g.body === arma.body));
      if (arma.explodeEm === null && segurada) { arma.explodeEm = simNow + arma.fuse; som.selecionar?.(); }
      if (arma.explodeEm !== null) {
        const rest = arma.explodeEm - simNow;
        const fa = arma.mesh.getObjectByName && arma.mesh.getObjectByName('faisca');
        if (fa) fa.scale.setScalar(0.6 + Math.abs(Math.sin(simNow * (12 - rest * 2))) * 1.1); // faísca acelera
        if (rest <= 0) { explodirBomba(mapa, arma); continue; }
      }
    }
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
        const dono = lutadores.find((x) => x.rag.grabJoints.some((g) => g && g.body === arma.body));
        if (dono) { l.rag._agr = dono.rag; l.rag._agrAt = simNow; } // autor da arma branca
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
      const tipos = ['bastao', 'cano', 'laser', 'martelo', 'bomba', 'bastao', 'cano', 'martelo', 'bomba'];
      const b = soltarArma(mapa, ax, az, tipos[(Math.random() * tipos.length) | 0]);
      b.setTranslation({ x: ax, y: 4.2, z: az }, true);
      puffFx({ x: ax, y: 4.2, z: az });
      // Diretor de ritmo: luta morna (ninguém acerta há um tempo) → próxima arma
      // cai bem mais cedo pra apimentar; pancadaria comendo → segura um pouco.
      const desdeAcao = simNow - Math.max(0, ...lutadores.map((l) => l.rag.lastHitLandedAt || 0));
      const ritmo = desdeAcao > 7 ? 0.45 : desdeAcao < 2 ? 1.25 : 1;
      proxArmaEm = simNow + (atrasoArma + Math.random() * (MODO_CAOS ? 2 : 5)) * ritmo;
    }
    // Drop de power-up (cura ❤️ / velocidade ⚡ / força 💪), no máx. 2 na arena
    if (proxPowerEm === 0) proxPowerEm = simNow + (MODO_CAOS ? 5 : 8);
    if (simNow > proxPowerEm && powerups.length < 2) {
      const tipos = Object.keys(POWERDEF);
      // diretor: se alguém está muito machucado, o drop tende a ser cura (dá chance de virada)
      const machucado = lutadores.some((l) => l.vivo && l.rag.dano > 2.5);
      const tipoPw = machucado && Math.random() < 0.6 ? 'cura' : tipos[(Math.random() * tipos.length) | 0];
      const px = (Math.random() * 2 - 1) * 2.2, pz = (Math.random() * 2 - 1) * 1.6;
      spawnPower(tipoPw, px, pz);
      puffFx({ x: px, y: 1.4, z: pz });
      proxPowerEm = simNow + (MODO_CAOS ? 7 : 12) + Math.random() * 6;
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
  // 🪝 GANCHO: soco com ele na mão arpoa o rival mais próximo à frente e o PUXA
  for (const l of lutadores) {
    const g = mapa.armas && mapa.armas.find((a) => a.puxa && l.rag.grabJoints.some((gj) => gj && gj.body === a.body));
    if (!g) continue;
    if (l.rag.lastPunchStartAt > (l._ganchoVisto ?? -1)) {
      l._ganchoVisto = l.rag.lastPunchStartAt;
      if (simNow < (l._ganchoCd ?? 0)) continue;
      l._ganchoCd = simNow + g.cadencia;
      const me = l.rag.parts.torso.translation();
      const dx = Math.sin(l.rag.heading), dz = Math.cos(l.rag.heading);
      let alvo = null, bd = g.alcancePuxa;
      for (const o of rivaisDe(l, true)) {
        const q = o.rag.parts.torso.translation();
        const vx = q.x - me.x, vz = q.z - me.z, d = Math.hypot(vx, vz);
        if (d < bd && d > 0.4 && (vx * dx + vz * dz) / (d || 1) > 0.45) { bd = d; alvo = o; }
      }
      som.arremesso();
      if (alvo) {
        const q = alvo.rag.parts.torso.translation();
        const vx = me.x - q.x, vz = me.z - q.z, d = Math.hypot(vx, vz) || 1;
        for (const pn of ['torso', 'pelvis']) alvo.rag.parts[pn].applyImpulse({ x: (vx / d) * 6.5, y: 1.5, z: (vz / d) * 6.5 }, true);
        alvo.rag.stun(simNow + 0.7);
        alvo.rag._agr = l.rag; alvo.rag._agrAt = simNow; // autor (pra melhor jogada)
        for (let i = 1; i <= 6; i++) { // corrente visual rapidinha
          const k = i / 7;
          trailFx({ x: me.x + (q.x - me.x) * k, y: me.y + (q.y - me.y) * k + 0.1, z: me.z + (q.z - me.z) * k }, 0xffe08a);
        }
        som.agarra(); trauma = Math.min(1, trauma + 0.3);
      }
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
        // 💧 mergulhou: três anéis anime em sequência
        ondaAgua(py.x, py.z, mapa.aguaY, 1.5);
        ondaAgua(py.x, py.z, mapa.aguaY, 1.1, 0.14);
        ondaAgua(py.x, py.z, mapa.aguaY, 0.8, 0.3);
        som.queda?.(); trauma = Math.min(1, trauma + 0.3);
      }
      // nadando perto da superfície: mini-ondulações periódicas
      if (l._naAgua && py.y > mapa.aguaY - 1.6 && simNow > (l._ondaCd ?? 0)) {
        l._ondaCd = simNow + 0.3;
        ondaAgua(py.x, py.z, mapa.aguaY, 0.55);
      }
    }
  }

  // Efeitos + sons por lutador
  for (const l of lutadores) {
    const p = l.rag;
    if (l._anelTime) { // anel do time acompanha o lutador (some quando ele cai)
      const pt = p.parts.pelvis.translation();
      l._anelTime.position.set(pt.x, 0.04, pt.z);
      l._anelTime.visible = l.vivo && pt.y > -1.5;
    }
    // 🧭 Manômetro do SOCÃO: pressão subindo sobre a cabeça enquanto carrega
    // (vale pros bots também — dá pra ver o pancadão vindo e esquivar!)
    if ((p._carga || 0) > 0.03 && l.vivo) {
      if (!l._gauge) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 128;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        spr.scale.setScalar(0.5);
        scene.add(spr);
        l._gauge = { cv, tex, spr, ult: -1 };
      }
      const g = l._gauge;
      if (Math.abs(p._carga - g.ult) > 0.008) { g.ult = p._carga; desenharGauge(g.cv, p._carga); g.tex.needsUpdate = true; }
      const hp = p.parts.head.translation();
      g.spr.position.set(hp.x, hp.y + 0.55, hp.z);
      g.spr.visible = true;
      g.spr.scale.setScalar(p._carga >= 1 ? 0.5 + Math.sin(simNow * 18) * 0.05 : 0.5); // cheio: treme
    } else if (l._gauge && l._gauge.spr.visible) {
      l._gauge.spr.visible = false;
      l._gauge.ult = -1;
    }
    if (p.lastHitLandedAt > 0 && p.lastHitLandedAt > (p._fxVisto ?? -1)) {
      p._fxVisto = p.lastHitLandedAt;
      const pos = p.parts.head.translation();
      burstEstrelas(pos);
      powFx(pos);
      som.acerto(1 + p.dano * 0.15); // vítima grogue = pancada soa maior
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
      if (state === 'luta') considerarHighlight(l, 'ko', false); // candidato a melhor jogada
    }
    if (p.lastPunchStartAt > (p._sSoco ?? -1)) {
      p._sSoco = p.lastPunchStartAt;
      if ((p._cargaGolpe || 0) > 0.5) { // SOCÃO: baque pesado + 💨 speed lines
        som.bolada(); trauma = Math.min(1, trauma + 0.35);
        const hp = p.parts.torso.translation();
        const dx = Math.sin(p.heading), dz = Math.cos(p.heading);
        for (let i = 0; i < 10; i++) {
          const esp = (Math.random() - 0.5) * 1.6;
          spawnFx(starTex, { x: hp.x + dx * 0.4, y: hp.y + (Math.random() - 0.5) * 0.5, z: hp.z + dz * 0.4 }, {
            escala: 0.15, vida: 0.24, cor: 0xffffff, giro: 2,
            vx: dx * (6 + Math.random() * 4) - dz * esp, vy: (Math.random() - 0.5), vz: dz * (6 + Math.random() * 4) + dx * esp,
          });
        }
      } else som.soco();
      som.vozSoco(VOZES[l.slot]);
    }
    // 🛡️ escudo ativo: bolhas azuis orbitando o tronco; estouro azul quando bloqueia
    if (p.escudo > 0 && simNow > (l._escFxAt ?? 0)) {
      l._escFxAt = simNow + 0.14;
      const tp = p.parts.torso.translation();
      spawnFx(texBolinha, tp, { escala: 0.12, vida: 0.4, cor: 0x6ec8ff, dx: Math.sin(simNow * 4) * 0.3, dz: Math.cos(simNow * 4) * 0.3, vy: 0.5 });
    }
    if (p.lastEscudoAt > (p._sEsc ?? -1)) {
      p._sEsc = p.lastEscudoAt;
      const tp = p.parts.torso.translation();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spawnFx(texBolinha, tp, { escala: 0.16, vida: 0.4, cor: 0x8fd8ff, vx: Math.cos(a) * 2.4, vy: 1, vz: Math.sin(a) * 2.4 }); }
      som.esquiva?.(); trauma = Math.min(1, trauma + 0.2);
    }
    // SOCÃO carregando: faíscas douradas crescendo nos punhos
    if ((p._carga || 0) > 0.15 && simNow > (l._cargaFxAt ?? 0)) {
      l._cargaFxAt = simNow + 0.09;
      for (const h of ['forearmL', 'forearmR']) {
        const fp = p.parts[h].translation();
        spawnFx(starTex, fp, {
          escala: 0.08 + p._carga * 0.16, vida: 0.3, giro: 8, cor: p._carga >= 1 ? 0xff5c3c : 0xffd94a,
          vx: (Math.random() - 0.5) * 1.2, vy: 0.8 + p._carga, vz: (Math.random() - 0.5) * 1.2,
        });
      }
      if (p._carga >= 1 && !l._cargaCheiaAvisada) { l._cargaCheiaAvisada = true; som.selecionar?.(); }
      if (p._carga < 1) l._cargaCheiaAvisada = false;
    }
    if (p.lastCabecadaAt > (p._sCab ?? -1)) { p._sCab = p.lastCabecadaAt; som.soco(); som.vozSoco(VOZES[l.slot]); trauma = Math.min(1, trauma + 0.4); hitStop = Math.max(hitStop, 0.06); }
    if (p.lastChuteAt > (p._sChu ?? -1)) { p._sChu = p.lastChuteAt; som.soco(); }
    if (p.lastJumpAt > (p._sPulo ?? -1)) { p._sPulo = p.lastJumpAt; som.pulo(); puffFx(p.parts.pelvis.translation()); }
    // Rastro de movimento no dash (dourado) e na esquiva (ciano) — pontilhado ao longo do caminho
    const emDash = simNow - p.lastDashAt < 0.28;
    const emEsq = p.isEsquivando(simNow);
    if (emDash || emEsq) {
      const tp = p.parts.torso.translation();
      const lt = p._trailPos;
      if (!lt || Math.hypot(tp.x - lt.x, tp.y - lt.y, tp.z - lt.z) > 0.16) {
        trailFx(tp, emEsq ? 0x66e0ff : 0xffe08a);
        p._trailPos = { x: tp.x, y: tp.y, z: tp.z };
      }
      if (emDash) { // 🔥 labaredas subindo atrás da investida
        spawnFx(texBolinha, { x: tp.x, y: tp.y - 0.15, z: tp.z }, {
          escala: 0.15, vida: 0.3, cor: [0xff7a2f, 0xffd94a, 0xff4020][(Math.random() * 3) | 0],
          vx: (Math.random() - 0.5) * 1.4, vy: 1.6 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.4,
        });
      }
    } else if (p._trailPos) { p._trailPos = null; }
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
  updatePowerups(fdt, simNow);
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
  if (state === 'selecao') {
    // Palco da seleção: câmera de frente, parada, com um balanço bem leve —
    // os lutadores de enfeite ficam enquadrados acima dos cards.
    const sw = Math.sin(t * 0.0004);
    camera.position.set(sw * 0.45, 1.85, 4.3);
    camera.lookAt(0, 1.0, 0);
  } else if (state === 'titulo') {
    // Atrás do título (opaco) a câmera segue orbitando — evita pulo ao entrar
    const ang = t * 0.00020;
    const cx = midX * 0.6;
    camera.position.set(cx + Math.sin(ang) * 4.6, 2.05, Math.cos(ang) * 4.6 + 0.3);
    camera.lookAt(cx, 1.2, 0);
  } else if (PARAMS.has('zoom')) {
    camPos.set(midX * 0.6, 1.9, 3.6);
    camera.position.copy(camPos);
    camera.lookAt(midX * 0.6, 1.05, 0);
  } else if (!online && (state === 'replay' || state === 'melhor')) {
    // CÂMERA DIRIGIDA no replay: órbita lenta na altura do ombro + dolly-in
    camCineDirigida(replayT, midX, midZ, spread);
  } else {
    const target = new THREE.Vector3(midX * 0.6, 3.9 + spread * 0.3, 6.6 + spread * 0.55);
    camPos.lerp(target, 0.05);
    camera.position.copy(camPos);
    camera.lookAt(midX * 0.6, 0.8, midZ * 0.3);
  }
  aplicarCine(!online && (state === 'replay' || state === 'melhor'));
  const shake = trauma * trauma * 0.26 * (AJUSTES.shake || 1);
  camera.position.x += Math.sin(t * 0.061) * shake;
  camera.position.y += Math.cos(t * 0.047) * shake * 0.7;

  updateHudBarras(simNow);
  if (tut) tutFrame(fdt);
  atualizarSkins();
  renderCena();
}

// ---------- Início ----------
setMapa(parseInt(PARAMS.get('mapa'), 10) || 0);
initTouch();
// Editor ao vivo (tecla ` abre): ajusta câmera, luz, brilho e força em tempo real
initEditor({ camera, r3, scene, sun, hemi, rim, bloomPass });
// Botões da tela de título (JOGAR / ONLINE / COMO JOGAR)
// Rodapé do título no celular fala de toque (não de ENTER/teclado)
if (touchAtivo()) {
  const rd = document.querySelector('.tit-rodape');
  if (rd) rd.textContent = 'toque em JOGAR pra brigar já · online até 20 jogadores';
}
// No celular o menu completo é por teclado, então JOGAR vira luta rápida vs bot
$('tit-jogar')?.addEventListener('click', () => {
  if (touchAtivo()) { lutaRapidaTouch(); som.confirmar(); return; }
  mostrarSelecao(); som.confirmar();
});
$('tit-online')?.addEventListener('click', () => { $('titulo').style.display = 'none'; if (!online) iniciarOnline(); });
$('tit-ajuda')?.addEventListener('click', () => { $('ajuda').style.display = 'flex'; som.selecionar(); });
$('tit-tutorial')?.addEventListener('click', () => { iniciarTutorial(); som.confirmar(); });
$('tit-torneio')?.addEventListener('click', () => { mostrarSetupTorneio(); som.selecionar(); });
// nunca fez o tutorial? o botão pulsa chamando atenção
if (!localStorage.getItem('wobblers_tut')) $('tit-tutorial')?.classList.add('pulsa');
$('ajuda-fechar')?.addEventListener('click', () => { $('ajuda').style.display = 'none'; });
// ---------- Loja 🛒 (UI) ----------
function montarLoja() {
  const ct = $('loja-tintas');
  if (!ct) return;
  ct.innerHTML = TINTAS_LOJA.map((t) => {
    const tenho = loja.tintas.includes(t.id);
    const brilho = t.matx.emissivoK > 0.3 ? `,0 0 18px ${cssCor(t.cor)}` : '';
    return `<div class="lj-card${tenho ? ' tenho' : ''}">`
      + `<div class="lj-swatch" style="background:radial-gradient(circle at 30% 30%, rgba(255,255,255,.5), transparent 45%), ${cssCor(t.cor)};box-shadow:inset 0 -6px 12px rgba(0,0,0,.35)${brilho}"></div>`
      + `<div class="lj-nome">${t.nome}</div>`
      + `<button class="lj-btn" data-tinta="${t.id}" ${tenho ? 'disabled' : ''}>${tenho ? 'TENHO ✔' : `${t.preco} 🪙`}</button></div>`;
  }).join('');
  atualizarSaldoLoja();
  $('loja').querySelectorAll('.lj-btn:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    const preco = TINTAS_LOJA.find((t) => t.id === b.dataset.tinta).preco;
    if (loja.moedas < preco) { avisoMoedas(`faltam ${preco - loja.moedas} 🪙 — ganhe jogando!`); som.queda?.(); return; }
    loja.moedas -= preco;
    loja.tintas.push(b.dataset.tinta);
    salvarLoja();
    aplicarComprasLoja(); // tinta entra na paleta na hora
    atualizarSelecao();
    som.confirmar();
    montarLoja(); // re-renderiza com o item marcado como TENHO ✔
  }));
}
$('tit-loja')?.addEventListener('click', () => { montarLoja(); $('loja').style.display = 'flex'; som.selecionar(); });
$('loja-fechar')?.addEventListener('click', () => { $('loja').style.display = 'none'; });
atualizarSaldoLoja();
// ---------- Carreira 📊 (UI) ----------
function montarCarreira() {
  const st = $('car-stats'), cq = $('car-conq');
  if (!st || !cq) return;
  const linhas = [
    [carreira.vitorias, 'vitórias'], [carreira.partidas, 'partidas'], [carreira.rounds, 'rounds'],
    [carreira.acertos, 'socos na cara'], [carreira.quedas, 'tombos'], [carreira.pendurado + 's', 'pendurado'],
  ];
  st.innerHTML = linhas.map(([v, n]) => `<div class="car-num"><b>${v}</b><span>${n}</span></div>`).join('');
  cq.innerHTML = CONQUISTAS.map((q) => {
    const tenho = carreira.conq.includes(q.id);
    return `<div class="car-q${tenho ? ' tenho' : ''}"><span class="cq-ico">${tenho ? '🏅' : '🔒'}</span>`
      + `<div><b>${q.nome}</b><br><small>${q.desc}</small></div>`
      + `<span class="cq-premio">${tenho ? '✔' : `+${q.premio} 🪙`}</span></div>`;
  }).join('');
}
$('tit-carreira')?.addEventListener('click', () => { montarCarreira(); $('carreira').style.display = 'flex'; som.selecionar(); });
$('carreira-fechar')?.addEventListener('click', () => { $('carreira').style.display = 'none'; });
addEventListener('keydown', (e) => {
  if ($('loja') && $('loja').style.display === 'flex') { // loja aberta: só o ESC interessa
    if (e.code === 'Escape') $('loja').style.display = 'none';
    return;
  }
  if ($('carreira') && $('carreira').style.display === 'flex') {
    if (e.code === 'Escape') $('carreira').style.display = 'none';
    return;
  }
  if ($('ajuda').style.display === 'flex') { // ajuda aberta: só o ESC interessa
    if (e.code === 'Escape') $('ajuda').style.display = 'none';
    return;
  }
  if (state !== 'titulo') return;
  if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF') { mostrarSelecao(); som.confirmar(); }
});
// Celular: JOGAR no título cai direto numa luta rápida contra um bot
// ---------- TORNEIO 🏆 (mata-mata local, 4-8 jogadores revezando o teclado) ----------
// Estrutura: jog[] (nome+skin), rounds[][] de {a,b,w} com índices em jog (null = bye).
// Cada luta é 1v1 no MESMO teclado (vermelho WASD+F × azul setas+K). Final = melhor de 3.
let torneio = null;
function iniciarTorneio(n) {
  const jog = [];
  for (let i = 0; i < n; i++) {
    const skin = (i * 3 + 1) % SKINS.length;
    jog.push({ nome: `J${i + 1} · ${SKINS[skin].nome}`, skin });
  }
  // embaralha o chaveamento e completa com byes até a potência de 2
  const ordem = jog.map((_, i) => i).sort(() => Math.random() - 0.5);
  let tam = 4; while (tam < n) tam *= 2;
  while (ordem.length < tam) ordem.push(null);
  const rounds = [];
  let atual = [];
  for (let i = 0; i < ordem.length; i += 2) atual.push({ a: ordem[i], b: ordem[i + 1], w: null });
  rounds.push(atual);
  for (let t = tam / 2; t >= 2; t /= 2) {
    atual = [];
    for (let i = 0; i < t / 2; i++) atual.push({ a: null, b: null, w: null });
    rounds.push(atual);
  }
  torneio = { jog, rounds, campeao: null };
  window._torneio = torneio; // teste automatizado espia aqui
  torneioResolverByes();
  mostrarChave();
}
// bye (b=null): quem tem adversário fantasma avança sozinho
function torneioResolverByes() {
  const R = torneio.rounds;
  for (let r = 0; r < R.length; r++) {
    for (let m = 0; m < R[r].length; m++) {
      const M = R[r][m];
      // bye SÓ existe na 1ª rodada — nas seguintes, null = "aguardando a luta de baixo"
      if (r === 0 && M.w == null && M.a != null && M.b == null) M.w = M.a;
      if (r === 0 && M.w == null && M.a == null && M.b != null) M.w = M.b;
      if (M.w != null && r + 1 < R.length) {
        const prox = R[r + 1][Math.floor(m / 2)];
        if (m % 2 === 0) prox.a = M.w; else prox.b = M.w;
      }
    }
  }
  const final = R[R.length - 1][0];
  if (final.w != null) torneio.campeao = final.w;
}
// próxima luta pendente (os dois lados definidos e sem vencedor)
function torneioProxima() {
  const R = torneio.rounds;
  for (let r = 0; r < R.length; r++) {
    for (let m = 0; m < R[r].length; m++) {
      const M = R[r][m];
      if (M.w == null && M.a != null && M.b != null) return { r, m, M };
    }
  }
  return null;
}
function mostrarChave() {
  const el = $('chave');
  if (!el) return;
  $('titulo').style.display = 'none';
  showMsg(''); // some a tela de vitória da luta anterior
  document.body.classList.add('menu');
  const R = torneio.rounds;
  const prox = torneioProxima();
  const nomeDe = (i) => (i == null ? '—' : torneio.jog[i].nome);
  const rotulos = { 1: 'FINAL', 2: 'SEMIS', 4: 'QUARTAS' };
  const cols = R.map((rd, r) => {
    const caixas = rd.map((M, m) => {
      const ativa = prox && prox.r === r && prox.m === m;
      const linha = (i, venceu) => `<div class="ch-nome${venceu ? ' ch-venceu' : ''}${i == null ? ' ch-vazio' : ''}">${nomeDe(i)}</div>`;
      return `<div class="ch-luta${ativa ? ' ch-ativa' : ''}">${linha(M.a, M.w != null && M.w === M.a)}${linha(M.b, M.w != null && M.w === M.b)}</div>`;
    }).join('');
    return `<div class="ch-col"><div class="ch-rot">${rotulos[rd.length] || `RODADA ${r + 1}`}</div>${caixas}</div>`;
  }).join('');
  const rodape = torneio.campeao != null
    ? `<div class="ch-campeao">🏆 CAMPEÃO: <b>${nomeDe(torneio.campeao)}</b>!</div><div class="ch-dica">F volta pro título</div>`
    : `<div class="ch-prox">PRÓXIMA LUTA: <b>${nomeDe(prox.M.a)}</b> 🔴 × 🔵 <b>${nomeDe(prox.M.b)}</b>${R[R.length - 1][0] === prox.M ? ' — FINAL, melhor de 3!' : ''}</div>`
      + '<div class="ch-dica">🔴 WASD + F soco &nbsp;·&nbsp; 🔵 setas + K soco &nbsp;·&nbsp; <b>F</b> começa &nbsp;·&nbsp; ESC abandona</div>';
  el.innerHTML = `<div class="ch-card"><div class="ch-tit">🏆 TORNEIO</div><div class="ch-grade">${cols}</div>${rodape}</div>`;
  el.style.display = 'flex';
  som.selecionar?.();
}
function torneioConfirma() {
  if (torneio.campeao != null) { torneioCancelar(); return; } // F na tela de campeão: sai
  const prox = torneioProxima();
  if (!prox) return;
  torneio.atual = prox;
  $('chave').style.display = 'none';
  document.body.classList.remove('menu');
  const ehFinal = torneio.rounds[torneio.rounds.length - 1][0] === prox.M;
  WIN_SCORE = ehFinal ? 2 : 1; // final: melhor de 3
  MODO_CAOS = false; MODO_MORRO = false; MODO_TIMES = false;
  if (morroVis) { scene.remove(morroVis); morroVis = null; }
  setMapa(Math.floor(Math.random() * MAPAS.length)); // arena sorteada por luta
  montarLutadores([
    { ...selCfg[0], tipo: 'kb1', skin: torneio.jog[prox.M.a].skin, _tid: prox.M.a },
    { ...selCfg[1], tipo: 'kb2', skin: torneio.jog[prox.M.b].skin, _tid: prox.M.b },
  ]);
  mapa.reset?.(true);
  updateScore();
  som.musica(MAPAS[mapaIdx].trilha || 'luta');
  startIntro(1);
  som.confirmar?.();
}
function torneioRegistrarVencedor(l) {
  if (!torneio?.atual || l.cfg._tid == null) return;
  torneio.atual.M.w = l.cfg._tid;
  torneio.atual = null;
  torneioResolverByes();
  if (torneio.campeao != null) ganharMoedas(40); // 🏆 prêmio único do torneio
}
function torneioCancelar() {
  torneio = null;
  $('chave').style.display = 'none';
  mostrarTitulo();
}
// Tela de entrada: quantos jogadores? (4/6/8 — clique ou tecla do número)
function mostrarSetupTorneio() {
  const el = $('chave');
  if (!el) return;
  $('titulo').style.display = 'none';
  document.body.classList.add('menu');
  el.innerHTML = `<div class="ch-card"><div class="ch-tit">🏆 TORNEIO</div>
    <div class="ch-prox">Quantos jogadores revezando o teclado?</div>
    <div class="ch-ns">${[4, 6, 8].map((n) => `<button class="tit-btn" data-n="${n}" type="button">${n}</button>`).join('')}</div>
    <div class="ch-dica">mata-mata 1×1 · 🔴 WASD+F × 🔵 setas+K · aperte o número · ESC volta</div></div>`;
  el.style.display = 'flex';
  el.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { iniciarTorneio(parseInt(b.dataset.n, 10)); som.confirmar?.(); }));
}
addEventListener('keydown', (e) => {
  const chaveAberta = $('chave') && $('chave').style.display !== 'none';
  if (!torneio) {
    if (!chaveAberta) return; // tela de setup
    if (e.code === 'Escape') { $('chave').style.display = 'none'; mostrarTitulo(); }
    else if (e.code === 'Digit4') iniciarTorneio(4);
    else if (e.code === 'Digit6') iniciarTorneio(6);
    else if (e.code === 'Digit8') iniciarTorneio(8);
    return;
  }
  if (chaveAberta) {
    if (e.code === 'KeyF') torneioConfirma();
    else if (e.code === 'Escape') torneioCancelar();
  } else if (state === 'fim' && (e.code === 'KeyF' || e.code === 'KeyR')) {
    mostrarChave(); // volta pra árvore do torneio (o vencedor já foi registrado)
  }
});

// ---------- Tutorial 🎓 (DOJO vs manequim; passos com detecção de verdade) ----------
let tut = null;
const TUT_TEXTOS = [
  ['🚶', 'ANDE pelo dojo', 'W A S D (ou analógico)'],
  ['🥊', 'Dê 3 SOCOS', 'aperte F'],
  ['🤲', 'AGARRE por 1 segundo', 'segure G'],
  ['💨', 'DASH de ombro', '2 toques rápidos numa direção'],
  ['🏁', 'DERRUBE o manequim do ringue!', 'soco + empurrão pra fora'],
];
function iniciarTutorial() {
  $('titulo').style.display = 'none';
  $('selecao').style.display = 'none';
  document.body.classList.remove('menu');
  setMapa(19); // DOJO — o mapa de treino
  WIN_SCORE = 1; MODO_CAOS = false; MODO_MORRO = false; MODO_TIMES = false;
  if (morroVis) { scene.remove(morroVis); morroVis = null; }
  const configs = [{ ...selCfg[0], tipo: 'kb1' }, { tipo: 'cpu', skin: selCfg[1].skin, manequim: true }];
  montarLutadores(configs);
  mapa.reset?.(true);
  updateScore();
  som.musica(MAPAS[mapaIdx].trilha || 'luta');
  startIntro(1);
  tut = { passo: 0, andou: 0, socos: 0, agarrou: 0, prevSoco: false };
  window._tut = tut; // teste automatizado espia os contadores aqui
  tutMostrar();
}
function tutMostrar() {
  const el = $('tut');
  if (!el) return;
  const [ico, tit, como] = TUT_TEXTOS[tut.passo];
  el.style.display = 'block';
  el.innerHTML = `<div class="tut-passo">TUTORIAL &nbsp;${tut.passo + 1}/${TUT_TEXTOS.length}</div>`
    + `<div class="tut-txt">${ico} <b>${tit}</b></div><div class="tut-como">${como}</div>`;
}
function tutAvancar() {
  tut.passo++;
  som.confirmar?.();
  tutMostrar();
}
function tutConcluir() {
  const primeira = !localStorage.getItem('wobblers_tut');
  if (primeira) { localStorage.setItem('wobblers_tut', '1'); ganharMoedas(50); }
  const el = $('tut');
  if (el) {
    el.innerHTML = `<div class="tut-txt">🎉 <b>TUTORIAL COMPLETO!</b>${primeira ? ' +50 🪙' : ''}</div>`
      + '<div class="tut-como">agora vai pra briga de verdade — R volta pro menu</div>';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  }
  $('tit-tutorial')?.classList.remove('pulsa');
  tut = null;
}
function tutFrame(fdt) {
  if (!tut) return;
  if (state === 'selecao' || state === 'titulo') { tut = null; const el = $('tut'); if (el) el.style.display = 'none'; return; }
  // Último passo fecha quando o round termina (qualquer sequência de fim)
  if (tut.passo === 4 && state !== 'luta' && state !== 'intro') { tutConcluir(); return; }
  // Caiu do ringue (ou derrubou o manequim cedo demais) antes do passo final:
  // a morte súbita fecharia a partida e encalharia o treino — recomeça o round
  // mantendo o passo em que a pessoa estava.
  if (tut.passo < 4 && ['replay', 'melhor', 'ponto', 'cutscene', 'fim'].includes(state)) {
    const { passo, andou, agarrou } = tut;
    iniciarTutorial();
    Object.assign(tut, { passo, andou, agarrou });
    tutMostrar();
    return;
  }
  if (state !== 'luta' || !lutadores[0]) return;
  const inp = inputDoLutador(lutadores[0]); // stateless: teclado+controle+toque
  if (tut.passo === 0) {
    if (Math.hypot(inp.move.x, inp.move.z) > 0.4) tut.andou += fdt;
    if (tut.andou > 1.1) tutAvancar();
  } else if (tut.passo === 1) {
    // conta pelos SOCOS DADOS (stats do ragdoll) — tecla amostrada perde toque
    // rápido em fps baixo; o stat conta exatamente o que o jogo executou
    const dados = lutadores[0].rag.stats?.socos ?? 0;
    tut._socos0 ??= dados;
    if (dados - tut._socos0 >= 3) tutAvancar();
  } else if (tut.passo === 2) {
    if (inp.grab) tut.agarrou += fdt;
    if (tut.agarrou > 0.9) tutAvancar();
  } else if (tut.passo === 3) {
    if (simNow - (lutadores[0].rag.lastDashAt ?? -9) < 0.3) tutAvancar();
  }
}

function lutaRapidaTouch() {
  $('titulo').style.display = 'none';
  $('selecao').style.display = 'none';
  document.body.classList.remove('menu');
  const configs = [{ ...selCfg[0], tipo: 'kb1' }, { tipo: 'cpu', skin: selCfg[1].skin }];
  montarLutadores(configs);
  mapa.reset?.(true);
  updateScore();
  som.musica(MAPAS[mapaIdx].trilha || 'luta');
  startIntro(1);
}
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
  if (PARAMS.get('win')) WIN_SCORE = Math.max(1, parseInt(PARAMS.get('win'), 10) || 5); // dev: encurta a partida
  updateScore();
  state = 'luta';
} else if (PARAMS.has('tutorial')) {
  iniciarTutorial(); // dev/teste: entra direto no tutorial
} else if (PARAMS.get('torneio')) {
  iniciarTorneio(Math.max(4, Math.min(8, parseInt(PARAMS.get('torneio'), 10) || 4))); // dev/teste
} else {
  // dois lutadores de enfeite no palco atrás do menu
  montarLutadores([{ ...selCfg[0] }, { ...selCfg[1] }]);
  updateScore();
  mostrarTitulo();
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
