// Fantasias: cores + carinha + acessórios 3D montados com primitivas.
// O corpo molenga é sempre o mesmo — a graça é o tubarão socando o bombeiro.

// Carinhas desenhadas em canvas. Estilos: normal, bravo, ciclope, bigode.
function drawFace(g, style, dizzy) {
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.strokeStyle = '#111';
  g.lineWidth = 7;
  g.lineCap = 'round';
  const eyeXs = style === 'ciclope' ? [64] : [42, 86];
  const eyeR = style === 'ciclope' ? 16 : 9;
  if (dizzy) {
    for (const cx of eyeXs) {
      g.beginPath();
      g.moveTo(cx - eyeR, 52 - eyeR); g.lineTo(cx + eyeR, 52 + eyeR);
      g.moveTo(cx + eyeR, 52 - eyeR); g.lineTo(cx - eyeR, 52 + eyeR);
      g.stroke();
    }
    g.beginPath(); g.arc(64, 92, 10, 0, 7); g.stroke();
  } else {
    for (const cx of eyeXs) { g.beginPath(); g.arc(cx, 52, eyeR, 0, 7); g.fill(); }
    if (style === 'bravo') {
      g.beginPath();
      g.moveTo(28, 34); g.lineTo(52, 42);
      g.moveTo(100, 34); g.lineTo(76, 42);
      g.stroke();
    }
    if (style === 'bigode') {
      g.lineWidth = 9;
      g.beginPath(); g.arc(48, 76, 15, Math.PI, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(80, 76, 15, Math.PI * 1.1, Math.PI * 2); g.stroke();
      g.lineWidth = 7;
      g.beginPath(); g.arc(64, 88, 14, 0.4, Math.PI - 0.4); g.stroke();
    } else {
      g.beginPath(); g.arc(64, 74, 22, 0.25, Math.PI - 0.25); g.stroke();
    }
  }
}

const faceCache = {};
export function getFaceTexture(THREE, style, dizzy) {
  const key = style + (dizzy ? '_x' : '');
  if (!faceCache[key]) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    drawFace(c.getContext('2d'), style, dizzy);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    faceCache[key] = t;
  }
  return faceCache[key];
}

// Helpers de acessórios
function mesh(THREE, geo, color) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  m.castShadow = true;
  return m;
}

export const SKINS = [
  {
    id: 'vermelhinho', nome: 'VERMELHINHO',
    cores: { head: 0xff5252, torso: 0xff5252, pelvis: 0xd63e3e, arms: 0xff5252, legs: 0xd63e3e },
    face: 'normal',
    extras() {},
  },
  {
    id: 'azulzinho', nome: 'AZULZINHO',
    cores: { head: 0x40a0ff, torso: 0x40a0ff, pelvis: 0x2f7fd0, arms: 0x40a0ff, legs: 0x2f7fd0 },
    face: 'normal',
    extras() {},
  },
  {
    id: 'tubarao', nome: 'TUBARÃO',
    cores: { head: 0x8fa8bd, torso: 0x8fa8bd, pelvis: 0x6d8296, arms: 0x8fa8bd, legs: 0x6d8296 },
    face: 'bravo',
    extras(THREE, { head, torso, pelvis }) {
      const fin = mesh(THREE, new THREE.ConeGeometry(0.09, 0.2, 10), 0x5f7488);
      fin.position.set(0, 0.1, -0.16);
      fin.rotation.x = -0.6;
      fin.scale.x = 0.35;
      torso.add(fin);
      const tail = mesh(THREE, new THREE.ConeGeometry(0.06, 0.16, 10), 0x5f7488);
      tail.position.set(0, -0.06, -0.18);
      tail.rotation.x = -2.3;
      tail.scale.x = 0.4;
      pelvis.add(tail);
    },
  },
  {
    id: 'polvo', nome: 'POLVO',
    cores: { head: 0xa06bd6, torso: 0xa06bd6, pelvis: 0x8352b5, arms: 0xa06bd6, legs: 0x8352b5 },
    face: 'normal',
    extras(THREE, { head }) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const t = mesh(THREE, new THREE.CapsuleGeometry(0.028, 0.1, 4, 8), 0x8352b5);
        t.position.set(Math.cos(a) * 0.12, -0.12, Math.sin(a) * 0.12);
        t.rotation.z = Math.cos(a) * 0.7;
        t.rotation.x = -Math.sin(a) * 0.7;
        head.add(t);
      }
    },
  },
  {
    id: 'bombeiro', nome: 'BOMBEIRO',
    cores: { head: 0xf2c894, torso: 0xe8b23a, pelvis: 0x3a3f4a, arms: 0xe8b23a, legs: 0x3a3f4a },
    face: 'normal',
    extras(THREE, { head, torso }) {
      const capacete = mesh(THREE, new THREE.SphereGeometry(0.185, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xd63b30);
      capacete.position.y = 0.03;
      head.add(capacete);
      const aba = mesh(THREE, new THREE.CylinderGeometry(0.21, 0.21, 0.018, 18), 0xd63b30);
      aba.position.y = 0.02;
      head.add(aba);
      const faixa = mesh(THREE, new THREE.CylinderGeometry(0.172, 0.172, 0.055, 16, 1, true), 0xf5f0dc);
      torso.add(faixa);
    },
  },
  {
    id: 'chef', nome: 'CHEF',
    cores: { head: 0xf2c894, torso: 0xf5f5f0, pelvis: 0x4a4a55, arms: 0xf5f5f0, legs: 0x4a4a55 },
    face: 'bigode',
    extras(THREE, { head }) {
      const base = mesh(THREE, new THREE.CylinderGeometry(0.125, 0.125, 0.13, 16), 0xfafafa);
      base.position.y = 0.19;
      head.add(base);
      const topo = mesh(THREE, new THREE.SphereGeometry(0.15, 16, 12), 0xfafafa);
      topo.position.y = 0.27;
      topo.scale.y = 0.6;
      head.add(topo);
    },
  },
  {
    id: 'alien', nome: 'ALIEN',
    cores: { head: 0x7ed957, torso: 0x7ed957, pelvis: 0x5cb53b, arms: 0x7ed957, legs: 0x5cb53b },
    face: 'ciclope',
    extras(THREE, { head }) {
      for (const sx of [-1, 1]) {
        const haste = mesh(THREE, new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), 0x5cb53b);
        haste.position.set(sx * 0.07, 0.2, 0);
        haste.rotation.z = -sx * 0.35;
        head.add(haste);
        const bola = mesh(THREE, new THREE.SphereGeometry(0.032, 10, 8), 0xb6ff8a);
        bola.position.set(sx * 0.095, 0.26, 0);
        head.add(bola);
      }
    },
  },
  {
    id: 'galinha', nome: 'GALINHA',
    cores: { head: 0xfafafa, torso: 0xfafafa, pelvis: 0xf2d16b, arms: 0xfafafa, legs: 0xf2a83a },
    face: 'normal',
    extras(THREE, { head }) {
      for (let i = -1; i <= 1; i++) {
        const crista = mesh(THREE, new THREE.SphereGeometry(0.038, 10, 8), 0xd63b30);
        crista.position.set(0, 0.17 - Math.abs(i) * 0.02, i * 0.07);
        head.add(crista);
      }
      const bico = mesh(THREE, new THREE.ConeGeometry(0.045, 0.09, 10), 0xf2a83a);
      bico.position.set(0, -0.03, 0.18);
      bico.rotation.x = Math.PI / 2;
      head.add(bico);
    },
  },
  {
    id: 'dino', nome: 'DINO',
    cores: { head: 0x4fae6b, torso: 0x4fae6b, pelvis: 0x3d8c54, arms: 0x4fae6b, legs: 0x3d8c54 },
    face: 'bravo',
    extras(THREE, { head, torso, pelvis }) {
      const lugares = [[head, 0.15, -0.06], [head, 0.08, -0.14], [torso, 0.12, -0.15], [torso, 0.0, -0.17]];
      for (const [pai, py, pz] of lugares) {
        const placa = mesh(THREE, new THREE.ConeGeometry(0.055, 0.11, 8), 0x8fe07a);
        placa.position.set(0, py, pz);
        placa.rotation.x = -0.7;
        placa.scale.x = 0.35;
        pai.add(placa);
      }
      const cauda = mesh(THREE, new THREE.ConeGeometry(0.06, 0.2, 10), 0x3d8c54);
      cauda.position.set(0, -0.08, -0.18);
      cauda.rotation.x = -2.4;
      pelvis.add(cauda);
    },
  },
];
