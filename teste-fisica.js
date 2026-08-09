// Teste headless da física (roda com: node teste-fisica.js)
import * as RAPIER from './libs/rapier3d.es.js';
import { Ragdoll, ARENA } from './src/ragdoll.js';

await RAPIER.init();

const DT = 1 / 60;
const IDLE = { move: { x: 0, z: 0 }, punch: false, grab: false, jump: false };

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(ARENA.halfX, 0.3, ARENA.halfZ).setFriction(0.8).setCollisionGroups((0x0001 << 16) | 0xffff),
    ground,
  );
  const p1 = new Ragdoll(RAPIER, world, { x: -2.2, z: 0, heading: Math.PI / 2, memberships: 0x0002, filter: 0x0001 | 0x0004 });
  const p2 = new Ragdoll(RAPIER, world, { x: 2.2, z: 0, heading: -Math.PI / 2, memberships: 0x0004, filter: 0x0001 | 0x0002 });
  p1.opponent = p2; p2.opponent = p1;
  return { world, p1, p2 };
}

let now = 0;
function step(world, p1, p2, in1, in2, n) {
  for (let i = 0; i < n; i++) {
    now += DT;
    p1.update(DT, now, in1);
    p2.update(DT, now, in2);
    world.step();
  }
}
const pos = (r, part) => r.parts[part].translation();
const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
let fail = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'OK ' : 'FALHOU'} ${name} ${extra}`);
  if (!cond) fail++;
}

// --- Cenário 1: parado 4s — tem que ficar em pé, sem NaN ---
{
  const { world, p1, p2 } = makeWorld();
  step(world, p1, p2, IDLE, IDLE, 240);
  const pp = pos(p1, 'pelvis'), hp = pos(p1, 'head');
  check('em pé (quadril)', pp.y > 0.7 && pp.y < 1.2, fmt(pp));
  check('cabeça no alto', hp.y > 1.3, fmt(hp));
  check('sem NaN', Number.isFinite(pp.x + pp.y + pp.z + hp.x + hp.y + hp.z));
  const p2p = pos(p2, 'pelvis');
  check('P2 em pé', p2p.y > 0.7 && p2p.y < 1.2, fmt(p2p));
}

// --- Cenário 2: andar 1.5s pra +x (sem chegar na borda) ---
{
  const { world, p1, p2 } = makeWorld();
  const x0 = pos(p1, 'pelvis').x;
  step(world, p1, p2, { ...IDLE, move: { x: 1, z: 0 } }, IDLE, 90);
  const pp = pos(p1, 'pelvis');
  check('andou pra frente', pp.x > x0 + 1.0, `dx=${(pp.x - x0).toFixed(2)}`);
  check('continua em pé andando', pp.y > 0.6, `y=${pp.y.toFixed(2)}`);
}

// --- Cenário 3: chegar perto e socar → P2 atordoado ---
{
  const { world, p1, p2 } = makeWorld();
  let steps = 0;
  while (steps < 600) {
    const a = pos(p1, 'pelvis'), b = pos(p2, 'pelvis');
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1.1) break;
    step(world, p1, p2, { ...IDLE, move: { x: 1, z: 0 } }, IDLE, 1);
    steps++;
  }
  check('chegou perto', steps < 600, `passos=${steps}`);
  step(world, p1, p2, { ...IDLE, punch: true }, IDLE, 5);
  step(world, p1, p2, IDLE, IDLE, 25);
  check('soco atordoou P2', p2.stunUntil > 0, `stunUntil=${p2.stunUntil.toFixed(2)} now=${now.toFixed(2)}`);
  step(world, p1, p2, IDLE, IDLE, 240);
  const b = pos(p2, 'pelvis');
  check('P2 levantou depois', b.y > 0.6 || b.y < -8, `y=${b.y.toFixed(2)}`);
}

// --- Cenário 4: andar até a borda → cair no vazio ---
{
  const { world, p1, p2 } = makeWorld();
  step(world, p1, p2, { ...IDLE, move: { x: 1, z: 0 } }, IDLE, 900);
  const pp = pos(p1, 'pelvis');
  check('caiu da arena', pp.y < -8, fmt(pp));
}

// --- Cenário 5: agarrar → junta criada ---
{
  const { world, p1, p2 } = makeWorld();
  let steps = 0;
  while (steps < 600) {
    const a = pos(p1, 'pelvis'), b = pos(p2, 'pelvis');
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1.0) break;
    step(world, p1, p2, { ...IDLE, move: { x: 1, z: 0 } }, IDLE, 1);
    steps++;
  }
  step(world, p1, p2, { ...IDLE, grab: true }, IDLE, 60);
  check('agarrou', p1.grabJoints[0] !== null || p1.grabJoints[1] !== null);
  step(world, p1, p2, IDLE, IDLE, 5);
  check('soltou', p1.grabJoints[0] === null && p1.grabJoints[1] === null);
}

// --- Cenário 6: reset volta ao lugar ---
{
  const { world, p1, p2 } = makeWorld();
  step(world, p1, p2, { ...IDLE, move: { x: 1, z: 0 } }, IDLE, 900);
  p1.reset(); p2.reset();
  step(world, p1, p2, IDLE, IDLE, 120);
  const pp = pos(p1, 'pelvis');
  check('reset em pé no lugar', Math.abs(pp.x + 2.2) < 0.6 && pp.y > 0.7, fmt(pp));
}

console.log(fail === 0 ? '\nTUDO OK' : `\n${fail} FALHAS`);
process.exit(fail === 0 ? 0 : 1);
