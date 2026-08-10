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
    this.rivals = []; // outros lutadores (briga livre: pode ter até 3)
    this.props = []; // corpos agarráveis/socáveis da arena (caixotes, bola…)
    this.stunUntil = 0;
    this.downUntil = 0;         // nocauteado: desaba mole por um tempo (dá pra arrastar)
    this.lastKnockdownAt = -10; // pra som/efeito de nocaute
    this.punchReadyAt = 0;
    this.punchUntil = 0;
    this.punchHit = true;
    this.jumpReadyAt = 0;
    this.hoverBlockUntil = 0;
    this.gaitT = 0;
    this.lastHitLandedAt = -10;
    this.lastPunchStartAt = -10;
    this.lastCabecadaAt = -10; // cabeçada (agarrar+soco)
    this.lastChuteAt = -10;    // chute (trás+soco)
    this.lastJumpAt = -10;
    this.lastGrabAt = -10;
    this.lastThrowAt = -10;
    this.lastDashAt = -10;
    this.lastEmoteAt = -10;
    this.grabJoints = [null, null];
    this._ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.controle = 1; // 0..1 — mapas de gelo reduzem a tração
    this.dano = 0; // nocaute acumulativo: apanhar seguido atordoa mais
    this.folego = 1; // cansaço: spam de soco esgota
    this.dashReadyAt = 0;
    this.emoteReadyAt = 0;
    this.stats = { socos: 0, acertos: 0, quedas: 0, pendurado: 0, arremessos: 0 };

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

  destroy() {
    this.releaseGrabs();
    for (const spec of PARTS) this.world.removeRigidBody(this.parts[spec.name]);
    this.parts = {};
    this.rivals = [];
  }

  stun(until) {
    this.stunUntil = Math.max(this.stunUntil, until);
    this.releaseGrabs();
  }

  isDowned(now) { return now < this.downUntil; }

  // NOCAUTE: desaba mole por um tempão (o oponente pode agarrar e arrastar).
  knockdown(now, dur = 3.6) {
    this.downUntil = Math.max(this.downUntil, now + dur);
    this.stunUntil = Math.max(this.stunUntil, this.downUntil); // fica mole o tempo todo
    this.lastKnockdownAt = now;
    this.releaseGrabs();
  }

  // arremesso=true (soltou de propósito): girando rápido, o que estava
  // agarrado sai voando com força extra proporcional ao giro.
  releaseGrabs(arremesso = false) {
    const spin = Math.min(Math.abs(this.parts.pelvis.angvel().y), 8);
    for (let i = 0; i < 2; i++) {
      const g = this.grabJoints[i];
      if (!g) continue;
      this.world.removeImpulseJoint(g.j, true);
      if (arremesso && spin > 2.5 && g.body && !g.chao) {
        const v = g.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z) || 1;
        const k = Math.min(spin * 1.3, 10);
        g.body.applyImpulse({ x: (v.x / sp) * k, y: (v.y / sp) * k + spin * 0.35, z: (v.z / sp) * k }, true);
        this.lastThrowAt = this._now ?? 0;
        this.stats.arremessos++;
      }
      this.grabJoints[i] = null;
    }
  }

  hangingOnLedge() {
    return this.grabJoints.some((g) => g && g.chao);
  }

  // Rival que está agarrado agora (pra cabeçada no agarrão), ou null.
  grabbedRival() {
    for (const g of this.grabJoints) if (g && g.rival && !g.rival.isDowned(this._now || 0)) return g.rival;
    for (const g of this.grabJoints) if (g && g.rival) return g.rival;
    return null;
  }

  // Ponta do pé (pra chute)
  footTip(side) {
    const calf = this.parts[side === 0 ? 'calfL' : 'calfR'];
    const p = calf.translation();
    const d = qrot(calf.rotation(), [0, -0.2, 0]);
    return [p.x + d[0], p.y + d[1], p.z + d[2]];
  }

  // Rival mais próximo (pela distância entre troncos)
  nearestRival() {
    const pp = this.parts.torso.translation();
    let best = null, bestD = Infinity;
    for (const r of this.rivals) {
      const rp = r.parts.torso.translation();
      const d = Math.hypot(rp.x - pp.x, rp.z - pp.z);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  // Distância até a superfície logo abaixo do quadril (chão, plataforma,
  // caixote, bola…), ou null se não tem nada em até 1.6m — aí despenca.
  groundToi() {
    const pp = this.parts.pelvis.translation();
    this._ray.origin.x = pp.x;
    this._ray.origin.y = pp.y;
    this._ray.origin.z = pp.z;
    const hit = this.world.castRay(this._ray, 1.6, true, undefined, (0x0010 << 16) | 0x0009);
    if (!hit) return null;
    return hit.timeOfImpact ?? hit.toi;
  }

  handTip(side) {
    const hand = this.parts[side === 0 ? 'forearmL' : 'forearmR'];
    const p = hand.translation();
    const d = qrot(hand.rotation(), [0, -0.14, 0]);
    return [p.x + d[0], p.y + d[1], p.z + d[2]];
  }

  // Investida de ombro (toque duplo na direção)
  dash(now) {
    if (now < this.dashReadyAt || this.isStunned(now)) return;
    this.dashReadyAt = now + 1.3;
    this.lastDashAt = now;
    this.hoverBlockUntil = Math.max(this.hoverBlockUntil, now + 0.15);
    const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
    this.parts.pelvis.applyImpulse({ x: dir[0] * 10, y: 1, z: dir[2] * 10 }, true);
    this.parts.torso.applyImpulse({ x: dir[0] * 6, y: 0.5, z: dir[2] * 6 }, true);
  }

  update(dt, now, input) {
    this._now = now;
    const stunned = this.isStunned(now);
    // Fim do nocaute: zera o dano pra não cair de novo na hora e levanta
    if (this.downUntil && now >= this.downUntil) { this.downUntil = 0; this.dano = 0.5; this.hoverBlockUntil = now; }
    // recuperação gradual: dano de combo esvai, fôlego volta (não some no nocaute)
    if (!this.isDowned(now)) this.dano = Math.max(0, this.dano - 0.25 * dt);
    this.folego = Math.min(1, this.folego + 0.22 * dt);
    if (this.hangingOnLedge()) this.stats.pendurado += dt;
    const pelvis = this.parts.pelvis;
    const pp = pelvis.translation();
    const pv = pelvis.linvel();
    const toi = stunned ? null : this.groundToi();
    const surfaceY = toi !== null ? pp.y - toi : 0;
    const grounded = toi !== null && toi < 1.25 && Math.abs(pv.y) < 3;

    // "Em pé" = anti-gravidade parcial + molas de marionete + torque de vertical.
    const standing = !stunned && toi !== null && now > this.hoverBlockUntil;
    if (standing) {
      for (const [name, a] of Object.entries(ANTIGRAV)) {
        const b = this.parts[name];
        b.applyImpulse({ x: 0, y: b.mass() * 9.81 * a * dt, z: 0 }, true);
      }
      // Quadril flutuante (alto o bastante pras pernas ficarem quase esticadas)
      const f = clamp((1.0 - toi) * 950 - pv.y * 95, -160, 650);
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
          const tr = 220 * this.controle;
          pelvis.applyImpulse({ x: nx * tr * dt, y: 0, z: nz * tr * dt }, true);
          this.parts.torso.applyImpulse({ x: nx * tr * 0.4 * dt, y: 0, z: nz * tr * 0.4 * dt }, true);
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
          const alvoY = surfaceY + 0.14 + ergue;
          const cp = calf.translation();
          const ponta = qrot(calf.rotation(), [0, -0.17, 0]);
          const cv = calf.linvel();
          const fx2 = clamp((alvoX - (cp.x + ponta[0])) * 26 - cv.x * 3, -18, 18);
          const fy2 = clamp((alvoY - (cp.y + ponta[1])) * 22 - cv.y * 4, -10, 14);
          const fz2 = clamp((alvoZ - (cp.z + ponta[2])) * 26 - cv.z * 3, -18, 18);
          calf.applyImpulse({ x: fx2 * dt, y: fy2 * dt, z: fz2 * dt }, true);
        }
        // Braços balançam no ritmo da passada (fase oposta à perna do mesmo lado)
        if (andando) {
          for (let lado = 0; lado < 2; lado++) {
            const braco = this.parts[lado === 0 ? 'forearmL' : 'forearmR'];
            const faseB = this.gaitT + (lado === 0 ? Math.PI : 0);
            const bal = Math.sin(faseB) * 4;
            braco.applyImpulse({ x: fwdX * bal * dt, y: 0, z: fwdZ * bal * dt }, true);
          }
        }
        // Guarda de boxe: inimigo perto → punhos sobem
        const rivalPerto = this.rivals.length ? this.nearestRival() : null;
        if (rivalPerto && now > this.punchUntil) {
          const op = rivalPerto.parts.torso.translation();
          if (Math.hypot(op.x - pp.x, op.z - pp.z) < 1.15) {
            for (const h of ['forearmL', 'forearmR']) {
              this.parts[h].applyImpulse({ x: fwdX * 2.5 * dt, y: 5 * dt, z: fwdZ * 2.5 * dt }, true);
            }
          }
        }
        // Freio: sem input, os pés plantados seguram o escorregão
        // (no gelo, controle baixo = freio fraco = patinação)
        if (!andando) {
          const fr = 90 * this.controle;
          const bx = clamp(-pv.x * fr, -220, 220);
          const bz = clamp(-pv.z * fr, -220, 220);
          pelvis.applyImpulse({ x: bx * dt, y: 0, z: bz * dt }, true);
        }
        // Emote: bracinhos pro alto + pulinho
        if (input.emote && now > this.emoteReadyAt) {
          this.emoteReadyAt = now + 1.6;
          this.lastEmoteAt = now;
          for (const h of ['forearmL', 'forearmR']) this.parts[h].applyImpulse({ x: 0, y: 3, z: 0 }, true);
          pelvis.applyImpulse({ x: 0, y: 5, z: 0 }, true);
        }
      }
      // Pulo
      if (input.jump && grounded && now > this.jumpReadyAt) {
        this.jumpReadyAt = now + 0.7;
        this.hoverBlockUntil = now + 0.4;
        this.lastJumpAt = now;
        pelvis.applyImpulse({ x: 0, y: 20, z: 0 }, true);
        this.parts.torso.applyImpulse({ x: 0, y: 12, z: 0 }, true);
      }
      // Ataques com o botão de soco: CABEÇADA (agarrando), CHUTE (segurando trás) ou SOCO
      if (input.punch && now >= this.punchReadyAt) {
        const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
        const alvoAgarrado = this.grabbedRival();
        const querChute = grounded && input.move && input.move.z > 0.5; // segurar p/ trás/baixo + soco
        if (alvoAgarrado) {
          // CABEÇADA: puxa o inimigo agarrado e dá uma cabeçada (enche o nocaute rápido)
          this.punchReadyAt = now + 0.6;
          this.lastCabecadaAt = now;
          this.folego = Math.max(0, this.folego - 0.15);
          const mh = this.parts.head.translation();
          const rb = alvoAgarrado.parts.head, rh = rb.translation();
          const ddx = rh.x - mh.x, ddz = rh.z - mh.z, dl = Math.hypot(ddx, ddz) || 1;
          this.parts.head.applyImpulse({ x: (ddx / dl) * 5, y: 1.2, z: (ddz / dl) * 5 }, true);
          rb.applyImpulse({ x: (ddx / dl) * 7, y: 2.4, z: (ddz / dl) * 7 }, true);
          alvoAgarrado.dano = Math.min(4, alvoAgarrado.dano + 2); // cabeçada dói o dobro
          alvoAgarrado.stun(now + Math.min(2.6, 1.2 * (1 + alvoAgarrado.dano * 0.35)));
          if (alvoAgarrado.dano >= 4 && !alvoAgarrado.isDowned(now)) alvoAgarrado.knockdown(now);
          alvoAgarrado.lastHitLandedAt = now;
          this.stats.acertos++;
        } else {
          this._socoFraco = this.folego < 0.3;
          this.folego = Math.max(0, this.folego - (querChute ? 0.4 : 0.34));
          this._voadora = !grounded;
          this._chute = querChute;
          this.punchReadyAt = now + (this._socoFraco ? 1.3 : querChute ? 0.95 : 0.8);
          this.punchUntil = now + (this._voadora ? 0.32 : querChute ? 0.3 : 0.25);
          this.punchHit = false;
          this.lastPunchStartAt = now;
          if (querChute) this.lastChuteAt = now;
          this.stats.socos++;
          if (querChute) {
            // CHUTE: joga uma perna pra frente (a janela detecta o pé no rival)
            this._chutePerna = this._chutePerna === 'calfL' ? 'calfR' : 'calfL';
            const perna = this.parts[this._chutePerna];
            perna.applyImpulse({ x: dir[0] * 9, y: 3.2, z: dir[2] * 9 }, true);
            this.parts.torso.applyImpulse({ x: -dir[0] * 1.5, y: 0, z: -dir[2] * 1.5 }, true);
          } else {
            const forca = this._socoFraco ? 3.5 : 7;
            for (const h of ['forearmL', 'forearmR']) {
              this.parts[h].applyImpulse({ x: dir[0] * forca, y: 1.2, z: dir[2] * forca }, true);
            }
          }
          if (this._voadora) {
            // tackle: o corpo inteiro vai junto — e depois desaba (risco × recompensa)
            this.parts.torso.applyImpulse({ x: dir[0] * 6, y: 0.5, z: dir[2] * 6 }, true);
            pelvis.applyImpulse({ x: dir[0] * 5, y: 0, z: dir[2] * 5 }, true);
            this.hoverBlockUntil = Math.max(this.hoverBlockUntil, now + 0.7);
          }
        }
      }
    }

    // Janela do golpe: o membro continua indo pra frente + detecção de acerto.
    // Soco = punhos; chute = a perna chutando (this._chutePerna).
    if (now < this.punchUntil) {
      const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
      if (this._chute) {
        this.parts[this._chutePerna].applyImpulse({ x: dir[0] * 30 * dt, y: 2 * dt, z: dir[2] * 30 * dt }, true);
      } else {
        for (const h of ['forearmL', 'forearmR']) {
          this.parts[h].applyImpulse({ x: dir[0] * 26 * dt, y: 0, z: dir[2] * 26 * dt }, true);
        }
      }
      if (!this.punchHit && this.rivals.length) {
        // pontos que golpeiam: chute = ponta do pé; soco = as duas mãos
        const tips = this._chute
          ? [this.footTip(this._chutePerna === 'calfL' ? 0 : 1)]
          : [this.handTip(0), this.handTip(1)];
        const alc = this._chute ? 0.56 : 0.48;
        outer: for (const tip of tips) {
          for (const rival of this.rivals) {
            for (const pname of ['head', 'torso', 'pelvis']) {
              const tb = rival.parts[pname];
              const tp = tb.translation();
              const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
              if (d < alc) {
                const strong = pname === 'head';
                const fator = (this._voadora ? 1.35 : 1) * (this._socoFraco ? 0.55 : 1) * (this._chute ? 1.3 : 1);
                tb.applyImpulse({
                  x: dir[0] * (strong ? 6.5 : 5) * fator,
                  y: (this._chute ? 1.0 : (strong ? 2.2 : 1.5)) * fator, // chute empurra mais reto (bom p/ ring-out)
                  z: dir[2] * (strong ? 6.5 : 5) * fator,
                }, true);
                // nocaute acumulativo: combo atordoa cada vez mais
                rival.dano = Math.min(4, rival.dano + 1);
                const dur = Math.min(2.6, (strong ? 1.35 : 0.4) * (1 + rival.dano * 0.35) * fator);
                rival.stun(now + dur);
                // Encheu o dano => NOCAUTE: desaba mole (dá pra agarrar e arrastar)
                if (rival.dano >= 4 && !rival.isDowned(now)) rival.knockdown(now);
                rival.lastHitLandedAt = now;
                this.stats.acertos++;
                this.punchHit = true;
                break outer;
              }
            }
          }
          // Objetos da arena também levam o golpe
          for (const pb of this.props) {
            const tp = pb.translation();
            const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
            if (d < 0.75) {
              pb.applyImpulse({ x: dir[0] * 6, y: 2, z: dir[2] * 6 }, true);
              this.punchHit = true;
              break outer;
            }
          }
        }
      }
    }

    // Agarrar
    if (input.grab && !stunned) {
      const rivalGrab = this.rivals.length ? this.nearestRival() : null;
      const ot = rivalGrab ? rivalGrab.parts.torso.translation() : null;
      const alvoCaido = !!(rivalGrab && rivalGrab.isDowned(now)); // alcance maior p/ pegar o corpo mole no chão
      const situacaoBeirada = toi === null || pp.y < 0.55;
      for (let side = 0; side < 2; side++) {
        if (this.grabJoints[side]) continue;
        const tip = this.handTip(side);
        let best = null, bestD = alvoCaido ? 1.0 : 0.5, bestRival = null;
        for (const rival of this.rivals) {
          for (const pname of ['head', 'torso', 'pelvis', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR']) {
            const tb = rival.parts[pname];
            const tp = tb.translation();
            const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
            if (d < bestD) { bestD = d; best = tb; bestRival = rival; }
          }
        }
        // Objetos da arena (caixote, bola, ARMAS…): íman de pickup — alcance bem
        // maior que agarrar rival, pra pegar arma do chão sem precisar mirar fino.
        for (const pb of this.props) {
          const tp = pb.translation();
          const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z) - 0.35;
          const lim = best ? bestD : 1.0; // sem rival por perto, agarra prop até ~1m
          if (d < lim) { bestD = d; best = pb; bestRival = null; }
        }
        const hand = this.parts[side === 0 ? 'forearmL' : 'forearmR'];
        if (best) {
          const data = this.R.JointData.spherical({ x: 0, y: -0.12, z: 0 }, { x: 0, y: 0, z: 0 });
          this.grabJoints[side] = { j: this.world.createImpulseJoint(data, hand, best, true), body: best, chao: false, rival: bestRival };
          this.lastGrabAt = now;
        } else if (situacaoBeirada && this.world.projectPoint) {
          // Caindo perto da plataforma: a mão gruda na beirada
          const proj = this.world.projectPoint(
            { x: tip[0], y: tip[1], z: tip[2] }, true, undefined, (0x0010 << 16) | 0x0001,
          );
          if (proj && proj.collider) {
            const pt = proj.point;
            const d = Math.hypot(tip[0] - pt.x, tip[1] - pt.y, tip[2] - pt.z);
            if (d < 0.26) {
              const gb = proj.collider.parent();
              const gt = gb.translation();
              const gr = gb.rotation();
              const loc = qrot(
                { x: -gr.x, y: -gr.y, z: -gr.z, w: gr.w },
                [pt.x - gt.x, pt.y - gt.y, pt.z - gt.z],
              );
              const data = this.R.JointData.spherical(
                { x: 0, y: -0.12, z: 0 },
                { x: loc[0], y: loc[1], z: loc[2] },
              );
              this.grabJoints[side] = { j: this.world.createImpulseJoint(data, hand, gb, true), body: gb, chao: true };
              this.lastGrabAt = now;
            }
          }
        } else if (!situacaoBeirada && ot) {
          // Estica os braços na direção do oponente
          const hp2 = hand.translation();
          const dx = ot.x - hp2.x, dy = ot.y + 0.2 - hp2.y, dz = ot.z - hp2.z;
          const dl = Math.hypot(dx, dy, dz) || 1;
          hand.applyImpulse({ x: (dx / dl) * 8 * dt, y: (dy / dl) * 8 * dt, z: (dz / dl) * 8 * dt }, true);
        }
      }
      // Pendurado na beirada: alívio pro braço aguentar o corpo
      if (this.hangingOnLedge()) {
        this.parts.torso.applyImpulse({ x: 0, y: 55 * dt, z: 0 }, true);
        pelvis.applyImpulse({ x: 0, y: 30 * dt, z: 0 }, true);
        // Pulo = se içar de volta
        if (input.jump && now > this.jumpReadyAt) {
          this.jumpReadyAt = now + 0.8;
          this.lastJumpAt = now;
          this.releaseGrabs();
          this.hoverBlockUntil = now + 0.25;
          pelvis.applyImpulse({ x: 0, y: 24, z: 0 }, true);
          this.parts.torso.applyImpulse({ x: 0, y: 14, z: 0 }, true);
        }
      }
    } else if (this.grabJoints[0] || this.grabJoints[1]) {
      this.releaseGrabs(true);
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
    this.downUntil = 0;
    this.dano = 0;
    this.punchReadyAt = 0;
    this.punchUntil = 0;
    this.punchHit = true;
    this.heading = this.heading0;
    this.gaitT = 0;
  }
}
