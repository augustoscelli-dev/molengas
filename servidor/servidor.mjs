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
const WIN_SCORE = 5;
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
  msg = 'ROUND ' + roundN;
}
function comecarPartida() {
  montarArena(MODOS_SALA[salaModo].arena); // arena do modo escolhido
  const tot = capSala();
  for (const j of jogadores.values()) {
    const [sx, sz] = spawnFor(j.slot, tot);
    j.rag.spawn = { x: sx, z: sz };
    j.rag.heading0 = Math.atan2(-sx, -sz);
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
      if (winner && winner.score >= WIN_SCORE) {
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
  if (tick % 3 === 0) {
    const snap = {
      t: 's',
      st: estado,
      msg,
      mo: MODOS_SALA[salaModo].nome, cap: capSala(), na: jogadores.size, // pra tela de lobby
      ev: eventos.splice(0),
      pl: [...jogadores.values()].map((j) => {
        const p = [];
        for (const spec of PARTS) {
          const b = j.rag.parts[spec.name];
          const tr = b.translation();
          const ro = b.rotation();
          p.push(q(tr.x), q(tr.y), q(tr.z), q(ro.x), q(ro.y), q(ro.z), q(ro.w));
        }
        return { s: j.slot, sk: j.skin, v: j.vivo ? 1 : 0, at: j.rag.isStunned(now) ? 1 : 0, sc: j.score, p };
      }),
      pr: props.map((b) => {
        const tr = b.translation();
        const ro = b.rotation();
        return [q(tr.x), q(tr.y), q(tr.z), q(ro.x), q(ro.y), q(ro.z), q(ro.w)];
      }),
    };
    const dados = JSON.stringify(snap);
    for (const j of jogadores.values()) {
      if (j.ws.readyState === 1) j.ws.send(dados);
    }
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
