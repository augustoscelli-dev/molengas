#!/usr/bin/env node
// higgsfield.mjs — gera imagens pela API da Higgsfield (modelo Soul) e salva em assets/.
//
//   npm run higgs -- estimar "<prompt>"
//   npm run higgs -- gerar <arquivo-saida.jpg> "<prompt>" [--proporcao 16:9] [--resolucao 1080p] [--n 1]
//
// Chave: HF_API_KEY_ID e HF_API_KEY_SECRET no .env da raiz (fora do git).
// Com --n > 1 salva <nome>-1.jpg, <nome>-2.jpg… pra escolher a melhor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.higgsfield.ai';
const MODELO = '/higgsfield-ai/soul/standard';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function carregarEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) return;
  for (const l of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function auth() {
  const { HF_API_KEY_ID: id, HF_API_KEY_SECRET: sec } = process.env;
  if (!id || !sec) { console.error('⛔ Falta HF_API_KEY_ID / HF_API_KEY_SECRET no .env'); process.exit(2); }
  return `Key ${id}:${sec}`;
}
async function req(url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text(); let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if (!res.ok) throw new Error(`Higgsfield HTTP ${res.status}: ${j.detail || j.message || txt.slice(0, 300)}`);
  return j;
}

function args() {
  const a = process.argv.slice(2), op = { cmd: a[0], pos: [], proporcao: '16:9', resolucao: '1080p', n: 1 };
  for (let i = 1; i < a.length; i++) {
    if (a[i] === '--proporcao') op.proporcao = a[++i];
    else if (a[i] === '--resolucao') op.resolucao = a[++i];
    else if (a[i] === '--n') op.n = Math.max(1, Math.min(4, parseInt(a[++i], 10) || 1));
    else op.pos.push(a[i]);
  }
  return op;
}

async function main() {
  carregarEnv();
  const op = args();
  if (op.cmd === 'estimar') {
    const e = await req('/estimate' + MODELO, { prompt: op.pos[0] || 'teste', aspect_ratio: op.proporcao, resolution: op.resolucao, num_images: op.n });
    console.log(`💰 ${e.credits} créditos (~US$ ${e.usd}) por pedido`);
    return;
  }
  if (op.cmd !== 'gerar' || op.pos.length < 2) {
    console.log('uso: npm run higgs -- gerar <saida.jpg> "<prompt>" [--proporcao 16:9] [--resolucao 1080p] [--n 1]');
    process.exit(1);
  }
  const [saidaRel, prompt] = op.pos;
  const saida = path.resolve(RAIZ, saidaRel);
  const r = await req(MODELO, { prompt, aspect_ratio: op.proporcao, resolution: op.resolucao, num_images: op.n });
  console.log(`🚀 ${path.basename(saida)}: pedido ${r.request_id}`);
  let st;
  for (;;) {
    await sleep(4000);
    st = await req(r.status_url);
    if (['completed', 'failed', 'nsfw', 'canceled'].includes(st.status)) break;
  }
  if (st.status !== 'completed') throw new Error(`${path.basename(saida)}: ${st.status} ${st.error || ''}`);
  const imgs = st.images || [];
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  for (let i = 0; i < imgs.length; i++) {
    const dest = imgs.length > 1 ? saida.replace(/(\.\w+)$/, `-${i + 1}$1`) : saida;
    const b = Buffer.from(await (await fetch(imgs[i].url)).arrayBuffer());
    fs.writeFileSync(dest, b);
    console.log(`🖼️  ${path.relative(RAIZ, dest)} (${Math.round(b.length / 1024)} KB)`);
  }
}
main().catch((e) => { console.error('⛔', e.message); process.exit(1); });
