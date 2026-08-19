// Editor ao vivo (estilo "VFX editor"): ajusta câmera, luz, efeitos e força
// em tempo real. Abre/fecha na tecla ` (crase). Escondido por padrão.
// Sem dependências — painel montado na mão pra ficar leve e offline.
import { AJUSTES } from './ajustes.js';

export function initEditor(refs) {
  const { camera, r3, scene, sun, hemi, rim, bloomPass } = refs;
  const painel = document.createElement('div');
  painel.id = 'editor-vfx';
  painel.style.cssText = `position:fixed;top:12px;right:12px;z-index:50;width:270px;max-height:88vh;
    overflow-y:auto;display:none;padding:12px 12px 14px;border-radius:14px;
    background:rgba(16,12,30,.9);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);
    box-shadow:0 12px 40px rgba(0,0,0,.5);color:#f3eefb;font-family:'Fredoka',system-ui,sans-serif;
    font-size:13px;-webkit-user-select:none;user-select:none;`;
  document.body.appendChild(painel);

  const h = document.createElement('div');
  h.style.cssText = `font-weight:800;font-size:15px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;`;
  h.innerHTML = `<span>⚙️ Editor ao vivo</span><span style="opacity:.6;font-size:11px;font-weight:600">\` fecha</span>`;
  painel.appendChild(h);

  const controles = []; // {ler} pra montar o "copiar valores"

  const secao = (nome) => {
    const s = document.createElement('div');
    s.textContent = nome;
    s.style.cssText = `margin:12px 0 5px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ff8ec2;`;
    painel.appendChild(s);
  };

  const slider = (chave, label, min, max, step, get, set) => {
    const row = document.createElement('label');
    row.style.cssText = `display:block;margin:7px 0;`;
    const top = document.createElement('div');
    top.style.cssText = `display:flex;justify-content:space-between;margin-bottom:2px;`;
    const nm = document.createElement('span'); nm.textContent = label; nm.style.opacity = '.9';
    const val = document.createElement('span'); val.style.cssText = `font-variant-numeric:tabular-nums;color:#7ee0ff;font-weight:700;`;
    top.appendChild(nm); top.appendChild(val);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
    inp.style.cssText = `width:100%;accent-color:#ff3d8b;cursor:pointer;`;
    const mostra = () => { val.textContent = (+inp.value).toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 0); };
    inp.addEventListener('input', () => { set(+inp.value); mostra(); });
    mostra();
    row.appendChild(top); row.appendChild(inp); painel.appendChild(row);
    controles.push({ chave, ler: () => +inp.value, set: (v) => { inp.value = v; set(+v); mostra(); } });
  };

  const cor = (chave, label, get, set) => {
    const row = document.createElement('label');
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;margin:7px 0;`;
    const nm = document.createElement('span'); nm.textContent = label; nm.style.opacity = '.9';
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = get();
    inp.style.cssText = `width:40px;height:24px;border:0;background:none;cursor:pointer;`;
    inp.addEventListener('input', () => set(inp.value));
    row.appendChild(nm); row.appendChild(inp); painel.appendChild(row);
    controles.push({ chave, ler: () => inp.value, set: (v) => { inp.value = v; set(v); } });
  };

  // ---- CÂMERA ----
  secao('Câmera');
  if (camera) slider('fov', 'Abertura (FOV)', 30, 90, 1, () => camera.fov, (v) => { camera.fov = v; camera.updateProjectionMatrix(); });
  slider('shake', 'Tremor', 0, 3, 0.05, () => AJUSTES.shake, (v) => AJUSTES.shake = v);

  // ---- ARENA / LUZ ----
  secao('Arena e luz');
  if (sun) slider('sol', 'Sol', 0, 4, 0.05, () => sun.intensity, (v) => sun.intensity = v);
  if (hemi) slider('ambiente', 'Ambiente', 0, 3, 0.05, () => hemi.intensity, (v) => hemi.intensity = v);
  if (rim) slider('contorno', 'Contorno', 0, 3, 0.05, () => rim.intensity, (v) => rim.intensity = v);
  if (r3) slider('expo', 'Exposição', 0.4, 2, 0.01, () => r3.toneMappingExposure, (v) => r3.toneMappingExposure = v);
  if (scene && scene.fog) {
    slider('nevoaPerto', 'Névoa perto', 0, 40, 1, () => scene.fog.near, (v) => scene.fog.near = v);
    slider('nevoaLonge', 'Névoa longe', 20, 100, 1, () => scene.fog.far, (v) => scene.fog.far = v);
    cor('nevoaCor', 'Cor da névoa', () => '#' + scene.fog.color.getHexString(), (v) => scene.fog.color.set(v));
  }

  // ---- EFEITOS (bloom) ----
  if (bloomPass) {
    secao('Efeitos (brilho)');
    slider('bloomForca', 'Brilho', 0, 2, 0.01, () => bloomPass.strength, (v) => bloomPass.strength = v);
    slider('bloomRaio', 'Raio', 0, 1, 0.01, () => bloomPass.radius, (v) => bloomPass.radius = v);
    slider('bloomLimiar', 'Limiar', 0, 1, 0.01, () => bloomPass.threshold, (v) => bloomPass.threshold = v);
  }

  // ---- JOGO ----
  secao('Jogo');
  slider('forcaSoco', 'Força do soco', 0.2, 3, 0.05, () => AJUSTES.forcaSoco, (v) => AJUSTES.forcaSoco = v);
  slider('dda', 'IA adaptativa (DDA)', 0, 2, 0.05, () => AJUSTES.dda, (v) => AJUSTES.dda = v);

  // guarda os padrões pra resetar
  const padroes = controles.map((c) => ({ c, v: c.ler() }));

  // ---- BOTÕES ----
  const barra = document.createElement('div');
  barra.style.cssText = `display:flex;gap:8px;margin-top:14px;`;
  const btn = (txt, bg) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt;
    b.style.cssText = `flex:1;border:0;border-radius:10px;cursor:pointer;font-weight:800;font-size:12px;padding:9px 0;
      color:#fff;background:${bg};font-family:inherit;`; return b; };
  const bCopiar = btn('copiar valores', '#ff3d8b');
  const bReset = btn('resetar', 'rgba(255,255,255,.16)');
  bCopiar.addEventListener('click', async () => {
    const obj = {}; for (const c of controles) obj[c.chave] = c.ler();
    const txt = JSON.stringify(obj, null, 2);
    try { await navigator.clipboard.writeText(txt); } catch {}
    bCopiar.textContent = 'copiado! ✓'; setTimeout(() => bCopiar.textContent = 'copiar valores', 1600);
  });
  bReset.addEventListener('click', () => { for (const p of padroes) p.c.set(p.v); });
  barra.appendChild(bCopiar); barra.appendChild(bReset);
  painel.appendChild(barra);

  const dica = document.createElement('div');
  dica.style.cssText = `margin-top:9px;font-size:11px;opacity:.6;line-height:1.35;`;
  dica.textContent = 'Ajuste ao vivo. Gostou? Clique em "copiar valores" e me manda que eu fixo no jogo.';
  painel.appendChild(dica);

  // toggle na crase (`) — G é agarrar, então usamos o clássico ` de console
  addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') { e.preventDefault(); painel.style.display = painel.style.display === 'none' ? 'block' : 'none'; }
  });
  return painel;
}
