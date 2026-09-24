// Ring-out de rival EM PÉ: A agarra B perto da corda, gira e solta. Conta quantas
// vezes B sai do ringue (passa da corda e cai). Ringue igual ao do servidor.
//   node testes/ringout.mjs          F=nova node testes/ringout.mjs
import * as RAPIER from '../libs/rapier3d.es.js';
import { AJUSTES } from '../src/ajustes.js';
await RAPIER.init(); AJUSTES.fisica = process.env.F || 'classica';
const { Ragdoll, ARENA, MUSC } = await import('../src/ragdoll.js');
for (const kv of (process.env.M || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); MUSC[k] = +v; }
const CORDA = 0.9, hx = ARENA.halfX, hz = ARENA.halfZ;
let sai = 0, pegou = 0; const N = +(process.env.N || 12);
for (let tent = 0; tent < N; tent++) {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 60; if (AJUSTES.fisica === 'nova') w.integrationParameters.numSolverIterations = 8;
  const chao = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  const G = (1 << 16) | 0xffff;
  w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.3, hz).setFriction(0.8).setCollisionGroups(G), chao);
  const e = 0.07, hy = CORDA / 2, cy = 0.3 + hy;
  for (const [px, pz, x, z] of [[hx + e, e, 0, hz + e], [hx + e, e, 0, -(hz + e)], [e, hz + e, hx + e, 0], [e, hz + e, -(hx + e), 0]]) w.createCollider(RAPIER.ColliderDesc.cuboid(px, hy, pz).setTranslation(x, cy, z).setFriction(0.4).setCollisionGroups(G), chao);
  // A no meio olhando +x, B entre A e a corda (+x)
  const ax = hx - 2.2 - (tent % 3) * 0.3, zz = ((tent % 4) - 1.5) * 0.4;
  const a = new Ragdoll(RAPIER, w, { x: ax, z: zz, heading: Math.PI / 2, memberships: 2, filter: 1 | 4 });
  const b = new Ragdoll(RAPIER, w, { x: ax + 0.8, z: zz, heading: -Math.PI / 2, memberships: 4, filter: 1 | 2 });
  a.rivals = [b]; b.rivals = [a];
  let t = 0; const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };
  const passo = (ia, n) => { for (let i = 0; i < n; i++) { t += 1 / 60; a.update(1 / 60, t, ia); b.update(1 / 60, t, IDLE); w.step(); } };
  passo(IDLE, 40);
  passo({ ...IDLE, grab: true }, 20); if (a.grabbedRival()) pegou++;
  // gira segurando (como os clientes do teste online) e solta encarando a corda
  const giro = 20 + (tent % 4) * 10;
  for (let i = 0; i < giro; i++) { const ang = i * 0.3; passo({ ...IDLE, grab: true, move: { x: Math.sin(ang), z: Math.cos(ang) } }, 1); }
  a.heading = Math.PI / 2; passo({ ...IDLE, grab: true, move: { x: 1, z: 0 } }, 6);
  passo(IDLE, 150);
  const p = b.parts.pelvis.translation();
  if (Math.abs(p.x) > hx + 0.2 || Math.abs(p.z) > hz + 0.2) sai++;
}
console.log(AJUSTES.fisica.padEnd(9), `agarrou ${pegou}/${N}, saiu do ringue ${sai}/${N}`);
