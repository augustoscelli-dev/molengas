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
  vozSoco(p = 1) { voz(150, 95, 0.14, p); },
  vozDor(p = 1) { voz(520, 240, 0.28, p, 'square', 0.12); },
  vozUe(p = 1) { voz(300, 560, 0.35, p, 'triangle', 0.18); },
  vozChoro(p = 1) {
    [420, 350, 290].forEach((f, i) => tom(f * p, 0.2, { type: 'triangle', vol: 0.13, delay: i * 0.2, slideTo: f * 0.75 * p }));
  },
  vozYay(p = 1) { voz(380, 820, 0.45, p, 'triangle', 0.2); },
  soco() { sopro(0.13, { freq: 900, slideTo: 250, vol: 0.35 }); },
  acerto() {
    tom(110, 0.18, { type: 'sine', vol: 0.7, slideTo: 55 });
    sopro(0.06, { freq: 2000, vol: 0.3 });
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
