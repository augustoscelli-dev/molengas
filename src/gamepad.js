// Controles (Gamepad API): jogador i usa o controle i.
// Analógico esquerdo/dpad anda · A pula · X ou RB soca · B ou LB/RT agarra.

export function readGamepad(idx) {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gps[idx];
  if (!gp || !gp.connected) return null;
  const dz = (v) => (Math.abs(v) > 0.25 ? v : 0);
  const bt = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const x = dz(gp.axes[0] || 0) + (bt(15) ? 1 : 0) - (bt(14) ? 1 : 0);
  const z = dz(gp.axes[1] || 0) + (bt(13) ? 1 : 0) - (bt(12) ? 1 : 0);
  return {
    move: { x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) },
    punch: bt(2) || bt(5),
    grab: bt(1) || bt(4) || bt(7),
    jump: bt(0),
  };
}

export function mergeInput(teclado, controle) {
  if (!controle) return teclado;
  return {
    move: {
      x: Math.abs(controle.move.x) > Math.abs(teclado.move.x) ? controle.move.x : teclado.move.x,
      z: Math.abs(controle.move.z) > Math.abs(teclado.move.z) ? controle.move.z : teclado.move.z,
    },
    punch: teclado.punch || controle.punch,
    grab: teclado.grab || controle.grab,
    jump: teclado.jump || controle.jump,
  };
}
