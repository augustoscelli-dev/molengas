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
const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false, emote: false };
const SPAWNS = [[-2.2, 0], [2.2, 0], [0, -2.6], [0, 2.6]];
const PLAYER_BITS = [0x0002, 0x0004, 0x0020, 0x0040];
const TODOS_PLAYERS = 0x0066;

// ---------- Física: mapa ESTÁDIO (espelha o build do cliente) ----------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const GROUND_GROUPS = (0x0001 << 16) | 0xffff;
const PROP_GROUPS = (0x0008 << 16) | (0x0001 | 0x0008 | TODOS_PLAYERS);

const chao = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
world.createCollider(
  RAPIER.ColliderDesc.cuboid(ARENA.halfX, 0.3, ARENA.halfZ).setFriction(0.8).setCollisionGroups(GROUND_GROUPS),
  chao,
);
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
const CAIXOTES_SPAWN = [[-3.4, 2.3], [3.2, -2.4], [0.6, 3.0], [-1.2, -2.9]];
const caixotes = CAIXOTES_SPAWN.map(([cx, cz]) => {
  const b = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, 0.4, cz).setLinearDamping(0.25).setAngularDamping(0.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.19, 0.19, 0.19).setMass(4).setFriction(0.6).setCollisionGroups(PROP_GROUPS),
    b,
  );
  return b;
});
const props = [bola, ...caixotes];
function resetProps() {
  bola.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
  bola.setLinvel({ x: 2.6, y: 0, z: 1.1 }, true);
  bola.setAngvel({ x: 0, y: 0, z: 0 }, true);
  caixotes.forEach((b, i) => {
    b.setTranslation({ x: CAIXOTES_SPAWN[i][0], y: 0.4, z: CAIXOTES_SPAWN[i][1] }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });
}

// ---------- Jogadores ----------
const jogadores = new Map(); // ws -> jogador

function slotsLivres() {
  const usados = new Set([...jogadores.values()].map((j) => j.slot));
  return [0, 1, 2, 3].filter((s) => !usados.has(s));
}
function criarJogador(ws, skin) {
  const livres = slotsLivres();
  if (!livres.length) return null;
  const slot = livres[0];
  const [sx, sz] = SPAWNS[slot];
  const rag = new Ragdoll(RAPIER, world, {
    x: sx, z: sz, heading: Math.atan2(-sx, -sz),
    memberships: PLAYER_BITS[slot],
    filter: 0x0001 | 0x0008 | (TODOS_PLAYERS & ~PLAYER_BITS[slot]),
  });
  rag.props = props;
  const j = { ws, slot, skin: skin | 0, rag, input: { ...IDLE }, vivo: estado === 'lobby', score: 0 };
  jogadores.set(ws, j);
  refazerRivais();
  return j;
}
function removerJogador(ws) {
  const j = jogadores.get(ws);
  if (!j) return;
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
  for (const j of jogadores.values()) { j.score = 0; j.vivo = true; j.rag.reset(); }
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
    j.rag.update(DT, now, (lutando && j.vivo) || estado === 'lobby' ? j.input : IDLE);
    // ganchos de som → eventos
    const r = j.rag;
    if (r.lastPunchStartAt > (r._evSoco ?? -1)) { r._evSoco = r.lastPunchStartAt; ev('soco'); }
    if (r.lastHitLandedAt > 0 && r.lastHitLandedAt > (r._evHit ?? -1)) {
      r._evHit = r.lastHitLandedAt;
      const hp = r.parts.head.translation();
      ev('hit', q(hp.x), q(hp.y), q(hp.z));
    }
    if (r.lastJumpAt > (r._evPulo ?? -1)) { r._evPulo = r.lastJumpAt; ev('pulo'); }
  }
  world.step();
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
          punch: !!m.p, grab: !!m.g, jump: !!m.j, emote: !!m.e,
        };
      }
    } else if (m.t === 'comecar') {
      const j = jogadores.get(ws);
      if (j && j === host() && (estado === 'lobby' || estado === 'fim') && jogadores.size >= 2) comecarPartida();
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
  if (AUTO) console.log('modo --auto: a luta começa sozinha com 2 jogadores');
});
