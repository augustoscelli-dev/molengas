// Bancada de SENSAÇÃO da física: inclinação do tronco, esticamento das juntas,
// resposta (aceleração / meia-volta) e reação a pancada.
//   node testes/banca-fisica.mjs            (física atual)
//   F=nova node testes/banca-fisica.mjs     (física nova)
//   F=nova M=giro=2,reto=3 node testes/banca-fisica.mjs  (varre ganhos de MUSC)
import * as RAPIER from '../libs/rapier3d.es.js';
import { Ragdoll, PARTS } from '../src/ragdoll.js';
import { AJUSTES } from '../src/ajustes.js';
await RAPIER.init(); AJUSTES.fisica = process.env.F || 'classica';
import('../src/ragdoll.js').then(()=>{});
const { MUSC } = await import('../src/ragdoll.js'); for (const kv of (process.env.M||'').split(',').filter(Boolean)) { const [k,v]=kv.split('='); MUSC[k]=+v; }
const nova = AJUSTES.fisica === 'nova';
const mk = () => {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 60; if (nova) w.integrationParameters.numSolverIterations = 8;
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.3, 30).setFriction(0.8).setCollisionGroups((1 << 16) | 0xffff), g);
  const r = new Ragdoll(RAPIER, w, { x: 0, z: 0, heading: 0, memberships: 2, filter: 1 });
  let t = 0; const passo = (inp, n, cb) => { for (let i = 0; i < n; i++) { t += 1 / 60; r.update(1 / 60, t, inp); w.step(); cb && cb(i); } };
  return { w, r, passo, agora: () => t };
};
const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };
const qrot = (q, v) => { const { x, y, z, w } = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const incl = (b) => Math.acos(Math.max(-1, Math.min(1, qrot(b.rotation(), [0, 1, 0])[1]))) * 180 / Math.PI;
// esticamento: distância entre âncoras das juntas (deveria ser 0)
const ANC = [['pelvis', 'torso', [0, 0.17, 0], [0, -0.16, 0]], ['torso', 'head', [0, 0.18, 0], [0, -0.16, 0]], ['torso', 'upperArmL', [-0.27, 0.11, 0], [0, 0.12, 0]], ['torso', 'upperArmR', [0.27, 0.11, 0], [0, 0.12, 0]], ['upperArmL', 'forearmL', [0, -0.13, 0], [0, 0.13, 0]], ['pelvis', 'thighL', [-0.1, -0.16, 0], [0, 0.2, 0]], ['thighL', 'calfL', [0, -0.18, 0], [0, 0.16, 0]]];
const estica = (r) => { let s = 0; for (const [a, b, pa, pb] of ANC) { const A = r.parts[a], B = r.parts[b]; const ta = A.translation(), tb = B.translation(); const ra = qrot(A.rotation(), pa), rb = qrot(B.rotation(), pb); s += Math.hypot(ta.x + ra[0] - tb.x - rb[0], ta.y + ra[1] - tb.y - rb[1], ta.z + ra[2] - tb.z - rb[2]); } return s / ANC.length * 100; };
const m = {};
{ // 1) andando: inclinação do tronco, oscilação da cabeça, esticamento
  const { r, passo } = mk(); passo(IDLE, 90);
  const inc = [], cab = [], est = []; let y0 = 0;
  passo({ ...IDLE, move: { x: 0, z: 1 } }, 300, (i) => { if (i > 60) { inc.push(incl(r.parts.torso)); cab.push(r.parts.head.translation().y); est.push(estica(r)); } });
  const med = (a) => a.reduce((x, y) => x + y, 0) / a.length, dp = (a) => { const mm = med(a); return Math.sqrt(med(a.map((x) => (x - mm) ** 2))); };
  m.troncoInclAndandoGraus = +med(inc).toFixed(1); m.cabecaSobeDesceCm = +(dp(cab) * 100).toFixed(1); m.esticaJuntaMmAndando = +(med(est) * 10).toFixed(1);
}
{ // 2) resposta: tempo até 1.4 m/s e meia-volta
  const { r, passo } = mk(); passo(IDLE, 90); let t1 = null;
  passo({ ...IDLE, move: { x: 0, z: 1 } }, 120, (i) => { const v = r.parts.pelvis.linvel(); if (t1 === null && v.z > 1.4) t1 = i / 60; });
  m.aceleraAte1_4ms_s = t1 === null ? 'nunca' : +t1.toFixed(2);
  let t2 = null; passo({ ...IDLE, move: { x: 0, z: -1 } }, 180, (i) => { const f = qrot(r.parts.pelvis.rotation(), [0, 0, 1]); if (t2 === null && f[2] < -0.9) t2 = i / 60; });
  m.meiaVolta_s = t2 === null ? 'nunca' : +t2.toFixed(2);
}
{ // 3) pancada: empurrão de 9 no tronco (≈ soco forte), quanto desloca e em quanto tempo volta a ficar reto
  const { r, passo, agora } = mk(); passo(IDLE, 90); const p0 = r.parts.pelvis.translation();
  r.stun(agora() + 0.5); r.parts.torso.applyImpulse({ x: 9, y: 1, z: 0 }, true); r.parts.head.applyImpulse({ x: 3, y: 0, z: 0 }, true);
  let maxInc = 0, volta = null, maxEst = 0;
  passo(IDLE, 240, (i) => { const a = incl(r.parts.torso); maxInc = Math.max(maxInc, a); maxEst = Math.max(maxEst, estica(r)); if (i > 40 && volta === null && a < 8) volta = i / 60; });
  const p1 = r.parts.pelvis.translation();
  m.golpeInclMaxGraus = +maxInc.toFixed(0); m.golpeRecuperaReto_s = volta === null ? '>4' : +volta.toFixed(2); m.golpeEsticaMaxMm = +(maxEst * 10).toFixed(1); m.golpeDeslocaCm = +(Math.hypot(p1.x - p0.x, p1.z - p0.z) * 100).toFixed(0);
  m.caiu = p1.y < 0.5;
}
console.log(AJUSTES.fisica.padEnd(9), JSON.stringify(m));
