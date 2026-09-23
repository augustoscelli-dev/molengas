// Sons sintetizados em Web Audio — nenhum arquivo, tudo gerado na hora.
// initSom() precisa ser chamado após um gesto do usuário (regra do navegador).

let ctx = null;
let master = null;
let noiseBuf = null;

export function initSom() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  // Murmúrio da torcida (ruído grave em loop, respirando devagar)
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  const g = ctx.createGain();
  g.gain.value = 0.055;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.02;
  lfo.connect(lfoG).connect(g.gain);
  lfo.start();
  src.connect(lp).connect(g).connect(master);
  src.start();
  musicaAplicar(); // se a música foi pedida antes do som ligar, começa agora
  ambienteAplicar(); // idem pro ambiente da arena
}

function getNoise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function pronto() {
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// ---------- Ambiente por arena (camada de ruído contínua, retunada por mapa) ----------
// Tipos: vento (uivo com rajadas), lava (ronco grave), neve (sussurro agudo),
// agua (marulho lento). null desliga. Tudo com rampas suaves — nada estala.
let amb = null;      // { src, filtro, ganho, lfo, lfoG }
let ambTipo = null;
const AMBIENTES = {
  vento: { tipo: 'bandpass', freq: 620, vol: 0.10, lfoHz: 0.35, lfoProf: 0.06 },
  lava:  { tipo: 'lowpass',  freq: 150, vol: 0.13, lfoHz: 0.18, lfoProf: 0.05 },
  neve:  { tipo: 'highpass', freq: 2600, vol: 0.035, lfoHz: 0.1, lfoProf: 0.012 },
  agua:  { tipo: 'lowpass',  freq: 480, vol: 0.09, lfoHz: 0.22, lfoProf: 0.05 },
};
function ambiente(tipo) {
  ambTipo = AMBIENTES[tipo] ? tipo : null;
  if (!ctx) return; // som ainda não ligou: initSom/ambienteAplicar pega depois
  ambienteAplicar();
}
function ambienteAplicar() {
  if (!ctx) return;
  if (!amb) { // cria a cadeia 1x e deixa rodando com ganho 0
    const src = ctx.createBufferSource();
    src.buffer = getNoise(); src.loop = true;
    const filtro = ctx.createBiquadFilter();
    const ganho = ctx.createGain(); ganho.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG).connect(ganho.gain);
    src.connect(filtro).connect(ganho).connect(master);
    lfo.start(); src.start();
    amb = { src, filtro, ganho, lfo, lfoG };
  }
  const t = ctx.currentTime, a = AMBIENTES[ambTipo];
  amb.ganho.gain.cancelScheduledValues(t);
  amb.lfoG.gain.cancelScheduledValues(t);
  if (!a) {
    amb.ganho.gain.setTargetAtTime(0, t, 0.5);
    amb.lfoG.gain.setTargetAtTime(0, t, 0.5);
    return;
  }
  amb.filtro.type = a.tipo;
  amb.filtro.frequency.setTargetAtTime(a.freq, t, 0.5);
  amb.lfo.frequency.setTargetAtTime(a.lfoHz, t, 0.5);
  amb.ganho.gain.setTargetAtTime(a.vol, t, 0.8);
  amb.lfoG.gain.setTargetAtTime(a.lfoProf, t, 0.8);
}

// Oscilador com envelope e glissando opcional
function tom(freq, dur, { type = 'square', vol = 0.3, slideTo = null, delay = 0 } = {}) {
  if (!pronto()) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// Rajada de ruído filtrado
function sopro(dur, { freq = 800, slideTo = null, vol = 0.4, type = 'bandpass', delay = 0 } = {}) {
  if (!pronto()) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  src.playbackRate.value = 1;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ---------- Música (baixo + chimbal sintetizados em loop) ----------
let musTimer = null;
let musModo = null;
let musStep = 0;
// Padrões de 16 semicolcheias: baixo, bumbo, caixa, chimbal e uma melodia (lead).
const TRILHAS = {
  menu: {
    bpm: 104,
    baixo: [65.4, 0, 0, 65.4, 82.4, 0, 0, 0, 65.4, 0, 0, 65.4, 98, 0, 87.3, 0],
    kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    lead:  [0, 0, 392, 0, 523, 0, 0, 494, 440, 0, 0, 392, 0, 0, 349, 0],
    leadVol: 0.06, leadType: 'triangle',
  },
  luta: {
    bpm: 140,
    baixo: [55, 0, 55, 0, 65.4, 0, 55, 0, 73.4, 0, 73.4, 0, 65.4, 0, 49, 49],
    kick:  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    lead:  [880, 0, 784, 0, 659, 0, 784, 0, 880, 0, 988, 0, 784, 659, 587, 0],
    leadVol: 0.05, leadType: 'square',
  },
  gelada: { // GELO: lenta e cristalina
    bpm: 112,
    baixo: [55, 0, 0, 0, 65.4, 0, 0, 0, 49, 0, 0, 0, 58.3, 0, 0, 0],
    kick:  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    lead:  [880, 0, 0, 659, 0, 0, 698, 0, 587, 0, 0, 523, 0, 0, 659, 0],
    leadVol: 0.045, leadType: 'sine',
  },
  tensa: { // ABISMO/BLACKOUT: grave, esparsa, suspense
    bpm: 122,
    baixo: [41.2, 0, 0, 41.2, 0, 0, 43.7, 0, 41.2, 0, 0, 41.2, 0, 46.2, 0, 0],
    kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    lead:  [0, 0, 0, 0, 330, 0, 0, 0, 0, 0, 311, 0, 0, 0, 0, 0],
    leadVol: 0.05, leadType: 'sawtooth',
  },
  quente: { // CHÃO QUENTE: acelerada, urgente
    bpm: 158,
    baixo: [55, 55, 0, 55, 0, 55, 0, 65.4, 73.4, 0, 73.4, 0, 82.4, 0, 65.4, 0],
    kick:  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    hat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    lead:  [0, 440, 0, 523, 0, 587, 0, 659, 0, 587, 0, 523, 0, 440, 523, 0],
    leadVol: 0.05, leadType: 'square',
  },
};
function musicaAplicar() {
  if (musTimer) { clearInterval(musTimer); musTimer = null; }
  if (!ctx || !musModo) return;
  const tr = TRILHAS[musModo];
  musStep = 0;
  musTimer = setInterval(() => {
    if (!ctx || ctx.state === 'suspended') return;
    const i = musStep % 16;
    if (tr.baixo[i]) tom(tr.baixo[i], 0.16, { type: 'triangle', vol: 0.13 });
    if (tr.kick[i]) tom(130, 0.14, { type: 'sine', vol: 0.42, slideTo: 48 });          // bumbo
    if (tr.snare[i]) { sopro(0.11, { freq: 1900, vol: 0.15, type: 'highpass' }); tom(190, 0.07, { type: 'triangle', vol: 0.09, slideTo: 120 }); } // caixa
    if (tr.hat[i]) sopro(0.025, { freq: 7000, vol: 0.04, type: 'highpass' });           // chimbal
    if (tr.lead[i]) tom(tr.lead[i], 0.14, { type: tr.leadType, vol: tr.leadVol });      // melodia
    musStep++;
  }, 60000 / tr.bpm / 4);
}
function musica(modo) {
  if (modo === musModo) return;
  musModo = modo;
  musicaAplicar();
}

// ---------- Vozes molengas (balbucios por timbre) ----------
function voz(fa, fb, dur, pitch = 1, type = 'sawtooth', vol = 0.16) {
  tom(fa * pitch, dur, { type, vol, slideTo: fb * pitch });
}

export const som = {
  musica,
  ambiente,
  vozSoco(p = 1) { voz(150, 95, 0.14, p); },
  vozDor(p = 1) { voz(520, 240, 0.28, p, 'square', 0.12); },
  vozUe(p = 1) { voz(300, 560, 0.35, p, 'triangle', 0.18); },
  vozChoro(p = 1) {
    [420, 350, 290].forEach((f, i) => tom(f * p, 0.2, { type: 'triangle', vol: 0.13, delay: i * 0.2, slideTo: f * 0.75 * p }));
  },
  vozYay(p = 1) { voz(380, 820, 0.45, p, 'triangle', 0.2); },
  soco() { const p = 0.85 + Math.random() * 0.3; sopro(0.13, { freq: 900 * p, slideTo: 250 * p, vol: 0.35 }); },
  // Impacto em camadas: corpo + SUB-GRAVE (o "gordo") + estalo, com pitch variado
  // pra não enjoar. forca cresce com o dano da vítima — pancada tarde soa maior.
  acerto(forca = 1) {
    const v = Math.min(1.6, forca);
    const p = 0.92 + Math.random() * 0.16;
    tom(110 * p, 0.18, { type: 'sine', vol: 0.55 * v, slideTo: 55 * p }); // corpo do soco
    tom(58 * p, 0.28, { type: 'sine', vol: 0.5 * v, slideTo: 34 });      // sub-grave
    sopro(0.07, { freq: 1900 * p, vol: 0.28 * v });                      // estalo/chicote
    if (v > 1.15) sopro(0.18, { freq: 680, slideTo: 220, vol: 0.26, type: 'lowpass' }); // pancadão: rasgo extra
  },
  bolada() {
    tom(196, 0.5, { type: 'triangle', vol: 0.5, slideTo: 130 });
    tom(311, 0.35, { type: 'square', vol: 0.18, slideTo: 200 });
  },
  queda() { tom(650, 0.7, { type: 'sawtooth', vol: 0.25, slideTo: 90 }); },
  torcidaOh() { sopro(0.7, { freq: 500, slideTo: 250, vol: 0.5, type: 'lowpass' }); },
  ponto() { [523, 659, 784].forEach((f, i) => tom(f, 0.14, { vol: 0.25, delay: i * 0.09 })); },
  vitoria() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tom(f, 0.18, { vol: 0.25, delay: i * 0.12 })); },
  pulo() { tom(280, 0.1, { type: 'square', vol: 0.15, slideTo: 520 }); },
  agarra() { sopro(0.05, { freq: 1400, vol: 0.25 }); },
  arremesso() { sopro(0.25, { freq: 500, slideTo: 1600, vol: 0.35 }); },
  esquiva() { sopro(0.16, { freq: 1300, slideTo: 380, vol: 0.22, type: 'bandpass' }); }, // whoosh curto e leve
  laser() { tom(1250, 0.16, { type: 'sawtooth', vol: 0.26, slideTo: 260 }); sopro(0.06, { freq: 3200, vol: 0.14 }); }, // pew sci-fi
  overheat() { sopro(0.3, { freq: 2600, slideTo: 700, vol: 0.18, type: 'highpass' }); tom(180, 0.18, { type: 'square', vol: 0.1, slideTo: 90 }); }, // chiado de superaquecido
  selecionar() { tom(600, 0.06, { vol: 0.15 }); },
  confirmar() { tom(700, 0.09, { vol: 0.2 }); tom(1050, 0.12, { vol: 0.2, delay: 0.08 }); },
  lutem() { [392, 523, 659].forEach((f, i) => tom(f, 0.12, { vol: 0.3, delay: i * 0.06 })); },
};
