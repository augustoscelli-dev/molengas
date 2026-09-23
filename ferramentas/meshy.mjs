#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  meshy.mjs — automação Meshy → WOBBLERS
//
//  Gera assets 3D pela API do Meshy e já deixa tudo plugado no jogo:
//    · retexture   pinta um GLB que já existe (Jaeger, Kaiju) e re-riga
//    · lutador     texto → 3D → refine (textura) → rigging → skins.js + retrato
//    · arma        texto → 3D → refine → ARMAS_DEF (main.js)
//    · cenario     texto → 3D → refine → assets/modelos/
//
//  Uso:  npm run meshy -- <comando> [ids...] [opções]
//    saldo                    créditos na conta
//    listar                   itens do manifesto + custo estimado
//    gerar <id...|todos>      roda o pipeline completo dos itens
//    retrato <id...>          só re-renderiza a foto (assets/retratos/<id>.jpg)
//    integrar <id...>         só plugua no código (skins.js / main.js)
//    estado                   tarefas em andamento / concluídas
//  Opções: --paralelo N  --forcar  --sem-retrato  --sem-otimizar  --seco
//
//  Chave: MESHY_API_KEY no ambiente ou no .env da raiz (ver docs/meshy-automacao.md)
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const MANIFESTO = path.join(AQUI, 'meshy-assets.json');
const ESTADO_ARQ = path.join(AQUI, '.meshy-estado.json');
const BRUTOS = path.join(RAIZ, 'assets', 'meshy-brutos');
const MODELOS = path.join(RAIZ, 'assets', 'modelos');
const RETRATOS = path.join(RAIZ, 'assets', 'retratos');
const API = 'https://api.meshy.ai';
const POLL_MS = 8000;

// ─── utilidades ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toTimeString().slice(0, 8);
const log = (id, msg) => console.log(`${hora()} [${id}] ${msg}`);
const kb = (n) => `${Math.round(n / 1024)} KB`;

function carregarEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function lerJSON(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}
const salvarJSON = (arq, obj) => fs.writeFileSync(arq, JSON.stringify(obj, null, 2) + '\n');

function args() {
  const a = process.argv.slice(2);
  const op = { comando: a[0] || 'ajuda', ids: [], paralelo: 3, forcar: false, retrato: true, otimizar: true, seco: false };
  for (let i = 1; i < a.length; i++) {
    const t = a[i];
    if (t === '--paralelo') op.paralelo = Math.max(1, parseInt(a[++i], 10) || 1);
    else if (t === '--forcar') op.forcar = true;
    else if (t === '--sem-retrato') op.retrato = false;
    else if (t === '--sem-otimizar') op.otimizar = false;
    else if (t === '--seco') op.seco = true;
    else if (t.startsWith('--')) throw new Error(`opção desconhecida: ${t}`);
    else op.ids.push(t);
  }
  return op;
}

// ─── API Meshy ──────────────────────────────────────────────────────────────
function chave() {
  const k = process.env.MESHY_API_KEY;
  if (!k) {
    console.error('\n⛔ Falta a MESHY_API_KEY.\n   Crie a chave em https://www.meshy.ai/settings/api (plano pago) e salve em\n   ' + path.join(RAIZ, '.env') + ' assim:\n\n   MESHY_API_KEY=msy_xxxxxxxxxxxxxxxx\n');
    process.exit(2);
  }
  return k;
}

async function api(caminho, { method = 'GET', body } = {}, tentativa = 0) {
  const res = await fetch(API + caminho, {
    method,
    headers: { Authorization: `Bearer ${chave()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && tentativa < 8) {
    const espera = Math.min(60000, 3000 * 2 ** tentativa);
    console.log(`   ⏳ limite de requisições (429): esperando ${espera / 1000}s`);
    await sleep(espera);
    return api(caminho, { method, body }, tentativa + 1);
  }
  const texto = await res.text();
  let json; try { json = JSON.parse(texto); } catch { json = { raw: texto }; }
  if (!res.ok) {
    const msg = json?.message || json?.error || texto.slice(0, 300);
    const dica = res.status === 401 ? ' (chave inválida?)' : res.status === 402 ? ' (créditos insuficientes)' : '';
    throw new Error(`Meshy ${method} ${caminho} → HTTP ${res.status}${dica}: ${msg}`);
  }
  return json;
}

// Rotas de consulta por tipo de tarefa
const ROTA = {
  'text-to-3d': '/openapi/v2/text-to-3d',
  retexture: '/openapi/v1/retexture',
  rigging: '/openapi/v1/rigging',
  remesh: '/openapi/v1/remesh',
};

async function esperar(tipo, taskId, id, rotulo) {
  let ultimo = -1;
  for (;;) {
    const t = await api(`${ROTA[tipo]}/${taskId}`);
    if (t.status === 'SUCCEEDED') { log(id, `✅ ${rotulo} pronto (${t.consumed_credits ?? '?'} créditos)`); return t; }
    if (t.status === 'FAILED' || t.status === 'CANCELED') {
      throw new Error(`${rotulo} ${t.status}: ${t.task_error?.message || 'sem detalhe'}`);
    }
    const p = t.progress ?? 0;
    if (p !== ultimo) { log(id, `   ${rotulo}: ${t.status} ${p}%${t.preceding_tasks ? ` (fila: ${t.preceding_tasks})` : ''}`); ultimo = p; }
    await sleep(POLL_MS);
  }
}

async function baixar(url, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou (${res.status}): ${url.slice(0, 80)}…`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}

const dataURI = (arq) => 'data:application/octet-stream;base64,' + fs.readFileSync(arq).toString('base64');

// ─── otimização (gltf-transform via npx) ────────────────────────────────────
function gltfTransform(argsCli) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(cmd, ['-y', '@gltf-transform/cli@4', ...argsCli], { cwd: RAIZ, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`gltf-transform ${argsCli[0]} falhou:\n${(r.stderr || r.stdout || '').slice(-600)}`);
  return r.stdout;
}

function otimizar(entrada, saida, id, { texturas = 1024 } = {}) {
  const tmp = saida + '.tmp.glb', tmp2 = saida + '.tmp2.glb';
  try {
    log(id, `🔧 otimizando (texturas ≤ ${texturas}px em WebP + quantização)…`);
    gltfTransform(['resize', entrada, tmp, '--width', String(texturas), '--height', String(texturas)]);
    // WebP q82: -60% no arquivo, diferença visual < 1/255 por canal (medido no Brasa)
    gltfTransform(['webp', tmp, tmp2, '--quality', '82']);
    gltfTransform(['quantize', tmp2, saida]);
    fs.rmSync(tmp, { force: true }); fs.rmSync(tmp2, { force: true });
    log(id, `   ${kb(fs.statSync(entrada).size)} → ${kb(fs.statSync(saida).size)}`);
  } catch (e) {
    fs.rmSync(tmp, { force: true }); fs.rmSync(tmp2, { force: true });
    log(id, `⚠️ otimização falhou, usando o arquivo bruto. ${e.message.split('\n')[0]}`);
    fs.copyFileSync(entrada, saida);
  }
}

function publicar(bruto, item, op) {
  const destino = path.join(MODELOS, `${item.saida}.glb`);
  if (fs.existsSync(destino)) {
    const bk = path.join(BRUTOS, 'backup', `${item.saida}.${Date.now()}.glb`);
    fs.mkdirSync(path.dirname(bk), { recursive: true });
    fs.copyFileSync(destino, bk);
    log(item.id, `💾 backup do anterior em ${path.relative(RAIZ, bk)}`);
  }
  if (op.otimizar) otimizar(bruto, destino, item.id, { texturas: item.texturasPx || 1024 });
  else fs.copyFileSync(bruto, destino);
  log(item.id, `📦 assets/modelos/${item.saida}.glb (${kb(fs.statSync(destino).size)})`);
  return destino;
}

// ─── estado (retomada) ──────────────────────────────────────────────────────
const estado = () => lerJSON(ESTADO_ARQ, {});
function marcar(id, patch) {
  const e = estado();
  e[id] = { ...(e[id] || {}), ...patch, atualizado: new Date().toISOString() };
  salvarJSON(ESTADO_ARQ, e);
  return e[id];
}

// Reaproveita uma tarefa já criada (se ainda existir e tiver dado certo)
async function tarefaOuNova(id, chaveEstado, tipo, criar, rotulo, forcar) {
  const salvo = estado()[id]?.[chaveEstado];
  if (salvo && !forcar) {
    try {
      const t = await api(`${ROTA[tipo]}/${salvo}`);
      if (t.status === 'SUCCEEDED') { log(id, `↩️  ${rotulo}: reaproveitando tarefa ${salvo.slice(0, 8)}…`); return t; }
      if (t.status === 'PENDING' || t.status === 'IN_PROGRESS') { log(id, `↩️  ${rotulo}: tarefa ${salvo.slice(0, 8)}… ainda rodando`); return esperar(tipo, salvo, id, rotulo); }
    } catch { /* expirou ou sumiu: cria outra */ }
  }
  const { result } = await criar();
  marcar(id, { [chaveEstado]: result });
  log(id, `🚀 ${rotulo} criado: ${result}`);
  return esperar(tipo, result, id, rotulo);
}

// ─── pipelines ──────────────────────────────────────────────────────────────
function opcoes(manifesto, item) {
  return { modeloIA: 'latest', resolucaoTextura: '2k', polycount: 30000, pbr: true, ...(manifesto.opcoes || {}), ...item };
}

async function gerarPreviewRefine(item, o, op) {
  const preview = await tarefaOuNova(item.id, 'preview', 'text-to-3d', () => api('/openapi/v2/text-to-3d', {
    method: 'POST',
    body: {
      mode: 'preview',
      prompt: item.prompt,
      ai_model: o.modeloIA,
      model_type: o.tipoModelo || 'standard',
      should_remesh: true,
      topology: 'triangle',
      target_polycount: o.polycount,
      ...(item.tipo === 'lutador' ? { pose_mode: o.pose || 't-pose' } : {}),
      origin_at: 'bottom',
      target_formats: ['glb'],
      moderation: false,
    },
  }), 'geometria (preview)', op.forcar);

  const refine = await tarefaOuNova(item.id, 'refine', 'text-to-3d', () => api('/openapi/v2/text-to-3d', {
    method: 'POST',
    body: {
      mode: 'refine',
      preview_task_id: preview.id,
      enable_pbr: !!o.pbr,
      texture_resolution: o.resolucaoTextura,
      ...(item.promptTextura ? { texture_prompt: item.promptTextura } : {}),
      ai_model: o.modeloIA,
      target_formats: ['glb'],
      moderation: false,
    },
  }), 'textura (refine)', op.forcar);
  return refine;
}

async function rigar(item, o, op, inputTaskId, urlModeloFallback) {
  const corpo = { height_meters: o.altura || 1.9 };
  try {
    return await tarefaOuNova(item.id, 'rigging', 'rigging', () => api('/openapi/v1/rigging', {
      method: 'POST', body: { input_task_id: inputTaskId, ...corpo },
    }), 'rigging', op.forcar);
  } catch (e) {
    if (!urlModeloFallback || !/HTTP 400/.test(e.message)) throw e;
    log(item.id, `   rigging por task_id recusado, tentando pela URL do modelo…`);
    return tarefaOuNova(item.id, 'rigging', 'rigging', () => api('/openapi/v1/rigging', {
      method: 'POST', body: { model_url: urlModeloFallback, ...corpo },
    }), 'rigging', true);
  }
}

async function pipelineRetexture(item, o, op) {
  const entrada = path.join(RAIZ, item.entrada);
  if (!fs.existsSync(entrada)) throw new Error(`entrada não existe: ${item.entrada}`);
  const ret = await tarefaOuNova(item.id, 'retexture', 'retexture', () => api('/openapi/v1/retexture', {
    method: 'POST',
    body: {
      model_url: dataURI(entrada),
      text_style_prompt: item.prompt,
      ai_model: o.modeloIA === 'meshy-7.1' ? 'meshy-7' : o.modeloIA,
      enable_original_uv: false,
      enable_pbr: !!o.pbr,
      texture_resolution: o.resolucaoTextura,
      target_formats: ['glb'],
    },
  }), 'retexture', op.forcar);
  const rig = await rigar(item, o, op, ret.id, ret.model_urls?.glb);
  const bruto = await baixar(rig.result.rigged_character_glb_url, path.join(BRUTOS, `${item.saida}.rigado.glb`));
  return publicar(bruto, item, op);
}

async function pipelineLutador(item, o, op) {
  const refine = await gerarPreviewRefine(item, o, op);
  await baixar(refine.model_urls.glb, path.join(BRUTOS, `${item.saida}.refine.glb`));
  const rig = await rigar(item, o, op, refine.id, refine.model_urls.glb);
  const bruto = await baixar(rig.result.rigged_character_glb_url, path.join(BRUTOS, `${item.saida}.rigado.glb`));
  return publicar(bruto, item, op);
}

async function pipelineProp(item, o, op) {
  const refine = await gerarPreviewRefine(item, o, op);
  const bruto = await baixar(refine.model_urls.glb, path.join(BRUTOS, `${item.saida}.refine.glb`));
  return publicar(bruto, item, op);
}

// ─── integração no código ───────────────────────────────────────────────────
const hex = (c) => '0x' + (String(c).replace(/^#|^0x/i, '').padStart(6, '0'));

function integrarLutador(item) {
  const arq = path.join(RAIZ, 'src', 'skins.js');
  let src = fs.readFileSync(arq, 'utf8');
  if (new RegExp(`id:\\s*'${item.id}'`).test(src)) { log(item.id, 'ℹ️  já existe em src/skins.js'); return false; }
  const c = { head: '8fa8c8', torso: '8fa8c8', pelvis: '6f86a6', arms: '8fa8c8', legs: '6f86a6', ...(item.cores || {}) };
  const entrada =
    `  {\n    id: '${item.id}', nome: '${item.nome || item.id.toUpperCase()}', modelo: '${item.saida}',\n` +
    `    cores: { head: ${hex(c.head)}, torso: ${hex(c.torso)}, pelvis: ${hex(c.pelvis)}, arms: ${hex(c.arms)}, legs: ${hex(c.legs)} },\n` +
    `    face: 'normal', extras() {},\n  },\n`;
  // insere depois do último lutador com "modelo:" (Jaeger/Kaiju/…), antes do "];" que fecha a lista
  const ultimo = src.lastIndexOf('modelo: \'');
  const fecha = src.indexOf('\n];', ultimo);
  if (ultimo < 0 || fecha < 0) throw new Error('não achei a lista de lutadores em src/skins.js');
  src = src.slice(0, fecha + 1) + entrada + src.slice(fecha + 1);
  fs.writeFileSync(arq, src);
  log(item.id, `🧩 lutador '${item.nome || item.id}' adicionado em src/skins.js`);
  return true;
}

function integrarArma(item) {
  const arq = path.join(RAIZ, 'src', 'main.js');
  let src = fs.readFileSync(arq, 'utf8');
  const re = new RegExp(`(\\n  ${item.id}: \\{\\n    icone: '[^']*',\\n)`);
  const m = src.match(re);
  if (!m) throw new Error(`não achei ARMAS_DEF.${item.id} em src/main.js`);
  if (src.includes(`glb: '${item.saida}'`)) { log(item.id, 'ℹ️  já plugado em ARMAS_DEF'); return false; }
  const linha = `    glb: '${item.saida}', escala: ${item.escala ?? 0.6}, // modelo Meshy (ferramentas/meshy.mjs)\n`;
  src = src.replace(re, `$1${linha}`);
  fs.writeFileSync(arq, src);
  log(item.id, `🧩 ARMAS_DEF.${item.id} agora usa assets/modelos/${item.saida}.glb (escala ${item.escala ?? 0.6})`);
  return true;
}

function integrar(item) {
  if (item.tipo === 'lutador') return integrarLutador(item);
  if (item.tipo === 'arma') return integrarArma(item);
  return false; // retexture e cenário: o arquivo já é o que o jogo carrega
}

// ─── retrato (Electron renderiza preview-glb.html) ──────────────────────────
function electronBin() {
  const dir = path.join(RAIZ, 'desktop', 'node_modules', 'electron');
  const txt = path.join(dir, 'path.txt');
  if (!fs.existsSync(txt)) return null;
  const bin = path.join(dir, 'dist', fs.readFileSync(txt, 'utf8').trim());
  return fs.existsSync(bin) ? bin : null;
}

function retrato(item) {
  return new Promise((resolve) => {
    const bin = electronBin();
    if (!bin) { log(item.id, '⚠️ retrato pulado: rode `cd desktop && npm install` pra ter o Electron'); return resolve(false); }
    const saida = path.join(RETRATOS, `${item.id}.jpg`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // o VS Code injeta isso e quebra o Electron
    const p = spawn(bin, [path.join(AQUI, 'retrato.cjs'), `assets/modelos/${item.saida}.glb`, saida, String(item.anguloRetrato ?? -28)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => {
      if (code === 0 && fs.existsSync(saida)) { log(item.id, `🖼️  retrato: assets/retratos/${item.id}.jpg`); resolve(true); }
      else { log(item.id, `⚠️ retrato falhou (exit ${code}): ${out.trim().split('\n').pop() || ''}`); resolve(false); }
    });
  });
}

// ─── custo estimado (docs.meshy.ai/en/api/pricing) ──────────────────────────
function custo(item, o) {
  const tex = o.resolucaoTextura === '8k' ? 15 : 10;
  const preview = (o.tipoModelo === 'smart-topology' ? 5 : 20) + (/meshy-7/.test(o.modeloIA) && o.resolucaoGeometria ? 5 : 0);
  if (item.tipo === 'retexture') return tex + 5;
  if (item.tipo === 'lutador') return preview + tex + 5;
  return preview + tex;
}

// ─── execução ───────────────────────────────────────────────────────────────
async function rodarItem(item, manifesto, op) {
  const o = opcoes(manifesto, item);
  const feito = estado()[item.id]?.concluido;
  if (feito && !op.forcar) { log(item.id, `✔ já concluído em ${feito} (use --forcar pra refazer)`); return; }
  log(item.id, `▶ ${item.tipo} → assets/modelos/${item.saida}.glb (~${custo(item, o)} créditos)`);
  if (op.seco) return;
  fs.mkdirSync(BRUTOS, { recursive: true });
  if (item.tipo === 'retexture') await pipelineRetexture(item, o, op);
  else if (item.tipo === 'lutador') await pipelineLutador(item, o, op);
  else if (item.tipo === 'arma' || item.tipo === 'cenario') await pipelineProp(item, o, op);
  else throw new Error(`tipo desconhecido: ${item.tipo}`);
  integrar(item);
  if (op.retrato && (item.tipo === 'lutador' || item.tipo === 'retexture')) await retrato(item);
  marcar(item.id, { concluido: new Date().toISOString() });
  log(item.id, '🏁 concluído');
}

async function pool(itens, n, fn) {
  const fila = [...itens]; const erros = [];
  await Promise.all(Array.from({ length: Math.min(n, fila.length) }, async () => {
    while (fila.length) {
      const it = fila.shift();
      try { await fn(it); } catch (e) { erros.push([it.id, e.message]); log(it.id, `⛔ ${e.message}`); }
    }
  }));
  return erros;
}

function selecionar(manifesto, ids) {
  if (!ids.length) throw new Error('diga quais ids (ou "todos")');
  if (ids.includes('todos')) return manifesto.itens;
  const porId = Object.fromEntries(manifesto.itens.map((i) => [i.id, i]));
  return ids.map((id) => { if (!porId[id]) throw new Error(`id não existe no manifesto: ${id}`); return porId[id]; });
}

async function main() {
  carregarEnv();
  const op = args();
  const manifesto = lerJSON(MANIFESTO, null);
  if (!manifesto) throw new Error(`manifesto não encontrado: ${MANIFESTO}`);

  switch (op.comando) {
    case 'saldo': {
      const { balance } = await api('/openapi/v1/balance');
      console.log(`💰 saldo Meshy: ${balance} créditos`);
      break;
    }
    case 'listar': {
      let total = 0;
      for (const it of manifesto.itens) {
        const o = opcoes(manifesto, it); const c = custo(it, o); total += c;
        const st = estado()[it.id]?.concluido ? '✔' : ' ';
        console.log(`${st} ${it.id.padEnd(12)} ${it.tipo.padEnd(10)} → ${it.saida}.glb`.padEnd(52) + `~${c} créditos`);
      }
      console.log(`\nTotal se gerar tudo: ~${total} créditos`);
      break;
    }
    case 'gerar': {
      const itens = selecionar(manifesto, op.ids);
      if (!op.seco) chave();
      const erros = await pool(itens, op.paralelo, (it) => rodarItem(it, manifesto, op));
      console.log(erros.length ? `\n⛔ ${erros.length} item(ns) falharam: ${erros.map((e) => e[0]).join(', ')}` : '\n🎉 tudo pronto');
      process.exit(erros.length ? 1 : 0);
      break;
    }
    case 'retrato': {
      for (const it of selecionar(manifesto, op.ids)) await retrato(it);
      break;
    }
    case 'integrar': {
      for (const it of selecionar(manifesto, op.ids)) integrar(it);
      break;
    }
    case 'estado': {
      console.log(JSON.stringify(estado(), null, 2));
      break;
    }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
}

main().catch((e) => { console.error(`\n⛔ ${e.message}`); process.exit(1); });
