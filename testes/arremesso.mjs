// Arremesso de nocauteado: anda até ele, agarra, gira e solta. Mede se passa
// da corda (1,3 m) e o tranco no agarrão.   F=nova node testes/arremesso.mjs
import * as RAPIER from '../libs/rapier3d.es.js';
import { AJUSTES } from '../src/ajustes.js';
await RAPIER.init(); AJUSTES.fisica = process.env.F || 'classica';
const { Ragdoll } = await import('../src/ragdoll.js');
const res = [];
for (let tent = 0; tent < 6; tent++) {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 60; if (AJUSTES.fisica === 'nova') w.integrationParameters.numSolverIterations = 8;
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.3, 30).setFriction(0.8).setCollisionGroups((1 << 16) | 0xffff), g);
  const a = new Ragdoll(RAPIER, w, { x: 0, z: 0, heading: 0, memberships: 2, filter: 1 | 4 });
  const b = new Ragdoll(RAPIER, w, { x: 0, z: 0.75, heading: Math.PI, memberships: 4, filter: 1 | 2 });
  a.rivals = [b]; b.rivals = [a];
  let t = 0; const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };
  const passo = (ia, n) => { for (let i = 0; i < n; i++) { t += 1 / 60; a.update(1 / 60, t, ia); b.update(1 / 60, t, IDLE); w.step(); } };
  passo(IDLE, 60); b.dano = 99; b.knockdown(t, 20); passo(IDLE, 60);
  // anda até o nocauteado (como o bot faz) e agarra
  for (let i = 0; i < 240; i++) { const q = b.parts.pelvis.translation(), m = a.parts.pelvis.translation(); const dx = q.x - m.x, dz = q.z - m.z, d = Math.hypot(dx, dz); if (d < 0.75) break; passo({ ...IDLE, move: { x: dx / d, z: dz / d } }, 1); }
  let vmax = 0; const vm = () => { const v = b.parts.pelvis.linvel(); vmax = Math.max(vmax, Math.hypot(v.x, v.y, v.z)); };
  for (let i = 0; i < 40; i++) { passo({ ...IDLE, grab: true }, 1); vm(); }
  const pegou = !!a.grabbedRival();
  // gira segurando (anda em círculo) e solta encarando +z
  for (let i = 0; i < 50 + tent * 6; i++) { const ang = i * 0.25; passo({ ...IDLE, grab: true, move: { x: Math.sin(ang), z: Math.cos(ang) } }, 1); vm(); }
  const spin = Math.abs(a.parts.pelvis.angvel().y);
  a.releaseGrabs(true);
  let hMax = 0, x0 = b.parts.torso.translation();
  for (let i = 0; i < 90; i++) { passo(IDLE, 1); hMax = Math.max(hMax, b.parts.pelvis.translation().y); }
  const x1 = b.parts.pelvis.translation();
  res.push({ pegou, vmaxAntes: +vmax.toFixed(1), spin: +spin.toFixed(1), alturaMax: +hMax.toFixed(2), distancia: +Math.hypot(x1.x - x0.x, x1.z - x0.z).toFixed(2) });
}
const ok = res.filter((r) => r.pegou && r.alturaMax > 1.3).length;
console.log(AJUSTES.fisica.padEnd(9), `passa corda(>1.3m): ${ok}/${res.length}`, JSON.stringify(res));
