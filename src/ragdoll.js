// Ragdoll ativo (física pura, sem DOM/three) — recebe o módulo RAPIER e o world.
// O boneco fica em pé por "molas de marionete": uma corda invisível puxa a cabeça
// pra cima e o quadril flutua na altura certa. Nocaute = desligar as molas.

export const PARTS = [
  { name: 'pelvis',    shape: 'capsule', hh: 0.06, r: 0.14,  off: [0, 0.95, 0],      mass: 6 },
  { name: 'torso',     shape: 'capsule', hh: 0.10, r: 0.16,  off: [0, 1.28, 0],      mass: 6 },
  { name: 'head',      shape: 'ball',    r: 0.16,             off: [0, 1.62, 0],      mass: 3 },
  { name: 'upperArmL', shape: 'capsule', hh: 0.10, r: 0.06,  off: [-0.285, 1.28, 0], mass: 1 },
  { name: 'upperArmR', shape: 'capsule', hh: 0.10, r: 0.06,  off: [0.285, 1.28, 0],  mass: 1 },
  { name: 'forearmL',  shape: 'capsule', hh: 0.10, r: 0.055, off: [-0.285, 1.02, 0], mass: 1 },
  { name: 'forearmR',  shape: 'capsule', hh: 0.10, r: 0.055, off: [0.285, 1.02, 0],  mass: 1 },
  { name: 'thighL',    shape: 'capsule', hh: 0.12, r: 0.075, off: [-0.10, 0.56, 0],  mass: 2.5 },
  { name: 'thighR',    shape: 'capsule', hh: 0.12, r: 0.075, off: [0.10, 0.56, 0],   mass: 2.5 },
  { name: 'calfL',     shape: 'capsule', hh: 0.12, r: 0.06,  off: [-0.10, 0.22, 0],  mass: 1.5 },
  { name: 'calfR',     shape: 'capsule', hh: 0.12, r: 0.06,  off: [0.10, 0.22, 0],   mass: 1.5 },
];

const JOINTS = [
  ['pelvis', 'torso',     [0, 0.17, 0],      [0, -0.16, 0]],
  ['torso',  'head',      [0, 0.18, 0],      [0, -0.16, 0]],
  ['torso',  'upperArmL', [-0.27, 0.11, 0],  [0, 0.12, 0]],
  ['torso',  'upperArmR', [0.27, 0.11, 0],   [0, 0.12, 0]],
  ['upperArmL', 'forearmL', [0, -0.13, 0],   [0, 0.13, 0]],
  ['upperArmR', 'forearmR', [0, -0.13, 0],   [0, 0.13, 0]],
  ['pelvis', 'thighL',    [-0.10, -0.16, 0], [0, 0.20, 0]],
  ['pelvis', 'thighR',    [0.10, -0.16, 0],  [0, 0.20, 0]],
  ['thighL', 'calfL',     [0, -0.18, 0],     [0, 0.16, 0]],
  ['thighR', 'calfR',     [0, -0.18, 0],     [0, 0.16, 0]],
];

// Limites da plataforma — fora disso as molas desligam e o boneco despenca.
export const ARENA = { halfX: 5.5, halfZ: 4.0 };

// Fração do peso de cada parte que é "segurada" pela marionete enquanto em pé.
const ANTIGRAV = {
  pelvis: 0.8, torso: 0.8, head: 0.8,
  upperArmL: 0.5, upperArmR: 0.5, forearmL: 0.5, forearmR: 0.5,
  thighL: 0.25, thighR: 0.25, calfL: 0.25, calfR: 0.25,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const qrot = (q, v) => {
  // v' = q * v * q^-1
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
};

export class Ragdoll {
  constructor(R, world, { x = 0, z = 0, heading = 0, memberships, filter }) {
    this.R = R;
    this.world = world;
    this.spawn = { x, z };
    this.heading0 = heading;
    this.heading = heading;
    this.parts = {};
    this.opponent = null;
    this.stunUntil = 0;
    this.punchReadyAt = 0;
    this.punchUntil = 0;
    this.punchHit = true;
    this.jumpReadyAt = 0;
    this.hoverBlockUntil = 0;
    this.gaitT = 0;
    this.lastHitLandedAt = -10;
    this.grabJoints = [null, null];

    const groups = ((memberships & 0xffff) << 16) | (filter & 0xffff);
    for (const spec of PARTS) {
      const core = spec.name === 'head' || spec.name === 'torso' || spec.name === 'pelvis';
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(x + spec.off[0], spec.off[1], z + spec.off[2])
        .setLinearDamping(0.3)
        .setAngularDamping(core ? 2.4 : 1.1)
        .setCcdEnabled(core);
      const body = world.createRigidBody(desc);
      const cd = (spec.shape === 'ball' ? R.ColliderDesc.ball(spec.r) : R.ColliderDesc.capsule(spec.hh, spec.r))
        .setMass(spec.mass)
        .setFriction(0.7)
        .setRestitution(0.15)
        .setCollisionGroups(groups);
      world.createCollider(cd, body);
      this.parts[spec.name] = body;
    }
    for (const [a, b, aa, ab] of JOINTS) {
      const data = R.JointData.spherical(
        { x: aa[0], y: aa[1], z: aa[2] },
        { x: ab[0], y: ab[1], z: ab[2] },
      );
      world.createImpulseJoint(data, this.parts[a], this.parts[b], true);
    }
  }

  isStunned(now) { return now < this.stunUntil; }

  stun(until) {
    this.stunUntil = Math.max(this.stunUntil, until);
    this.releaseGrabs();
  }

  releaseGrabs() {
    for (let i = 0; i < 2; i++) {
      if (this.grabJoints[i]) {
        this.world.removeImpulseJoint(this.grabJoints[i], true);
        this.grabJoints[i] = null;
      }
    }
  }

  handTip(side) {
    const hand = this.parts[side === 0 ? 'forearmL' : 'forearmR'];
    const p = hand.translation();
    const d = qrot(hand.rotation(), [0, -0.14, 0]);
    return [p.x + d[0], p.y + d[1], p.z + d[2]];
  }

  update(dt, now, input) {
    const stunned = this.isStunned(now);
    const pelvis = this.parts.pelvis;
    const pp = pelvis.translation();
    const pv = pelvis.linvel();
    const onPlatform = Math.abs(pp.x) < ARENA.halfX + 0.1 && Math.abs(pp.z) < ARENA.halfZ + 0.1;
    const grounded = onPlatform && pp.y < 1.15 && Math.abs(pv.y) < 3;

    // "Em pé" = anti-gravidade parcial + molas de marionete + torque de vertical.
    const standing = !stunned && onPlatform && now > this.hoverBlockUntil && pp.y < 1.3;
    if (standing) {
      for (const [name, a] of Object.entries(ANTIGRAV)) {
        const b = this.parts[name];
        b.applyImpulse({ x: 0, y: b.mass() * 9.81 * a * dt, z: 0 }, true);
      }
      // Quadril flutuante (alto o bastante pras pernas ficarem quase esticadas)
      const f = clamp((1.0 - pp.y) * 950 - pv.y * 95, -160, 650);
      pelvis.applyImpulse({ x: 0, y: f * dt, z: 0 }, true);
      // Corda na cabeça
      const head = this.parts.head;
      const hp = head.translation();
      const hv = head.linvel();
      const fx = clamp((pp.x - hp.x) * 240 - hv.x * 18, -220, 220);
      const fy = clamp((pp.y + 0.68 - hp.y) * 480 - hv.y * 32, -100, 520);
      const fz = clamp((pp.z - hp.z) * 240 - hv.z * 18, -220, 220);
      head.applyImpulse({ x: fx * dt, y: fy * dt, z: fz * dt }, true);
      // Tronco acompanha
      const torso = this.parts.torso;
      const tp = torso.translation();
      const tv = torso.linvel();
      const ty = clamp((pp.y + 0.34 - tp.y) * 380 - tv.y * 30, -100, 420);
      torso.applyImpulse({ x: 0, y: ty * dt, z: 0 }, true);
      // Torque que segura o corpo na vertical (senão tomba pro lado)
      for (const bname of ['pelvis', 'torso']) {
        const b = this.parts[bname];
        const up = qrot(b.rotation(), [0, 1, 0]);
        const av2 = b.angvel();
        const tx = clamp((up[1] >= 0 ? 1 : 0.3) * (-up[2] * 24) - av2.x * 3, -13, 13);
        const tz = clamp((up[1] >= 0 ? 1 : 0.3) * (up[0] * 24) - av2.z * 3, -13, 13);
        b.applyTorqueImpulse({ x: tx * dt, y: 0, z: tz * dt }, true);
      }
    }
    if (!stunned) {
      // Movimento
      const mx = input.move.x, mz = input.move.z;
      const mlen = Math.hypot(mx, mz);
      if (mlen > 0.01) {
        this.heading = Math.atan2(mx, mz);
        const nx = mx / mlen, nz = mz / mlen;
        const speedAlong = pv.x * nx + pv.z * nz;
        if (speedAlong < 3.6) {
          pelvis.applyImpulse({ x: nx * 220 * dt, y: 0, z: nz * 220 * dt }, true);
          this.parts.torso.applyImpulse({ x: nx * 90 * dt, y: 0, z: nz * 90 * dt }, true);
        }
      }
      // Torque de direção (vira o corpo pra onde anda)
      const fwd = qrot(pelvis.rotation(), [0, 0, 1]);
      const yaw = Math.atan2(fwd[0], fwd[2]);
      const err = wrapPi(this.heading - yaw);
      const av = pelvis.angvel();
      const tq = clamp(err * 14 - av.y * 3.5, -18, 18);
      pelvis.applyTorqueImpulse({ x: 0, y: tq * dt, z: 0 }, true);
      // Tronco e cabeça acompanham a direção (suave — soco ainda gira a cabeça)
      for (const bn of ['torso', 'head']) {
        const b = this.parts[bn];
        const f2 = qrot(b.rotation(), [0, 0, 1]);
        const e2 = wrapPi(this.heading - Math.atan2(f2[0], f2[2]));
        const av2b = b.angvel();
        const forte = bn === 'torso';
        const t2 = clamp(e2 * (forte ? 5 : 1.6) - av2b.y * (forte ? 1.2 : 0.4), -7, 7);
        b.applyTorqueImpulse({ x: 0, y: t2 * dt, z: 0 }, true);
      }
      // Passinhos: parado os pés plantam no chão sob o quadril;
      // andando eles alternam passadas (ergue, avança, apoia)
      if (standing) {
        const andando = mlen > 0.01;
        this.gaitT += dt * (andando ? 8 : 0);
        const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
        const latX = Math.cos(this.heading), latZ = -Math.sin(this.heading);
        for (let lado = 0; lado < 2; lado++) {
          const calf = this.parts[lado === 0 ? 'calfL' : 'calfR'];
          const fase = this.gaitT + (lado === 0 ? 0 : Math.PI);
          const passo = andando ? Math.cos(fase) * 0.2 : 0;
          const ergue = andando ? Math.max(0, Math.sin(fase)) * 0.1 : 0;
          const alvoX = pp.x + latX * (lado === 0 ? -0.11 : 0.11) + fwdX * passo;
          const alvoZ = pp.z + latZ * (lado === 0 ? -0.11 : 0.11) + fwdZ * passo;
          const alvoY = 0.14 + ergue;
          const cp = calf.translation();
          const ponta = qrot(calf.rotation(), [0, -0.17, 0]);
          const cv = calf.linvel();
          const fx2 = clamp((alvoX - (cp.x + ponta[0])) * 26 - cv.x * 3, -18, 18);
          const fy2 = clamp((alvoY - (cp.y + ponta[1])) * 22 - cv.y * 4, -10, 14);
          const fz2 = clamp((alvoZ - (cp.z + ponta[2])) * 26 - cv.z * 3, -18, 18);
          calf.applyImpulse({ x: fx2 * dt, y: fy2 * dt, z: fz2 * dt }, true);
        }
        // Freio: sem input, os pés plantados seguram o escorregão
        if (!andando) {
          const bx = clamp(-pv.x * 90, -220, 220);
          const bz = clamp(-pv.z * 90, -220, 220);
          pelvis.applyImpulse({ x: bx * dt, y: 0, z: bz * dt }, true);
        }
      }
      // Pulo
      if (input.jump && grounded && now > this.jumpReadyAt) {
        this.jumpReadyAt = now + 0.7;
        this.hoverBlockUntil = now + 0.4;
        pelvis.applyImpulse({ x: 0, y: 20, z: 0 }, true);
        this.parts.torso.applyImpulse({ x: 0, y: 12, z: 0 }, true);
      }
      // Soco
      if (input.punch && now >= this.punchReadyAt) {
        this.punchReadyAt = now + 0.8;
        this.punchUntil = now + 0.25;
        this.punchHit = false;
        const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
        for (const h of ['forearmL', 'forearmR']) {
          this.parts[h].applyImpulse({ x: dir[0] * 7, y: 1.2, z: dir[2] * 7 }, true);
        }
      }
    }

    // Janela do soco: braços continuam indo pra frente + detecção de acerto
    if (now < this.punchUntil) {
      const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
      for (const h of ['forearmL', 'forearmR']) {
        this.parts[h].applyImpulse({ x: dir[0] * 26 * dt, y: 0, z: dir[2] * 26 * dt }, true);
      }
      if (!this.punchHit && this.opponent) {
        outer: for (let side = 0; side < 2; side++) {
          const tip = this.handTip(side);
          for (const pname of ['head', 'torso', 'pelvis']) {
            const tb = this.opponent.parts[pname];
            const tp = tb.translation();
            const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
            if (d < 0.48) {
              const strong = pname === 'head';
              tb.applyImpulse({ x: dir[0] * (strong ? 6.5 : 5), y: strong ? 2.2 : 1.5, z: dir[2] * (strong ? 6.5 : 5) }, true);
              this.opponent.stun(now + (strong ? 1.35 : 0.4));
              this.opponent.lastHitLandedAt = now;
              this.punchHit = true;
              break outer;
            }
          }
        }
      }
    }

    // Agarrar
    if (input.grab && !stunned && this.opponent) {
      const ot = this.opponent.parts.torso.translation();
      for (let side = 0; side < 2; side++) {
        if (this.grabJoints[side]) continue;
        const tip = this.handTip(side);
        let best = null, bestD = 0.5;
        for (const pname of ['head', 'torso', 'pelvis', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR']) {
          const tb = this.opponent.parts[pname];
          const tp = tb.translation();
          const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
          if (d < bestD) { bestD = d; best = tb; }
        }
        const hand = this.parts[side === 0 ? 'forearmL' : 'forearmR'];
        if (best) {
          const data = this.R.JointData.spherical({ x: 0, y: -0.12, z: 0 }, { x: 0, y: 0, z: 0 });
          this.grabJoints[side] = this.world.createImpulseJoint(data, hand, best, true);
        } else {
          // Estica os braços na direção do oponente
          const hp2 = hand.translation();
          const dx = ot.x - hp2.x, dy = ot.y + 0.2 - hp2.y, dz = ot.z - hp2.z;
          const dl = Math.hypot(dx, dy, dz) || 1;
          hand.applyImpulse({ x: (dx / dl) * 8 * dt, y: (dy / dl) * 8 * dt, z: (dz / dl) * 8 * dt }, true);
        }
      }
    } else if (this.grabJoints[0] || this.grabJoints[1]) {
      this.releaseGrabs();
    }
  }

  reset() {
    this.releaseGrabs();
    for (const spec of PARTS) {
      const b = this.parts[spec.name];
      b.setTranslation({ x: this.spawn.x + spec.off[0], y: spec.off[1], z: this.spawn.z + spec.off[2] }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.stunUntil = 0;
    this.punchReadyAt = 0;
    this.punchUntil = 0;
    this.punchHit = true;
    this.heading = this.heading0;
    this.gaitT = 0;
  }
}
