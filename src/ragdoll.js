// Ragdoll ativo (física pura, sem DOM/three) — recebe o módulo RAPIER e o world.
// O boneco fica em pé por "molas de marionete": uma corda invisível puxa a cabeça
// pra cima e o quadril flutua na altura certa. Nocaute = desligar as molas.
import { AJUSTES } from './ajustes.js';

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

// Cada junta agora tem CURSO. Antes era tudo `spherical`, que prende dois pontos
// e libera 360° nos três eixos — o cotovelo dobrava pro lado errado, o joelho
// invertia e o braço girava infinito (era ele que parecia cata-vento em jogo).
//
//   eixo   = eixo da dobradiça / do giro principal
//   limite = [min, max] em radianos, ou null pra junta sem curso definido
//   trava  = graus de liberdade CONGELADOS (junta generic); a torção entra aqui
//
// Pegadinha do Rapier: JointData.revolute ignora os campos limits/limitsEnabled
// do descritor. O limite só pega chamando setLimits() na junta JÁ CRIADA.
// E `spherical` não aceita limite nem motor — foram removidos no alpha e seguem
// sem funcionar, por isso a mudança é de TIPO de junta, não de parâmetro.
const JOINTS = [
  // ombro/quadril/pescoço: 2 eixos livres, TORÇÃO travada
  ['pelvis', 'torso',     [0, 0.17, 0],      [0, -0.16, 0],  'gen', [0, 1, 0], [-0.5, 0.5]],
  ['torso',  'head',      [0, 0.18, 0],      [0, -0.16, 0],  'gen', [0, 1, 0], [-0.7, 0.7]],
  ['torso',  'upperArmL', [-0.27, 0.11, 0],  [0, 0.12, 0],   'gen', [0, 1, 0], null],
  ['torso',  'upperArmR', [0.27, 0.11, 0],   [0, 0.12, 0],   'gen', [0, 1, 0], null],
  ['pelvis', 'thighL',    [-0.10, -0.16, 0], [0, 0.20, 0],   'gen', [0, 1, 0], null],
  ['pelvis', 'thighR',    [0.10, -0.16, 0],  [0, 0.20, 0],   'gen', [0, 1, 0], null],
  // cotovelo/joelho: dobradiça de eixo único, dobra pra um lado só
  ['upperArmL', 'forearmL', [0, -0.13, 0],   [0, 0.13, 0],   'hinge', [1, 0, 0], [-0.15, 2.4]], // sinal do curso descoberto por teste: invertido, o braço fica dobrado e o soco não alcança
  ['upperArmR', 'forearmR', [0, -0.13, 0],   [0, 0.13, 0],   'hinge', [1, 0, 0], [-0.15, 2.4]],
  ['thighL', 'calfL',     [0, -0.18, 0],     [0, 0.16, 0],   'hinge', [1, 0, 0], [-1.1, 1.1]],
  ['thighR', 'calfR',     [0, -0.18, 0],     [0, 0.16, 0],   'hinge', [1, 0, 0], [-1.1, 1.1]],
];

// Limites da plataforma — fora disso as molas desligam e o boneco despenca.
export const ARENA = { halfX: 5.5, halfZ: 4.0 };

// Dano acumulado que derruba (nocaute). Estava espalhado como "4" em 17 lugares
// entre cliente e servidor; virou constante pra os dois não descolarem. Subir
// este número = luta mais longa. Calibrado por simulação: 26 dá rodada de ~34s.
// O dano decai 0.12/s: trocação parada não acumula, precisa de pressão contínua.
export const DANO_KO = 26;

// Fração do peso de cada parte que é "segurada" pela marionete enquanto em pé.
const ANTIGRAV = {
  // Era 0.8 no miolo: 80% da gravidade anulada deixava o corpo sem peso, e o
  // boneco lia como marionete em vez de corpo. Menos anti-gravidade = o tronco
  // afunda no passo, assenta na parada, e o golpe tem onde repercutir.
  // Era 0.8 no miolo, quando o esqueleto não tinha junta e precisava ser
  // segurado no ar. Com curso nas juntas o corpo se sustenta, então a muleta
  // pode cair: menos antigravidade = o tronco afunda no passo, assenta na
  // parada e o golpe tem onde repercutir. Verificado que continua em pé até
  // 0.22, mas aí o pé começa a enterrar; 0.45 é o passo firme sem estragar.
  pelvis: 0.45, torso: 0.42, head: 0.40,
  upperArmL: 0.24, upperArmR: 0.24, forearmL: 0.2, forearmR: 0.2,
  thighL: 0.15, thighR: 0.15, calfL: 0.15, calfR: 0.15,
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
  constructor(R, world, { x = 0, z = 0, heading = 0, memberships, filter, owner = null, onCollider = null }) {
    this.R = R;
    this.world = world;
    this.owner = owner; // id do dono (pra filtro de contato: partes do mesmo dono não colidem)
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
    // Golpe carregado: toque = soco normal; segurar carrega o SOCÃO (solta no release)
    this._punchHeld = false;
    this._carga = 0;        // 0..1 — carga atual (o cliente desenha faíscas)
    this._cargaDesde = -1;
    this._cargaGolpe = 0;   // carga do golpe em voo (multiplica o knockback)
    this.jumpReadyAt = 0;
    this._jumpPrev = false; this._pulosAr = 0; // duplo pulo
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
    this.forcaSoco = 1; // multiplicador de força do soco (Kaiju bate mais forte)
    this.resistencia = 1; // aguenta mais tranco: reduz knockback e acúmulo de dano
    this.escudo = 0; this.lastEscudoAt = -10;  // power-up escudo 🛡️: absorve o próximo golpe
    this.buffVel = 1; this.buffVelAte = 0;     // power-up de velocidade (temporário)
    this.buffForca = 1; this.buffForcaAte = 0; // power-up de força (temporário)
    this.dano = 0; // nocaute acumulativo: apanhar seguido atordoa mais
    this.folego = 1; // cansaço: spam de soco esgota
    this._agr = null; this._agrAt = -10; // último agressor (pra "melhor jogada")
    this.dashReadyAt = 0;
    this.esquivaReadyAt = 0;   // cooldown da esquiva
    this.esquivaUntil = 0;     // janela de invencibilidade (i-frames)
    this.lastEsquivaAt = -10;
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
      if (owner != null) cd.setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS);
      const col = world.createCollider(cd, body);
      if (onCollider) onCollider(col, spec);
      body.__rag = this; // quem arremessa precisa achar o corpo INTEIRO do alvo,
      this.parts[spec.name] = body; // não só o membro que estava agarrado
    }
    for (const [a, b, aa, ab, tipo, eixo, limite] of JOINTS) {
      const p1 = { x: aa[0], y: aa[1], z: aa[2] }, p2 = { x: ab[0], y: ab[1], z: ab[2] };
      const ax = { x: eixo[0], y: eixo[1], z: eixo[2] };
      let data;
      if (tipo === 'hinge') {
        data = R.JointData.revolute(p1, p2, ax);
      } else {
        // generic travando as 3 translações + a TORÇÃO em torno do eixo do membro:
        // sobram 2 eixos de giro, que é o que ombro e quadril de verdade fazem
        const M = R.JointAxesMask;
        data = R.JointData.generic(p1, p2, ax, M.LinX | M.LinY | M.LinZ | M.AngY);
      }
      const j = world.createImpulseJoint(data, this.parts[a], this.parts[b], true);
      if (limite && typeof j.setLimits === 'function') j.setLimits(limite[0], limite[1]);
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
      if (arremesso && spin > 1.0 && g.body && !g.chao) {
        // 🥊 ARREMESSO POR CIMA DA CORDA. Com o ringue fechado, esta é a única
        // forma de tirar o rival da arena — então o lançamento precisa vencer
        // uma corda de 0.9 m. Medido no harness: impulso vertical ~22 é o
        // mínimo que passa por cima. Girar mais joga mais longe; giro fraco
        // (perto de 2.5) só empurra, não ejeta — o arremesso tem que ser
        // merecido. Vai no tronco+quadril+cabeça pra levantar o corpo inteiro,
        // senão só o membro agarrado sobe e o resto fica pendurado.
        // Direção do arremesso = pra onde QUEM ARREMESSA está olhando. Antes
        // usava a velocidade do corpo agarrado normalizada, mas corpo mole
        // parado tem velocidade ~0: a direção virava ruído e o rival era
        // lançado pra qualquer lado, quase sempre de volta pra dentro. Mirar
        // pelo heading é o que o jogador espera e o que torna a jogada uma
        // JOGADA, não sorteio.
        const dirA = [Math.sin(this.heading), Math.cos(this.heading)];
        // Com o ringue fechado o ARREMESSO é a única forma de pontuar, então
        // ele precisa ser confiável: a perícia já está em nocautear e agarrar,
        // não em conseguir rodopiar. Base fixa que vence a corda de 0.9 m
        // (medido: 22 de impulso vertical é o mínimo que passa), e o giro
        // adiciona alcance por cima disso.
        const k = Math.min(6 + spin * 1.8, 16);
        const alto = 24 + Math.min(spin, 8) * 1.6;
        const dono = g.body.__rag ?? null;
        const alvos = dono ? ['torso', 'pelvis', 'head'].map((n) => dono.parts[n]) : [g.body];
        for (const b of alvos) {
          if (!b) continue;
          b.applyImpulse({ x: dirA[0] * k, y: alto, z: dirA[1] * k }, true);
        }
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

  // Durante a esquiva o lutador fica invencível (golpes e tiros atravessam)
  isEsquivando(now) { return now < this.esquivaUntil; }

  // Esquiva: rolamento evasivo rápido com breve invencibilidade (i-frames).
  // Vai pra onde estiver segurando; parado, rola pra trás.
  esquiva(now, mx = 0, mz = 0) {
    if (now < this.esquivaReadyAt || this.isStunned(now)) return;
    this.esquivaReadyAt = now + 1.0;
    this.lastEsquivaAt = now;
    this.esquivaUntil = now + 0.4;
    this.hoverBlockUntil = Math.max(this.hoverBlockUntil, now + 0.12);
    let dx = mx, dz = mz;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.2) { dx /= mag; dz /= mag; }
    else { dx = -Math.sin(this.heading); dz = -Math.cos(this.heading); } // parado => pra trás
    const p = this.parts.pelvis, v = p.linvel();
    p.setLinvel({ x: v.x * 0.3, y: v.y, z: v.z * 0.3 }, true); // corta a velocidade atual pro impulso ser limpo
    p.applyImpulse({ x: dx * 12, y: 1.5, z: dz * 12 }, true);
    this.parts.torso.applyImpulse({ x: dx * 6, y: 0.5, z: dz * 6 }, true);
    p.applyTorqueImpulse({ x: dz * 3, y: 0, z: -dx * 3 }, true); // giro de rolamento
  }

  update(dt, now, input) {
    this._now = now;
    const stunned = this.isStunned(now);
    // Buffs de power-up expiram
    if (now > this.buffVelAte) this.buffVel = 1;
    if (now > this.buffForcaAte) this.buffForca = 1;
    // 🧯 FREIO DE LANÇAMENTO (ideia do Smash: a velocidade de lançamento decai
    // 0.051 por frame). O golpe pode dar um tranco forte — que é o que se VÊ —
    // porque logo depois o freio come a sobra e a distância fica curta. Sem isso
    // "pancada visível" e "não mandar pra fora" eram o mesmo botão, e um sempre
    // estragava o outro.
    if (this._freioAte != null) {
      const freando = now < this._freioAte;
      if (freando !== this._freando) {
        this._freando = freando;
        for (const pn of ['torso', 'pelvis', 'head']) this.parts[pn]?.setLinearDamping(freando ? 3.4 : 0.3);
      }
    }
    // Fim do nocaute: zera o dano pra não cair de novo na hora e levanta
    if (this.downUntil && now >= this.downUntil) { this.downUntil = 0; this.dano = 0.5; this.hoverBlockUntil = now; }
    // recuperação gradual: dano de combo esvai, fôlego volta (não some no nocaute)
    if (!this.isDowned(now)) this.dano = Math.max(0, this.dano - 0.12 * dt);
    this.folego = Math.min(1, this.folego + 0.22 * dt);
    if (this.hangingOnLedge()) this.stats.pendurado += dt;
    const pelvis = this.parts.pelvis;
    const pp = pelvis.translation();
    const pv = pelvis.linvel();
    const toi = stunned ? null : this.groundToi();
    const surfaceY = toi !== null ? pp.y - toi : 0;
    const grounded = toi !== null && toi < 1.25 && Math.abs(pv.y) < 3;

    // Duplo pulo: 1 pulo extra no ar (detecta o clique, não o segurar).
    if (grounded) this._pulosAr = 0;
    const jumpEdge = input.jump && !this._jumpPrev;
    this._jumpPrev = input.jump;
    if (jumpEdge && !grounded && !stunned && (this._pulosAr || 0) < 1) {
      this._pulosAr = (this._pulosAr || 0) + 1;
      this.lastJumpAt = now;
      this.hoverBlockUntil = now + 0.35;
      const v = pelvis.linvel();
      if (v.y < 0) pelvis.setLinvel({ x: v.x, y: 0, z: v.z }, true); // corta a queda pro pulo dar impulso limpo
      pelvis.applyImpulse({ x: 0, y: 17, z: 0 }, true);
      this.parts.torso.applyImpulse({ x: 0, y: 10, z: 0 }, true);
    }

    // "Em pé" = anti-gravidade parcial + molas de marionete + torque de vertical.
    const standing = !stunned && toi !== null && now > this.hoverBlockUntil;
    if (standing) {
      for (const [name, a] of Object.entries(ANTIGRAV)) {
        const b = this.parts[name];
        b.applyImpulse({ x: 0, y: b.mass() * 9.81 * a * dt, z: 0 }, true);
      }
      // Quadril flutuante. Era 1.0, mas a perna esticada só alcança 0.88 abaixo do
      // quadril. Com as juntas ganhando curso a perna passou a sustentar de outro
      // jeito. Remedido de novo ao baixar a antigravidade (corpo mais pesado afunda
      // mais): 1.03 põe o pé no chão sem enterrar.
      const f = clamp((1.03 - toi) * 950 - pv.y * 95, -160, 650);
      pelvis.applyImpulse({ x: 0, y: f * dt, z: 0 }, true);
      // Corda na cabeça
      const head = this.parts.head;
      const hp = head.translation();
      const hv = head.linvel();
      const fx = clamp((pp.x - hp.x) * 130 - hv.x * 8, -220, 220);
      const fy = clamp((pp.y + 0.68 - hp.y) * 300 - hv.y * 17, -100, 520);
      const fz = clamp((pp.z - hp.z) * 130 - hv.z * 8, -220, 220);
      head.applyImpulse({ x: fx * dt, y: fy * dt, z: fz * dt }, true);
      // Tronco acompanha
      const torso = this.parts.torso;
      const tp = torso.translation();
      const tv = torso.linvel();
      const ty = clamp((pp.y + 0.34 - tp.y) * 240 - tv.y * 16, -100, 420);
      torso.applyImpulse({ x: 0, y: ty * dt, z: 0 }, true);
      // Torque que segura o corpo na vertical (senão tomba pro lado)
      for (const bname of ['pelvis', 'torso']) {
        const b = this.parts[bname];
        const up = qrot(b.rotation(), [0, 1, 0]);
        const av2 = b.angvel();
        const tx = clamp((up[1] >= 0 ? 1 : 0.3) * (-up[2] * 15) - av2.x * 1.9, -13, 13);
        const tz = clamp((up[1] >= 0 ? 1 : 0.3) * (up[0] * 15) - av2.z * 1.9, -13, 13);
        b.applyTorqueImpulse({ x: tx * dt, y: 0, z: tz * dt }, true);
      }
    }
    if (!stunned) {
      // Movimento
      const mx = input.move.x, mz = input.move.z;
      const mlen = Math.hypot(mx, mz);
      if (mlen > 0.01) {
        let nx = mx / mlen, nz = mz / mlen;
        // 🧱 CAMBALEIO: com muito dano o boneco anda torto (sway senoidal) —
        // todo mundo vê de longe quem está quase caindo, e fugir cambaleando é cômico
        let grogue = 1;
        if (this.dano >= DANO_KO * 0.6) {
          const s = Math.sin(now * 6.5 + (this._seedCamb ??= Math.random() * 6.3)) * 0.4 * Math.min(1, (this.dano - DANO_KO * 0.55) / (DANO_KO * 0.4));
          const px = nx - nz * s, pz = nz + nx * s, pl = Math.hypot(px, pz) || 1;
          nx = px / pl; nz = pz / pl;
          grogue = 0.9;
        }
        this.heading = Math.atan2(nx, nz);
        const speedAlong = pv.x * nx + pv.z * nz;
        if (speedAlong < 2.4) {
          const tr = 220 * grogue * this.controle * (this.buffVel || 1) * (this._carga > 0.1 ? 0.55 : 1);
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
      // Passinhos. Cada perna alterna BALANÇO (no ar, mirando onde vai pisar) e
      // APOIO (pegada cravada no MUNDO, o corpo passa por cima dela).
      //
      // Antes o alvo do pé era relativo ao quadril nos dois momentos, então ele
      // andava junto com o corpo e nunca ficava parado no chão — patinação por
      // construção. E o alvo vertical era surfaceY+0.14 pros dois pés ao mesmo
      // tempo, o que erguia os dois juntos: 8.5 cm de chão andando, o "flutuando".
      if (standing) {
        const andando = mlen > 0.01;
        // Cadência e passada acompanham a velocidade REAL. Fixo em 8 rad/s com
        // passo de 0.2, o pé cobria 0.56 m/s enquanto o corpo ia a 3.7 — 6.6x de
        // descompasso, e nenhuma pegada segura isso. Em ~1 m/s dá os mesmos 8 de
        // antes, então andar devagar continua igual.
        const vel = Math.hypot(pv.x, pv.z);
        const amp = clamp(0.16 + vel * 0.06, 0.16, 0.34);       // passo cresce ao correr
        this.gaitT += dt * (andando ? clamp(vel * 7.2, 5, 20) : 0);
        const fwdX = Math.sin(this.heading), fwdZ = Math.cos(this.heading);
        const latX = Math.cos(this.heading), latZ = -Math.sin(this.heading);
        this._pegada ??= [null, null];
        for (let lado = 0; lado < 2; lado++) {
          const calf = this.parts[lado === 0 ? 'calfL' : 'calfR'];
          const fase = this.gaitT + (lado === 0 ? 0 : Math.PI);
          const s = Math.sin(fase);
          const noAr = andando && s > 0; // meio ciclo no ar, meio apoiando
          const latOff = lado === 0 ? -0.11 : 0.11;
          const cp = calf.translation();
          const ponta = qrot(calf.rotation(), [0, -0.17, 0]);
          const pex = cp.x + ponta[0], pez = cp.z + ponta[2];
          let alvoX, alvoZ, ergue;
          if (!andando) {
            this._pegada[lado] = null;
            alvoX = pp.x + latX * latOff;
            alvoZ = pp.z + latZ * latOff;
            ergue = 0;
          } else if (noAr) {
            // BALANÇO: mira à frente do quadril, já descontando o quanto o corpo
            // ainda anda até o pé encostar (senão pisa sempre atrás e arrasta)
            this._pegada[lado] = null;
            alvoX = pp.x + latX * latOff + fwdX * amp * 1.1 + pv.x * 0.12;
            alvoZ = pp.z + latZ * latOff + fwdZ * amp * 1.1 + pv.z * 0.12;
            ergue = s * 0.13;
          } else {
            // APOIO: crava a pegada na 1ª vez e segura ali. Se o corpo já passou
            // longe demais, solta e repisa — senão a perna estica e vira freio.
            const marca = this._pegada[lado];
            if (marca && Math.hypot(marca.x - pp.x, marca.z - pp.z) > 0.35 + amp * 1.6) this._pegada[lado] = null;
            this._pegada[lado] ??= { x: pex, z: pez };
            alvoX = this._pegada[lado].x;
            alvoZ = this._pegada[lado].z;
            ergue = 0;
          }
          // 0.045: a ponta encosta de verdade. O 0.14 antigo era alto demais e
          // segurava os dois pés no ar mesmo em apoio.
          const apoiando = andando && !noAr;
          // pé de apoio empurra CONTRA o chão (alvo abaixo da superfície) pra
          // encostar de verdade; no balanço ele sobe. Antes os dois ficavam a
          // surfaceY+0.14 ao mesmo tempo e o boneco pairava.
          const alvoY = surfaceY + (apoiando ? -0.02 : 0.045) + ergue;
          const cv = calf.linvel();
          const fx2 = clamp((alvoX - pex) * 26 - cv.x * 3, -18, 18);
          const fy2 = clamp((alvoY - (cp.y + ponta[1])) * 22 - cv.y * 4, apoiando ? -20 : -10, 14);
          const fz2 = clamp((alvoZ - pez) * 26 - cv.z * 3, -18, 18);
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
      // Ataques com o botão de soco: CABEÇADA (agarrando), CHUTE (segurando trás) ou SOCO.
      // Só no APERTO (segurar não repete mais): segurando, carrega o SOCÃO — solta no release.
      // NOTA DA JANELA DO GOLPE: era 0.25s, calibrado pra um braço de juntas
      // esféricas que chicoteava sem resistência — o punho chegava no alvo no
      // frame 3. Com juntas de curso o braço tem inércia e só chega no frame 23,
      // então a janela fechava ANTES do soco e nada conectava. 0.36s cobre a
      // viagem real. Se mexer na rigidez das juntas, remeça isto.
      if (input.punch && !this._punchHeld && now >= this.punchReadyAt) {
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
          alvoAgarrado.dano = Math.min(DANO_KO, alvoAgarrado.dano + 2); // cabeçada dói o dobro
          alvoAgarrado.stun(now + Math.min(2.6, 1.2 * (1 + alvoAgarrado.dano * (1.4 / DANO_KO))));
          if (alvoAgarrado.dano >= DANO_KO && !alvoAgarrado.isDowned(now)) alvoAgarrado.knockdown(now);
          alvoAgarrado.lastHitLandedAt = now;
          this.stats.acertos++;
        } else {
          this._socoFraco = this.folego < 0.3;
          this.folego = Math.max(0, this.folego - (querChute ? 0.4 : 0.34));
          this._voadora = !grounded;
          this._chute = querChute;
          this.punchReadyAt = now + (this._socoFraco ? 1.3 : querChute ? 0.95 : 0.8);
          this.punchUntil = now + (this._voadora ? 0.43 : querChute ? 0.41 : 0.36); // ver nota da janela
          this.punchHit = false;
          this._cargaGolpe = 0;
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
      // ---- SOCÃO carregado: continuar segurando (sem rival agarrado/arma) carrega ----
      const seguraCoisa = this.grabJoints && this.grabJoints.some((g) => g);
      // carrega já durante o cooldown do soco do toque (só a SOLTURA espera o cooldown);
      // 0.12s de tolerância pra toque rápido não acender faísca
      if (input.punch && this._punchHeld && !this.grabbedRival() && !seguraCoisa) {
        if (this._cargaDesde < 0) this._cargaDesde = now;
        this._carga = Math.min(1, Math.max(0, now - this._cargaDesde - 0.12) / 0.7);
      }
      if (!input.punch && this._punchHeld) {
        if (this._carga > 0.25 && now >= this.punchReadyAt) {
          // solta o SOCÃO: pancada com corpo junto, knockback escala com a carga
          const dir = [Math.sin(this.heading), 0, Math.cos(this.heading)];
          this._socoFraco = false;
          this._voadora = !grounded;
          this._chute = false;
          this._cargaGolpe = this._carga;
          this.folego = Math.max(0, this.folego - (0.34 + this._carga * 0.2));
          this.punchReadyAt = now + 1.05;
          this.punchUntil = now + 0.30;
          this.punchHit = false;
          this.lastPunchStartAt = now;
          this.stats.socos++;
          const forca = 7 * (1 + this._carga * 0.9);
          for (const h of ['forearmL', 'forearmR']) this.parts[h].applyImpulse({ x: dir[0] * forca, y: 1.4, z: dir[2] * forca }, true);
          this.parts.torso.applyImpulse({ x: dir[0] * 3 * this._carga, y: 0.3, z: dir[2] * 3 * this._carga }, true);
          pelvis.applyImpulse({ x: dir[0] * 2.5 * this._carga, y: 0, z: dir[2] * 2.5 * this._carga }, true);
        }
        this._carga = 0; this._cargaDesde = -1;
      }
      this._punchHeld = input.punch;
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
            if (rival.isEsquivando(now)) continue; // i-frames: o golpe atravessa
            for (const pname of ['head', 'torso', 'pelvis']) {
              const tb = rival.parts[pname];
              const tp = tb.translation();
              const d = Math.hypot(tip[0] - tp.x, tip[1] - tp.y, tip[2] - tp.z);
              if (d < alc) {
                if (rival.escudo > 0) { // 🛡️ o escudo come o golpe inteiro (uma vez)
                  rival.escudo = 0;
                  rival.lastEscudoAt = now;
                  this.punchHit = true;
                  break outer;
                }
                const strong = pname === 'head';
                // forcaSoco = quão forte ESTE lutador bate; resistencia = quanto o RIVAL aguenta
                const kb = (this.forcaSoco || 1) * (this.buffForca || 1) * (AJUSTES.forcaSoco || 1) / (rival.resistencia || 1);
                const fator = (this._voadora ? 1.35 : 1) * (this._socoFraco ? 0.55 : 1) * (this._chute ? 1.3 : 1) * (1 + (this._cargaGolpe || 0) * 1.1) * kb;
                // 🎯 O empurrão CRESCE COM O DANO do rival (ideia do Smash).
                // Rival inteiro quase não sai do lugar, então o começo da luta é
                // trocação de perto em vez de "um soco e já voou pra fora"; quem
                // está quase nocauteado voa longe, e a queda vira o clímax em vez
                // de acidente dos 5 primeiros segundos.
                const escala = 0.95 + (rival.dano / DANO_KO) * 1.6;
                const emp = fator * escala;
                rival._freioAte = now + 0.32; // liga o freio de lançamento (ver update)
                // O empurrão baixo do começo deixava o rival PARADO no golpe —
                // parecia boneco duro. O tranco de reação vem por TORQUE: torce o
                // tronco, a cabeça chicoteia, o corpo cambaleia. Como torque não
                // desloca, dá impacto sem mandar ninguém pra fora da arena.
                const giro = (strong ? 2.4 : 1.7) * fator;
                tb.applyTorqueImpulse({ x: dir[2] * giro, y: (strong ? 1.8 : 1.1) * fator, z: -dir[0] * giro }, true);
                if (pname !== 'head') {
                  const cab = rival.parts.head;
                  cab.applyTorqueImpulse({ x: dir[2] * giro * 0.7, y: 0, z: -dir[0] * giro * 0.7 }, true);
                }
                tb.applyImpulse({
                  x: dir[0] * (strong ? 4 : 3.2) * emp,
                  // o y é o que tira o corpo do chão e faz passar por cima da amurada:
                  // baixo demais o golpe perde peso, alto demais vira ring-out fácil
                  y: (this._chute ? 0.7 : (strong ? 1.2 : 0.9)) * emp,
                  z: dir[2] * (strong ? 4 : 3.2) * emp,
                }, true);
                // nocaute acumulativo: combo atordoa cada vez mais (rival mais resistente sobe o dano mais devagar)
                rival.dano = Math.min(DANO_KO, rival.dano + ((this.forcaSoco || 1) * (1 + (this._cargaGolpe || 0) * 0.8)) / (rival.resistencia || 1));
                const dur = Math.min(2.6, (strong ? 1.35 : 0.4) * (1 + rival.dano * (1.4 / DANO_KO)) * fator);
                rival.stun(now + dur);
                rival._agr = this; rival._agrAt = now; // quem bateu por último (pra "melhor jogada")
                // Encheu o dano => NOCAUTE: desaba mole (dá pra agarrar e arrastar)
                if (rival.dano >= DANO_KO && !rival.isDowned(now)) rival.knockdown(now);
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
    this.escudo = 0;
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
    this._pegada = [null, null]; // pegadas cravadas no mundo: some no reset
  }
}
