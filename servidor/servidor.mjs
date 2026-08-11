// MOLENGAS! — servidor LAN (fase 1 do online)
// Roda a física oficial (mesmo Rapier + Ragdoll do jogo) e serve o jogo
// por HTTP na mesma porta. Jogadores abrem http://IP:8877 e pronto.
//
//   node servidor.mjs          — normal (host aperta F pra começar)
//   node servidor.mjs --auto   — começa sozinho quando entram 2

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS, ARENA } from '../src/ragdoll.js';

await RAPIER.init();

const PORTA = 8877;
const AUTO = process.argv.includes('--auto');
const PONTOS = [{ n: 'Melhor de 5', v: 5 }, { n: 'Melhor de 3', v: 3 }, { n: 'Morte Súbita', v: 1 }];
let pontoIdx = 0;
const winScore = () => PONTOS[pontoIdx].v;
const DT = 1 / 60;
const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false, emote: false, esquiva: false };

// Modos de sala: quantos jogadores cabem e o tamanho da arena.
const MODOS_SALA = {
  normal:  { max: 8,  arena: 1.2, nome: 'Normal (até 8)' },
  loucura: { max: 20, arena: 1.9, nome: 'LOUCURA — até 20! 🤪' },
};
const ORDEM_MODOS = ['normal', 'loucura'];
let salaModo = process.argv.includes('--loucura') ? 'loucura' : 'normal';
const capSala = () => MODOS_SALA[salaModo].max;
let salaJaeger = false; // modo robôs (par) x monstros (ímpar), com força assimétrica

// Colisão: todos os players compartilham UM bit; o filtro de contato por "dono"
// evita a auto-colisão (partes do mesmo boneco não colidem). Escala pra N jogadores
// sem estourar o orçamento de 16 bits de grupos.
const ENV_BIT = 0x0001, PROP_BIT = 0x0008, PLAYER_BIT = 0x0002;
const PLAYER_MEMB = PLAYER_BIT, PLAYER_FILT = ENV_BIT | PROP_BIT | PLAYER_BIT;
const GROUND_GROUPS = (ENV_BIT << 16) | 0xffff;
const PROP_GROUPS = (PROP_BIT << 16) | (ENV_BIT | PROP_BIT | PLAYER_BIT);
const ownerByHandle = new Map(); // handle do collider -> id do dono (pro filtro)

// ---------- Física ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const filaEventos = new RAPIER.EventQueue(true);
const hooks = {
  filterContactPair: (c1, c2) => {
    const o1 = ownerByHandle.get(c1), o2 = ownerByHandle.get(c2);
    if (o1 != null && o1 === o2) return null; // mesmo dono => sem colisão (nem explosão)
    return RAPIER.SolverFlags.COMPUTE_IMPULSE;
  },
};

const jogadores = new Map(); // ws -> jogador

// Posição de nascimento em anel, espaçada pra caber todo mundo.
let arenaHX = ARENA.halfX, arenaHZ = ARENA.halfZ;
function spawnFor(slot, total) {
  const n = Math.max(2, total);
  const a = (slot / n) * Math.PI * 2;
  const r = Math.min(arenaHX, arenaHZ) * 0.62;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// Arena reconstruível: a escala muda por modo (loucura = arena maior).
let chao = null, ancora = null, bola = null, caixotes = [], props = [];
function montarArena(scale) {
  for (const b of [chao, ancora, bola, ...caixotes]) if (b) world.removeRigidBody(b);
  caixotes = [];
  arenaHX = ARENA.halfX * scale; arenaHZ = ARENA.halfZ * scale;
  chao = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(arenaHX, 0.3, arenaHZ).setFriction(0.8).setCollisionGroups(GROUND_GROUPS), chao);
  ancora = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 6.2, 0));
  bola = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.8, 0).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3));
  world.createCollider(RAPIER.ColliderDesc.ball(0.55).setMass(45).setFriction(0.4).setRestitution(0.3).setCollisionGroups(PROP_GROUPS), bola);
  world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 4.4, z: 0 }), ancora, bola, true);
  bola.setLinvel({ x: 2.6, y: 0, z: 1.1 }, true);
  const n = Math.round(4 * scale);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4, r = Math.min(arenaHX, arenaHZ) * 0.5;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, 0.4, cz).setLinearDamping(0.25).setAngularDamping(0.5));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.19, 0.19, 0.19).setMass(4).setFriction(0.6).setCollisionGroups(PROP_GROUPS), b);
    caixotes.push(b);
  }
  props = [bola, ...caixotes];
  for (const j of jogadores.values()) j.rag.props = props;
}
function resetProps() {
  bola.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
  bola.setLinvel({ x: 2.6, y: 0, z: 1.1 }, true);
  bola.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const n = Math.max(1, caixotes.length);
  caixotes.forEach((b, i) => {
    const a = (i / n) * Math.PI * 2 + 0.4, r = Math.min(arenaHX, arenaHZ) * 0.5;
    b.setTranslation({ x: Math.cos(a) * r, y: 0.4, z: Math.sin(a) * r }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });
}
montarArena(MODOS_SALA[salaModo].arena);

// ---------- Armas (só a física; o cliente desenha) ----------
// tipos: índice usado no snapshot (bastao=0, cano=1, martelo=2, laser=3, bomba=4)
const ARMAS_DEF_S = {
  bastao:  { y0: 0.55, massa: 2.6, alcance: 0.72, forca: 10, col: () => RAPIER.ColliderDesc.capsule(0.32, 0.06) },
  cano:    { y0: 0.5,  massa: 3.2, alcance: 0.66, forca: 12, col: () => RAPIER.ColliderDesc.capsule(0.36, 0.05) },
  martelo: { y0: 0.6,  massa: 4.6, alcance: 0.82, forca: 22, col: () => RAPIER.ColliderDesc.capsule(0.3, 0.09) },
  laser:   { y0: 0.4,  massa: 1.5, alcance: 0.42, forca: 4, tiro: true, alcanceTiro: 7, cadencia: 0.28, danoTiro: 1, calorMax: 6, calorPorTiro: 1, resfria: 2.2, col: () => RAPIER.ColliderDesc.capsule(0.12, 0.13) },
  bomba:   { y0: 0.4,  massa: 2.0, alcance: 0.5, forca: 4, bomba: true, fuse: 3.2, raio: 2.5, forcaExpl: 18, col: () => RAPIER.ColliderDesc.ball(0.17) },
};
const ARMA_TIPOS = ['bastao', 'cano', 'martelo', 'laser', 'bomba'];
let armas = [];
let proxArmaEm = 0, proxArmaId = 1;
const WEAPON_GROUPS = (PROP_BIT << 16) | (ENV_BIT | PROP_BIT | PLAYER_BIT);

function atualizarPropsDosRags() {
  const corpos = armas.map((a) => a.body);
  for (const j of jogadores.values()) j.rag.props = props.concat(corpos);
}
function soltarArmaS(tipo, x, z) {
  const def = ARMAS_DEF_S[tipo] || ARMAS_DEF_S.bastao;
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 4.2, z).setLinearDamping(0.2).setAngularDamping(0.45));
  world.createCollider(def.col().setMass(def.massa).setFriction(0.6).setCollisionGroups(WEAPON_GROUPS), b);
  const arma = {
    id: proxArmaId++, tipo, body: b, alcance: def.alcance, forca: def.forca,
    tiro: !!def.tiro, alcanceTiro: def.alcanceTiro || 0, cadencia: def.cadencia || 0.5, danoTiro: def.danoTiro || 1,
    calor: 0, calorMax: def.calorMax || 6, calorPorTiro: def.calorPorTiro || 1, resfria: def.resfria || 2.2, quente: false,
    bomba: !!def.bomba, fuse: def.fuse || 3.2, raio: def.raio || 2.4, forcaExpl: def.forcaExpl || 18, explodeEm: null,
  };
  armas.push(arma);
  atualizarPropsDosRags();
  return arma;
}
function removerArmaS(arma) {
  const i = armas.indexOf(arma); if (i >= 0) armas.splice(i, 1);
  try { world.removeRigidBody(arma.body); } catch {}
  atualizarPropsDosRags();
}
function limparArmas() { for (const a of armas.slice()) removerArmaS(a); proxArmaEm = 0; }

function explodirBombaS(arma) {
  const p = arma.body.translation();
  for (const j of jogadores.values()) if (j.rag.grabJoints.some((g) => g && g.body === arma.body)) j.rag.releaseGrabs();
  for (const j of jogadores.values()) {
    if (!j.vivo) continue;
    const tp = j.rag.parts.torso.translation();
    const dx = tp.x - p.x, dy = tp.y - p.y, dz = tp.z - p.z, d = Math.hypot(dx, dy, dz);
    if (d > arma.raio) continue;
    const f = arma.forcaExpl * (1 - d / arma.raio), nl = d || 1;
    for (const pn of ['torso', 'pelvis', 'head']) j.rag.parts[pn].applyImpulse({ x: (dx / nl) * f, y: 3 + f * 0.25, z: (dz / nl) * f }, true);
    j.rag.dano = Math.min(4, j.rag.dano + 2); j.rag.stun(now + 1.4);
    if (j.rag.dano >= 4 && !j.rag.isDowned(now)) j.rag.knockdown(now);
    j.rag.lastHitLandedAt = now;
  }
  ev('explosao', q(p.x), q(p.y), q(p.z));
  removerArmaS(arma);
}
function dispararLaserS(j, arma) {
  const h = j.rag.heading, dx = Math.sin(h), dz = Math.cos(h);
  const mp = arma.body.translation(), range = arma.alcanceTiro;
  let alvo = null, alvoT = range;
  for (const o of jogadores.values()) {
    if (o === j || !o.vivo) continue;
    const tp = o.rag.parts.torso.translation();
    const rx = tp.x - mp.x, ry = tp.y - mp.y, rz = tp.z - mp.z;
    const t = rx * dx + rz * dz;
    if (t < 0.2 || t > range) continue;
    if (Math.hypot(rx - dx * t, ry, rz - dz * t) < 0.75 && t < alvoT) { alvoT = t; alvo = o; }
  }
  const ex = mp.x + dx * alvoT, ez = mp.z + dz * alvoT;
  ev('laser', q(mp.x), q(mp.y), q(mp.z), q(ex), q(mp.y), q(ez));
  if (alvo) {
    alvo.rag.dano = Math.min(4, alvo.rag.dano + arma.danoTiro); alvo.rag.stun(now + 0.85);
    if (alvo.rag.dano >= 4 && !alvo.rag.isDowned(now)) alvo.rag.knockdown(now);
    for (const pn of ['torso', 'pelvis']) alvo.rag.parts[pn].applyImpulse({ x: dx * 7, y: 1.6, z: dz * 7 }, true);
    alvo.rag.lastHitLandedAt = now;
  }
}

// Roda toda a lógica de armas (drop, uso, dano, bomba) — chamado por frame durante a luta.
function tickArmas() {
  const cap = capSala();
  const capArmas = salaModo === 'loucura' ? 8 : 4, atraso = salaModo === 'loucura' ? 3 : 9;
  if (proxArmaEm === 0) proxArmaEm = now + 5;
  if (now > proxArmaEm && armas.length < capArmas) {
    const ax = (Math.random() * 2 - 1) * arenaHX * 0.5, az = (Math.random() * 2 - 1) * arenaHZ * 0.5;
    const tipo = ARMAS_DEF_S[process.env.MOLENGAS_ARMA] ? process.env.MOLENGAS_ARMA : ARMA_TIPOS[(Math.random() * ARMA_TIPOS.length) | 0];
    soltarArmaS(tipo, ax, az);
    proxArmaEm = now + atraso + Math.random() * 5;
  }
  for (const arma of armas.slice()) {
    const ap = arma.body.translation();
    if (ap.y < -6) { removerArmaS(arma); continue; }
    if (arma.tiro) { arma.calor = Math.max(0, arma.calor - arma.resfria * DT); if (arma.quente && arma.calor <= 0.02) arma.quente = false; }
    if (arma.bomba) {
      const segurada = [...jogadores.values()].some((j) => j.rag.grabJoints.some((g) => g && g.body === arma.body));
      if (arma.explodeEm === null && segurada) arma.explodeEm = now + arma.fuse;
      if (arma.explodeEm !== null && now >= arma.explodeEm) { explodirBombaS(arma); continue; }
    }
    // Dano de arma branca por velocidade (swing/arremesso)
    const av = arma.body.linvel(), sp = Math.hypot(av.x, av.y, av.z);
    if (!arma.tiro && !arma.bomba && sp >= 3.4) {
      for (const j of jogadores.values()) {
        if (!j.vivo || now < (j._armaCd ?? 0)) continue;
        if (j.rag.grabJoints.some((g) => g && g.body === arma.body)) continue;
        const tp = j.rag.parts.torso.translation();
        if (Math.hypot(ap.x - tp.x, ap.y - tp.y, ap.z - tp.z) < arma.alcance) {
          j._armaCd = now + 0.7;
          const forte = sp > 7.5;
          j.rag.dano = Math.min(4, j.rag.dano + (forte ? 2 : 1)); j.rag.stun(now + (forte ? 1.5 : 1.0));
          if (j.rag.dano >= 4 && !j.rag.isDowned(now)) j.rag.knockdown(now);
          const dl = Math.hypot(av.x, av.z) || 1;
          for (const pn of ['torso', 'pelvis']) j.rag.parts[pn].applyImpulse({ x: (av.x / dl) * arma.forca, y: 2, z: (av.z / dl) * arma.forca }, true);
          j.rag.lastHitLandedAt = now; ev('bolada');
        }
      }
    }
  }
  // Disparo de laser: quem segura um laser e ataca (borda do soco) atira em cadência
  for (const j of jogadores.values()) {
    const arma = armas.find((a) => a.tiro && j.rag.grabJoints.some((g) => g && g.body === a.body));
    if (!arma) continue;
    if (j.rag.lastPunchStartAt > (j._tiroVisto ?? -1) && now > (j._tiroCd ?? 0) && !arma.quente) {
      j._tiroVisto = j.rag.lastPunchStartAt; j._tiroCd = now + arma.cadencia;
      arma.calor = Math.min(arma.calorMax, arma.calor + arma.calorPorTiro);
      if (arma.calor >= arma.calorMax) arma.quente = true;
      dispararLaserS(j, arma);
    }
  }
}

// ---------- Power-ups (pontos flutuantes; pega por proximidade) ----------
const POWER_TIPOS = ['cura', 'vel', 'forca'];
const aplicarPower = {
  cura: (rag) => { rag.dano = 0; rag.folego = 1; },
  vel: (rag) => { rag.buffVel = 1.6; rag.buffVelAte = now + 6; },
  forca: (rag) => { rag.buffForca = 1.8; rag.buffForcaAte = now + 6; },
};
let powerups = [];
let proxPowerEm = 0, proxPowerId = 1;
function limparPowerups() { powerups = []; proxPowerEm = 0; }
function tickPowerups() {
  const maxP = salaModo === 'loucura' ? 4 : 2;
  if (proxPowerEm === 0) proxPowerEm = now + (salaModo === 'loucura' ? 5 : 8);
  if (now > proxPowerEm && powerups.length < maxP) {
    const px = (Math.random() * 2 - 1) * arenaHX * 0.5, pz = (Math.random() * 2 - 1) * arenaHZ * 0.5;
    powerups.push({ id: proxPowerId++, tipo: POWER_TIPOS[(Math.random() * POWER_TIPOS.length) | 0], x: px, z: pz, y: 1.4, vida: 16 });
    proxPowerEm = now + (salaModo === 'loucura' ? 8 : 12) + Math.random() * 6;
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i]; p.vida -= DT;
    let pego = false;
    for (const j of jogadores.values()) {
      if (!j.vivo) continue;
      const t = j.rag.parts.torso.translation();
      if (Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) < 0.8) { aplicarPower[p.tipo](j.rag); ev('power', q(p.x), q(p.y), q(p.z)); pego = true; break; }
    }
    if (pego || p.vida <= 0) powerups.splice(i, 1);
  }
}

// ---------- Jogadores ----------
function slotsLivres() {
  const usados = new Set([...jogadores.values()].map((j) => j.slot));
  const livres = [];
  for (let s = 0; s < capSala(); s++) if (!usados.has(s)) livres.push(s);
  return livres;
}
function criarJogador(ws, skin) {
  const livres = slotsLivres();
  if (!livres.length) return null;
  const slot = livres[0];
  const owner = slot;
  const [sx, sz] = spawnFor(slot, capSala());
  const handles = [];
  const rag = new Ragdoll(RAPIER, world, {
    x: sx, z: sz, heading: Math.atan2(-sx, -sz),
    memberships: PLAYER_MEMB, filter: PLAYER_FILT,
    owner, onCollider: (col) => { ownerByHandle.set(col.handle, owner); handles.push(col.handle); },
  });
  rag.props = props;
  const j = { ws, slot, skin: skin | 0, rag, input: { ...IDLE }, vivo: estado === 'lobby', score: 0, handles };
  jogadores.set(ws, j);
  refazerRivais();
  atualizarPropsDosRags(); // inclui as armas já dropadas nos props agarráveis
  return j;
}
function removerJogador(ws) {
  const j = jogadores.get(ws);
  if (!j) return;
  for (const h of (j.handles || [])) ownerByHandle.delete(h); // limpa o filtro de contato
  j.rag.destroy();
  jogadores.delete(ws);
  refazerRivais();
}
function refazerRivais() {
  const todos = [...jogadores.values()];
  for (const j of todos) j.rag.rivals = todos.filter((o) => o !== j && o.vivo).map((o) => o.rag);
}
function host() { return [...jogadores.values()].sort((a, b) => a.slot - b.slot)[0] ?? null; }

// ---------- Rounds ----------
let estado = 'lobby'; // lobby | intro | luta | ponto | fim
let estadoAte = 0;
let introStep = 0;
let msg = '';
let now = 0;
const eventos = [];
const ev = (...e) => eventos.push(e);

function startIntro(roundN) {
  estado = 'intro';
  introStep = 0;
  estadoAte = now + 0.9;
  limparArmas(); limparPowerups(); // arena limpa a cada round
  msg = 'ROUND ' + roundN;
}
function comecarPartida() {
  montarArena(MODOS_SALA[salaModo].arena); // arena do modo escolhido
  const tot = capSala();
  for (const j of jogadores.values()) {
    const [sx, sz] = spawnFor(j.slot, tot);
    j.rag.spawn = { x: sx, z: sz };
    j.rag.heading0 = Math.atan2(-sx, -sz);
    // Modo Jaeger: par = robô (normal), ímpar = Kaiju (bate mais forte, aguenta mais)
    if (salaJaeger && j.slot % 2 === 1) { j.rag.forcaSoco = 1.3; j.rag.resistencia = 1.45; }
    else { j.rag.forcaSoco = 1; j.rag.resistencia = 1; }
    j.score = 0; j.vivo = true; j.rag.reset();
  }
  resetProps();
  refazerRivais();
  startIntro(1);
}
function rounds() {
  if (estado === 'intro') {
    if (now > estadoAte) {
      if (introStep === 0) { introStep = 1; estadoAte = now + 0.6; msg = 'LUTEM! 🥊'; ev('lutem'); }
      else { msg = ''; estado = 'luta'; }
    }
    return;
  }
  if (estado === 'luta') {
    for (const j of jogadores.values()) {
      if (j.vivo && j.rag.parts.pelvis.translation().y < -8) {
        j.vivo = false;
        j.rag.stats.quedas++;
        ev('queda');
        refazerRivais();
      }
    }
    const vivos = [...jogadores.values()].filter((j) => j.vivo);
    if (vivos.length <= 1 && jogadores.size >= 2) {
      const winner = vivos[0] ?? null;
      if (winner) winner.score++;
      if (winner && winner.score >= winScore()) {
        estado = 'fim';
        msg = '🏆 JOGADOR ' + (winner.slot + 1) + ' VENCEU! (host: F reinicia)';
        ev('vitoria');
      } else {
        estado = 'ponto';
        estadoAte = now + 1.4;
        msg = winner ? 'PONTO DO JOGADOR ' + (winner.slot + 1) + '!' : 'EMPATE!';
        ev('ponto');
      }
    }
  } else if (estado === 'ponto' && now > estadoAte) {
    for (const j of jogadores.values()) { j.rag.reset(); j.vivo = true; }
    resetProps();
    refazerRivais();
    startIntro([...jogadores.values()].reduce((s, j) => s + j.score, 0) + 1);
  }
}

// ---------- Loop de física + snapshots ----------
let tick = 0;
const q = (v) => Math.round(v * 1000) / 1000;

setInterval(() => {
  now += DT;
  tick++;
  const lutando = estado === 'luta';
  for (const j of jogadores.values()) {
    const input = (lutando && j.vivo) || estado === 'lobby' ? j.input : IDLE;
    // Detecção de dash (toque duplo na direção) e esquiva (borda) — igual ao cliente,
    // mas aqui no servidor, que é dono da física.
    const mag = Math.hypot(input.move.x, input.move.z);
    if (mag > 0.5 && !j._movHeld) { if (now - (j._lastPress ?? -9) < 0.33) j.rag.dash(now); j._lastPress = now; }
    j._movHeld = mag > 0.3;
    if (input.esquiva && !j._esqHeld) j.rag.esquiva(now, input.move.x, input.move.z);
    j._esqHeld = !!input.esquiva;
    j.rag.update(DT, now, input);
    // ganchos de som → eventos
    const r = j.rag;
    if (r.lastPunchStartAt > (r._evSoco ?? -1)) { r._evSoco = r.lastPunchStartAt; ev('soco'); }
    if (r.lastHitLandedAt > 0 && r.lastHitLandedAt > (r._evHit ?? -1)) {
      r._evHit = r.lastHitLandedAt;
      const hp = r.parts.head.translation();
      ev('hit', q(hp.x), q(hp.y), q(hp.z));
    }
    if (r.lastJumpAt > (r._evPulo ?? -1)) { r._evPulo = r.lastJumpAt; ev('pulo'); }
    if (r.lastDashAt > (r._evDash ?? -1)) { r._evDash = r.lastDashAt; ev('dash'); }
    if (r.lastEsquivaAt > (r._evEsq ?? -1)) { r._evEsq = r.lastEsquivaAt; ev('esquiva'); }
  }
  world.step(filaEventos, hooks); // hook = filtro de contato por dono (sem auto-colisão)
  if (estado === 'luta') { tickArmas(); tickPowerups(); } // armas + power-ups
  // bolada
  const bv = bola.linvel();
  if (Math.hypot(bv.x, bv.y, bv.z) > 3) {
    const bp = bola.translation();
    for (const j of jogadores.values()) {
      if (now < (j._bolaCd ?? 0)) continue;
      const tp = j.rag.parts.torso.translation();
      if (Math.hypot(bp.x - tp.x, bp.y - tp.y, bp.z - tp.z) < 0.95) {
        j._bolaCd = now + 1.2;
        j.rag.dano = Math.min(4, j.rag.dano + 1);
        j.rag.stun(now + 1.1);
        j.rag.lastHitLandedAt = now;
        ev('bolada');
      }
    }
  }
  rounds();
  if (AUTO && estado === 'lobby' && jogadores.size >= 2) comecarPartida();

  // snapshot a 20Hz
  const passo = jogadores.size > 10 ? 4 : 3; // 15Hz em salas grandes, 20Hz no resto
  if (tick % passo === 0) {
    const js = [...jogadores.values()];
    // Metadados (leves) em JSON; as poses dos jogadores vão em Int16 binário depois.
    const meta = {
      t: 's', st: estado, msg,
      mo: MODOS_SALA[salaModo].nome, cap: capSala(), na: jogadores.size, pt: PONTOS[pontoIdx].n, jg: salaJaeger ? 1 : 0,
      ev: eventos.splice(0),
      pl: js.map((j) => ({ s: j.slot, sk: j.skin, v: j.vivo ? 1 : 0, at: j.rag.isStunned(now) ? 1 : 0, sc: j.score, d: Math.round(j.rag.dano * 10) / 10 })),
      pr: props.map((b) => { const tr = b.translation(), ro = b.rotation(); return [q(tr.x), q(tr.y), q(tr.z), q(ro.x), q(ro.y), q(ro.z), q(ro.w)]; }),
      wp: armas.map((a) => { const tr = a.body.translation(), ro = a.body.rotation(); return { id: a.id, ti: ARMA_TIPOS.indexOf(a.tipo), q: a.quente ? 1 : 0, p: [q(tr.x), q(tr.y), q(tr.z), q(ro.x), q(ro.y), q(ro.z), q(ro.w)] }; }),
      pu: powerups.map((p) => ({ id: p.id, ti: POWER_TIPOS.indexOf(p.tipo), p: [q(p.x), q(p.y), q(p.z)] })),
    };
    const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
    const buf = Buffer.allocUnsafe(4 + metaBuf.length + js.length * PARTS.length * 6 * 2);
    buf.writeUInt32LE(metaBuf.length, 0);
    metaBuf.copy(buf, 4);
    let off = 4 + metaBuf.length;
    const i16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
    for (const j of js) {
      for (const spec of PARTS) {
        const tr = j.rag.parts[spec.name].translation(), ro = j.rag.parts[spec.name].rotation();
        buf.writeInt16LE(i16(tr.x * 256), off); off += 2;   // posição: ±128m, ~4mm
        buf.writeInt16LE(i16(tr.y * 256), off); off += 2;
        buf.writeInt16LE(i16(tr.z * 256), off); off += 2;
        buf.writeInt16LE(i16(ro.x * 32767), off); off += 2; // quaternion xyz (w reconstruído)
        buf.writeInt16LE(i16(ro.y * 32767), off); off += 2;
        buf.writeInt16LE(i16(ro.z * 32767), off); off += 2;
      }
    }
    for (const j of jogadores.values()) if (j.ws.readyState === 1) j.ws.send(buf);
  }
}, 1000 / 60);

// ---------- HTTP (serve o jogo) + WebSocket ----------
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const http = createServer(async (req, res) => {
  try {
    let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (caminho === '/') caminho = '/index.html';
    const alvo = normalize(join(RAIZ, caminho));
    if (!alvo.startsWith(normalize(RAIZ + sep))) { res.writeHead(403); res.end(); return; }
    const corpo = await readFile(alvo);
    res.writeHead(200, { 'Content-Type': MIME[extname(alvo)] ?? 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404);
    res.end('não achei');
  }
});
const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  ws.on('message', (dados) => {
    let m;
    try { m = JSON.parse(dados); } catch { return; }
    if (m.t === 'entrar' && !jogadores.has(ws)) {
      const j = criarJogador(ws, m.skin);
      if (!j) { ws.send(JSON.stringify({ t: 'cheio' })); ws.close(); return; }
      ws.send(JSON.stringify({ t: 'oi', slot: j.slot }));
      console.log(`+ jogador ${j.slot + 1} entrou (${jogadores.size} na sala)`);
    } else if (m.t === 'input') {
      const j = jogadores.get(ws);
      if (j) {
        j.input = {
          move: { x: +m.m[0] || 0, z: +m.m[1] || 0 },
          punch: !!m.p, grab: !!m.g, jump: !!m.j, emote: !!m.e, esquiva: !!m.d,
        };
      }
    } else if (m.t === 'comecar') {
      const j = jogadores.get(ws);
      if (j && j === host() && (estado === 'lobby' || estado === 'fim') && jogadores.size >= 2) comecarPartida();
    } else if (m.t === 'modo') {
      const j = jogadores.get(ws);
      if (j && j === host() && (estado === 'lobby' || estado === 'fim')) {
        salaModo = ORDEM_MODOS[(ORDEM_MODOS.indexOf(salaModo) + 1) % ORDEM_MODOS.length];
        console.log('modo da sala ->', salaModo);
      }
    } else if (m.t === 'pontos') {
      const j = jogadores.get(ws);
      if (j && j === host() && (estado === 'lobby' || estado === 'fim')) pontoIdx = (pontoIdx + 1) % PONTOS.length;
    } else if (m.t === 'jaeger') {
      const j = jogadores.get(ws);
      if (j && j === host() && (estado === 'lobby' || estado === 'fim')) salaJaeger = !salaJaeger;
    }
  });
  ws.on('close', () => {
    removerJogador(ws);
    console.log(`- jogador saiu (${jogadores.size} na sala)`);
  });
});

http.listen(PORTA, () => {
  console.log('MOLENGAS! servidor LAN no ar 🥊');
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('Abram no navegador de cada jogador:');
  for (const ip of ips) console.log(`  http://${ip}:${PORTA}/?servidor=1`);
  console.log(`  (neste PC: http://localhost:${PORTA}/?servidor=1)`);
  console.log(`Modos: Normal (até 8) e LOUCURA (até 20). Host aperta M pra trocar, F pra começar.`);
  console.log(`Modo inicial: ${MODOS_SALA[salaModo].nome}`);
  if (AUTO) console.log('modo --auto: a luta começa sozinha com 2 jogadores');
});
