// Controles de toque pra celular: analógico virtual (esquerda) + botões (direita).
// Alimenta o mesmo formato de input do teclado; some no desktop.

let ativo = false;
const estado = {
  move: { x: 0, z: 0 }, punch: false, grab: false, jump: false, emote: false, esquiva: false,
};

// dedo do analógico (por identificador) e dedos dos botões
let joyId = null, joyCx = 0, joyCy = 0, joyR = 60;

function ehTouch() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
    new URLSearchParams(location.search).has('touch');
}

export function readTouch() { return ativo ? estado : null; }
export function touchAtivo() { return ativo; }

export function initTouch() {
  if (!ehTouch()) return;
  const box = document.getElementById('touch');
  if (!box) return;
  box.style.display = 'block';
  ativo = true;
  // some com as dicas de teclado (WASD/setas) que atrapalham no celular
  const ctr = document.getElementById('controles');
  if (ctr) ctr.style.display = 'none';

  const base = document.getElementById('touch-base');
  const knob = document.getElementById('touch-knob');

  const setJoy = (dx, dy) => {
    const d = Math.hypot(dx, dy);
    const k = d > joyR ? joyR / d : 1;
    const kx = dx * k, ky = dy * k;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    estado.move.x = kx / joyR;
    estado.move.z = ky / joyR; // tela pra baixo = +z (igual tecla S)
  };
  const zeraJoy = () => { joyId = null; knob.style.transform = 'translate(0,0)'; estado.move.x = 0; estado.move.z = 0; };

  // Área do analógico: metade esquerda da tela
  const naEsquerda = (t) => t.clientX < innerWidth * 0.5;

  addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      const alvo = t.target;
      if (alvo && alvo.dataset && alvo.dataset.btn) { estado[alvo.dataset.btn] = true; continue; }
      if (joyId === null && naEsquerda(t)) {
        joyId = t.identifier;
        const r = base.getBoundingClientRect();
        joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
        setJoy(t.clientX - joyCx, t.clientY - joyCy);
      }
    }
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) setJoy(t.clientX - joyCx, t.clientY - joyCy);
    }
  }, { passive: true });

  const soltar = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) zeraJoy();
      const alvo = t.target;
      if (alvo && alvo.dataset && alvo.dataset.btn) estado[alvo.dataset.btn] = false;
    }
  };
  addEventListener('touchend', soltar, { passive: true });
  addEventListener('touchcancel', soltar, { passive: true });

  // Botões: touchstart/menu já cobre via data-btn; também tratamos "cancelar"
  // quando o dedo escorrega pra fora com pointer events de segurança.
  for (const b of box.querySelectorAll('[data-btn]')) {
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
}
