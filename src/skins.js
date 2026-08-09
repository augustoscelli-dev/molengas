// Fantasias: cores + carinha + acessórios 3D montados com primitivas.
// O corpo molenga é sempre o mesmo — a graça é o tubarão socando o bombeiro.

// ---------- Material toon (bandas chapadas) + contorno de desenho ----------
let gradTex = null;
function toonGradient(THREE) {
  if (!gradTex) {
    const tons = new Uint8Array([70, 135, 210, 255]);
    gradTex = new THREE.DataTexture(tons, tons.length, 1, THREE.RedFormat);
    gradTex.minFilter = THREE.NearestFilter;
    gradTex.magFilter = THREE.NearestFilter;
    gradTex.needsUpdate = true;
  }
  return gradTex;
}
export function toonMat(THREE, color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(THREE) });
}
let outlineMatCache = null;
export function addOutline(THREE, m, escala = 1.055) {
  outlineMatCache ||= new THREE.MeshBasicMaterial({ color: 0x241640, side: THREE.BackSide });
  const o = new THREE.Mesh(m.geometry, outlineMatCache);
  o.scale.setScalar(escala);
  m.add(o);
  return m;
}

// Carinhas desenhadas em canvas (256px). Estilos: normal, bravo, ciclope, bigode.
function drawFace(g, style, dizzy) {
  g.clearRect(0, 0, 256, 256);
  g.lineCap = 'round';
  const eyeXs = style === 'ciclope' ? [128] : [84, 172];
  const eyeR = style === 'ciclope' ? 40 : 27;
  // bochechas
  g.fillStyle = 'rgba(255,110,140,0.38)';
  for (const cx of [52, 204]) { g.beginPath(); g.arc(cx, 152, 20, 0, 7); g.fill(); }
  if (dizzy) {
    g.strokeStyle = '#241640';
    g.lineWidth = 14;
    for (const cx of eyeXs) {
      g.beginPath();
      g.moveTo(cx - eyeR, 104 - eyeR); g.lineTo(cx + eyeR, 104 + eyeR);
      g.moveTo(cx + eyeR, 104 - eyeR); g.lineTo(cx - eyeR, 104 + eyeR);
      g.stroke();
    }
    g.lineWidth = 11;
    g.beginPath(); g.arc(128, 188, 17, 0, 7); g.stroke();
    return;
  }
  // olhos: esclera branca, contorno, pupila e brilho
  for (const cx of eyeXs) {
    g.fillStyle = '#fff';
    g.strokeStyle = '#241640';
    g.lineWidth = 8;
    g.beginPath(); g.ellipse(cx, 104, eyeR, eyeR * 1.14, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#241640';
    g.beginPath(); g.arc(cx + 3, 108, eyeR * 0.45, 0, 7); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(cx + eyeR * 0.28, 96, eyeR * 0.16, 0, 7); g.fill();
  }
  g.strokeStyle = '#241640';
  if (style === 'bravo') {
    g.lineWidth = 13;
    g.beginPath();
    g.moveTo(50, 56); g.lineTo(106, 74);
    g.moveTo(206, 56); g.lineTo(150, 74);
    g.stroke();
  }
  if (style === 'bigode') {
    g.fillStyle = '#3d2b1f';
    for (const lado of [-1, 1]) {
      g.beginPath();
      g.ellipse(128 + lado * 34, 158, 34, 15, lado * 0.28, 0, 7);
      g.fill();
    }
    g.lineWidth = 11;
    g.beginPath(); g.arc(128, 182, 22, 0.5, Math.PI - 0.5); g.stroke();
  } else {
    g.lineWidth = 12;
    g.beginPath(); g.arc(128, 146, 42, 0.3, Math.PI - 0.3); g.stroke();
  }
}

const faceCache = {};
export function getFaceTexture(THREE, style, dizzy) {
  const key = style + (dizzy ? '_x' : '');
  if (!faceCache[key]) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    drawFace(c.getContext('2d'), style, dizzy);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    faceCache[key] = t;
  }
  return faceCache[key];
}

// Helpers de acessórios
function mesh(THREE, geo, color) {
  const m = new THREE.Mesh(geo, toonMat(THREE, color));
  m.castShadow = true;
  addOutline(THREE, m);
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
      const fin = mesh(THREE, new THREE.ConeGeometry(0.1, 0.22, 10), 0x5f7488);
      fin.position.set(0, 0.13, -0.23);
      fin.rotation.x = -0.6;
      fin.scale.x = 0.35;
      torso.add(fin);
      const tail = mesh(THREE, new THREE.ConeGeometry(0.06, 0.18, 10), 0x5f7488);
      tail.position.set(0, -0.06, -0.24);
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
      const faixa = mesh(THREE, new THREE.CylinderGeometry(0.196, 0.196, 0.06, 16, 1, true), 0xf5f0dc);
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
      const lugares = [[head, 0.15, -0.06], [head, 0.08, -0.14], [torso, 0.13, -0.21], [torso, 0.0, -0.23]];
      for (const [pai, py, pz] of lugares) {
        const placa = mesh(THREE, new THREE.ConeGeometry(0.055, 0.11, 8), 0x8fe07a);
        placa.position.set(0, py, pz);
        placa.rotation.x = -0.7;
        placa.scale.x = 0.35;
        pai.add(placa);
      }
      const cauda = mesh(THREE, new THREE.ConeGeometry(0.06, 0.22, 10), 0x3d8c54);
      cauda.position.set(0, -0.08, -0.24);
      cauda.rotation.x = -2.4;
      pelvis.add(cauda);
    },
  },
];
