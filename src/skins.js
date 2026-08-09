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
// Material "gominha de vinil" (direção F1 aprovada): gelatina translúcida
// com verniz brilhante de art toy.
export function vinilMat(THREE, color, opacidade = 0.9) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    transparent: opacidade < 1,
    opacity: opacidade,
    // brilho interno de bala de goma (fake subsurface)
    emissive: color,
    emissiveIntensity: 0.32,
  });
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
// Variantes: 'ok' (aberto), 'x' (nocaute), 'blink' (piscando).
function drawFace(g, style, variant) {
  const dizzy = variant === 'x';
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
  if (variant === 'blink') {
    // olhos fechados felizes (arco pra baixo)
    g.strokeStyle = '#1c1226';
    g.lineWidth = 12;
    for (const cx of eyeXs) {
      g.beginPath(); g.arc(cx, 96, eyeR * 0.85, 0.25, Math.PI - 0.25); g.stroke();
    }
  } else {
    // Identidade F1: olhões pretos de bolinha, brilhantes, sem esclera
    for (const cx of eyeXs) {
      g.fillStyle = '#1c1226';
      g.beginPath(); g.arc(cx, 104, eyeR, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.arc(cx - eyeR * 0.3, 96, eyeR * 0.3, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath(); g.arc(cx + eyeR * 0.35, 112, eyeR * 0.14, 0, 7); g.fill();
    }
  }
  g.strokeStyle = '#241640';
  if (style === 'bravo') {
    g.lineWidth = 13;
    g.beginPath();
    g.moveTo(50, 56); g.lineTo(106, 74);
    g.moveTo(206, 56); g.lineTo(150, 74);
    g.stroke();
  }
  if (style === 'boo') {
    g.fillStyle = '#241640';
    g.beginPath(); g.ellipse(128, 172, 22, 28, 0, 0, 7); g.fill();
  } else if (style === 'bigode') {
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
export function getFaceTexture(THREE, style, variant = 'ok') {
  const key = style + '_' + variant;
  if (!faceCache[key]) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    drawFace(c.getContext('2d'), style, variant);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    faceCache[key] = t;
  }
  return faceCache[key];
}

// Helpers de acessórios (acabamento de vinil opaco, como peças do brinquedo)
function mesh(THREE, geo, color) {
  const m = new THREE.Mesh(geo, vinilMat(THREE, color, 1));
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
    cores: { head: 0x8fa8bd, torso: 0x8fa8bd, pelvis: 0x6d8296, arms: 0x8fa8bd, legs: 0x6d8296, barriga: 0xf2f7fa },
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
    cores: { head: 0xf2c894, torso: 0x3a3f4a, pelvis: 0x2e323c, arms: 0x3a3f4a, legs: 0x2e323c },
    face: 'normal',
    semBarriga: true,
    // Jaqueta escura com duas listras refletivas (textura enrolada no tronco)
    texturaTorso(g) {
      g.fillStyle = '#3a3f4a';
      g.fillRect(0, 0, 256, 256);
      for (const y of [118, 160]) {
        g.fillStyle = '#ffd94a';
        g.fillRect(0, y, 256, 22);
        g.fillStyle = '#f4f4f0';
        g.fillRect(0, y + 8, 256, 6);
      }
    },
    extras(THREE, { head, torso }) {
      const capacete = mesh(THREE, new THREE.SphereGeometry(0.185, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xd63b30);
      capacete.position.y = 0.03;
      head.add(capacete);
      const aba = mesh(THREE, new THREE.CylinderGeometry(0.21, 0.21, 0.018, 18), 0xd63b30);
      aba.position.y = 0.02;
      head.add(aba);
    },
  },
  {
    id: 'chef', nome: 'CHEF',
    cores: { head: 0xf2c894, torso: 0xf5f5f0, pelvis: 0x4a4a55, arms: 0xf5f5f0, legs: 0x4a4a55, barriga: 0xffffff },
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
    cores: { head: 0x7ed957, torso: 0x7ed957, pelvis: 0x5cb53b, arms: 0x7ed957, legs: 0x5cb53b, barriga: 0xc9f7a8 },
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
    cores: { head: 0xfafafa, torso: 0xfafafa, pelvis: 0xf2d16b, arms: 0xfafafa, legs: 0xf2a83a, barriga: 0xfff3d6 },
    face: 'normal',
    extras(THREE, { head, torso }) {
      for (let i = -1; i <= 1; i++) {
        const crista = mesh(THREE, new THREE.SphereGeometry(0.038, 10, 8), 0xd63b30);
        crista.position.set(0, 0.17 - Math.abs(i) * 0.02, i * 0.07);
        head.add(crista);
      }
      const bico = mesh(THREE, new THREE.ConeGeometry(0.045, 0.09, 10), 0xf2a83a);
      bico.position.set(0, -0.03, 0.18);
      bico.rotation.x = Math.PI / 2;
      head.add(bico);
      // Asinhas
      for (const lado of [-1, 1]) {
        const asa = mesh(THREE, new THREE.SphereGeometry(0.115, 14, 10), 0xf0eee6);
        asa.position.set(lado * 0.235, -0.03, 0.01);
        asa.scale.set(0.38, 0.8, 0.55);
        asa.rotation.z = lado * 0.45;
        torso.add(asa);
      }
    },
  },
  {
    id: 'abacaxi', nome: 'ABACAXI',
    cores: { head: 0xf2c94c, torso: 0xf2c94c, pelvis: 0xe0b13a, arms: 0xf2c94c, legs: 0x5cb53b, barriga: 0xf9e08a },
    face: 'normal',
    semBarriga: true,
    texturaTorso(g) {
      g.fillStyle = '#f2c94c';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(160,110,20,0.55)';
      g.lineWidth = 5;
      for (let i = -256; i < 512; i += 42) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.stroke();
        g.beginPath(); g.moveTo(i + 256, 0); g.lineTo(i, 256); g.stroke();
      }
    },
    extras(THREE, { head }) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const folha = mesh(THREE, new THREE.ConeGeometry(0.045, 0.2, 8), 0x5cb53b);
        folha.position.set(Math.cos(a) * 0.06, 0.21, Math.sin(a) * 0.06);
        folha.rotation.z = Math.cos(a) * 0.5;
        folha.rotation.x = -Math.sin(a) * 0.5;
        head.add(folha);
      }
    },
  },
  {
    id: 'robo', nome: 'ROBÔ',
    cores: { head: 0x9aa7b8, torso: 0x9aa7b8, pelvis: 0x6d7a8c, arms: 0x9aa7b8, legs: 0x6d7a8c },
    face: 'normal',
    semBarriga: true,
    texturaTorso(g) {
      g.fillStyle = '#9aa7b8';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#5d6a7c';
      g.fillRect(70, 100, 116, 80);
      g.strokeStyle = '#39434f';
      g.lineWidth = 6;
      g.strokeRect(70, 100, 116, 80);
      for (const [bx, cor] of [[95, '#d63b30'], [128, '#f2c94c'], [161, '#5cb53b']]) {
        g.fillStyle = cor;
        g.beginPath(); g.arc(bx, 128, 11, 0, 7); g.fill();
      }
      g.fillStyle = '#39434f';
      g.fillRect(80, 158, 96, 8);
    },
    extras(THREE, { head }) {
      const haste = mesh(THREE, new THREE.CylinderGeometry(0.015, 0.015, 0.11, 8), 0x6d7a8c);
      haste.position.y = 0.2;
      head.add(haste);
      const luz = mesh(THREE, new THREE.SphereGeometry(0.035, 10, 8), 0xd63b30);
      luz.position.y = 0.27;
      head.add(luz);
      for (const lado of [-1, 1]) {
        const parafuso = mesh(THREE, new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), 0x6d7a8c);
        parafuso.position.set(lado * 0.165, 0, 0);
        parafuso.rotation.z = Math.PI / 2;
        head.add(parafuso);
      }
    },
  },
  {
    id: 'banana', nome: 'BANANA',
    cores: { head: 0xf7d954, torso: 0xf7d954, pelvis: 0xe3c23e, arms: 0xf7d954, legs: 0xe3c23e, barriga: 0xfdf3c0 },
    face: 'normal',
    extras(THREE, { head }) {
      const ponta = mesh(THREE, new THREE.ConeGeometry(0.06, 0.14, 10), 0x8a5f28);
      ponta.position.y = 0.21;
      head.add(ponta);
      const gomo = mesh(THREE, new THREE.CapsuleGeometry(0.035, 0.1, 4, 8), 0xe3c23e);
      gomo.position.set(0, 0.12, -0.12);
      gomo.rotation.x = 0.7;
      head.add(gomo);
    },
  },
  {
    id: 'fantasma', nome: 'FANTASMA',
    cores: { head: 0xeef0ff, torso: 0xeef0ff, pelvis: 0xd8dcf2, arms: 0xeef0ff, legs: 0xd8dcf2, barriga: 0xffffff },
    face: 'boo',
    opacidade: 0.82,
    extras() {},
  },
  {
    id: 'unicornio', nome: 'UNICÓRNIO',
    cores: { head: 0xfdfdfd, torso: 0xfdfdfd, pelvis: 0xf3c9e0, arms: 0xfdfdfd, legs: 0xf3c9e0, barriga: 0xffe9f4 },
    face: 'normal',
    extras(THREE, { head }) {
      const chifre = mesh(THREE, new THREE.ConeGeometry(0.045, 0.19, 10), 0xf2c94c);
      chifre.position.set(0, 0.16, 0.09);
      chifre.rotation.x = -0.5;
      head.add(chifre);
      const tons = [0xf78fc2, 0xc792ff, 0x8fd0f7];
      for (let i = 0; i < 5; i++) {
        const mecha = mesh(THREE, new THREE.SphereGeometry(0.05, 10, 8), tons[i % 3]);
        mecha.position.set(0, 0.17 - i * 0.045, -0.05 - i * 0.045);
        head.add(mecha);
      }
    },
  },
  {
    id: 'dino', nome: 'DINO',
    cores: { head: 0x4fae6b, torso: 0x4fae6b, pelvis: 0x3d8c54, arms: 0x4fae6b, legs: 0x3d8c54, barriga: 0xd6eeb0 },
    face: 'bravo',
    extras(THREE, { head, torso, pelvis }) {
      const lugares = [[head, 0.15, -0.06], [head, 0.08, -0.14], [torso, 0.14, -0.24], [torso, 0.0, -0.26]];
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
