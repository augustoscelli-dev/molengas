// Teclado pra 2 jogadores no mesmo teclado.

const keys = new Set();
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']);

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (PREVENT.has(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

export const MAPS = {
  p1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', punch: 'KeyF', grab: 'KeyG', jump: 'Space', emote: 'KeyT', esquiva: 'ShiftLeft' },
  p2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', punch: 'KeyK', grab: 'KeyL', jump: 'Enter', emote: 'KeyO', esquiva: 'ShiftRight' },
};

export function readInput(map) {
  return {
    move: {
      x: (keys.has(map.right) ? 1 : 0) - (keys.has(map.left) ? 1 : 0),
      z: (keys.has(map.down) ? 1 : 0) - (keys.has(map.up) ? 1 : 0),
    },
    punch: keys.has(map.punch),
    grab: keys.has(map.grab),
    jump: keys.has(map.jump),
    emote: keys.has(map.emote),
    esquiva: keys.has(map.esquiva),
  };
}

export function isDown(code) { return keys.has(code); }
