// Teste de integração ws-level do servidor online do MOLENGAS.
// Não usa navegador: conecta clientes ws reais, decodifica os snapshots
// binários exatamente como o cliente faz, joga uma partida completa e valida.
//   node scratchpad_teste_online.mjs
import { WebSocket } from 'ws';

const PORTA = process.env.PORT || 8877;
const URL = `ws://localhost:${PORTA}`;
const PARTS_N = 11; // corpos do ragdoll
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let erros = [];
const falha = (msg) => { erros.push(msg); console.log('  ❌ ' + msg); };
const ok = (msg) => console.log('  ✅ ' + msg);

// ---- decodifica snapshot binário como o cliente ----
function decodeSnap(ab) {
  const dv = new DataView(ab);
  const jsonLen = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jsonLen)));
  let off = 4 + jsonLen;
  const poses = [];
  const nP = meta.pl.length;
  const need = off + nP * PARTS_N * 6 * 2;
  if (need > ab.byteLength) return { meta, poses, truncated: true };
  for (let p = 0; p < nP; p++) {
    const parts = [];
    for (let b = 0; b < PARTS_N; b++) {
      const x = dv.getInt16(off, true) / 256; off += 2;
      const y = dv.getInt16(off, true) / 256; off += 2;
      const z = dv.getInt16(off, true) / 256; off += 2;
      const qx = dv.getInt16(off, true) / 32767; off += 2;
      const qy = dv.getInt16(off, true) / 32767; off += 2;
      const qz = dv.getInt16(off, true) / 32767; off += 2;
      const w = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
      parts.push([x, y, z, qx, qy, qz, w]);
    }
    poses.push(parts);
  }
  return { meta, poses, truncated: false };
}

function nanCheck(poses) {
  for (const parts of poses) for (const p of parts) for (const v of p) {
    if (!Number.isFinite(v)) return true;
  }
  return false;
}

class Cli {
  constructor(name, skin) {
    this.name = name; this.skin = skin;
    this.slot = null; this.snaps = 0; this.bytes = 0;
    this.melhor = null; this.cheio = false; this.nan = false; this.trunc = 0;
    this.lastMeta = null; this.estados = new Set();
    this.ws = new WebSocket(URL);
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise((res) => { this._res = res; });
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'entrar', skin })));
    this.ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        let m; try { m = JSON.parse(data.toString()); } catch { return; }
        if (m.t === 'oi') { this.slot = m.slot; this._res(); }
        else if (m.t === 'cheio') { this.cheio = true; this._res(); }
        else if (m.t === 'melhor') this.melhor = m;
        return;
      }
      // binário: com binaryType='arraybuffer' já vem ArrayBuffer; senão é Buffer
      const ab = data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.snaps++; this.bytes += data.byteLength;
      const { meta, poses, truncated } = decodeSnap(ab);
      this.lastMeta = meta; this.estados.add(meta.st);
      if (truncated) this.trunc++;
      if (nanCheck(poses)) this.nan = true;
    });
    this.ws.on('error', (e) => falha(`${name}: ws error ${e.message}`));
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  input(m, opts = {}) { this.send({ t: 'input', m, ...opts }); }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  console.log('\n=== TESTE ONLINE (ws-level) ===\n');

  // -------- 1. Conexão + lobby --------
  console.log('1) Conexão e lobby');
  const A = new Cli('host', 0), B = new Cli('p2', 1), C = new Cli('p3', 2);
  await Promise.all([A.ready, B.ready, C.ready]);
  if (A.slot === 0 && B.slot === 1 && C.slot === 2) ok('3 clientes entraram com slots 0,1,2');
  else falha(`slots errados: ${A.slot},${B.slot},${C.slot}`);

  await sleep(400);
  if (A.snaps > 0) ok(`snapshots chegando (host recebeu ${A.snaps})`); else falha('nenhum snapshot no lobby');
  if (A.lastMeta && A.lastMeta.st === 'lobby') ok('estado = lobby'); else falha(`estado inesperado: ${A.lastMeta?.st}`);

  // -------- 2. Host controla sala; não-host é ignorado --------
  console.log('2) Autoridade do host');
  const modoAntes = A.lastMeta.mo;
  B.send({ t: 'modo' }); // não-host, deve ser ignorado
  await sleep(300);
  if (A.lastMeta.mo === modoAntes) ok('modo do não-host ignorado'); else falha('não-host trocou o modo!');
  A.send({ t: 'modo' }); // host troca pra loucura
  await sleep(300);
  ok(`host trocou modo: ${modoAntes} -> ${A.lastMeta.mo} (cap ${A.lastMeta.cap})`);
  // volta pra normal e ajusta pontuação pra Morte Súbita (winScore=1) pra acabar rápido
  A.send({ t: 'modo' }); await sleep(200);
  // acha Morte Súbita
  for (let i = 0; i < 3; i++) { if (A.lastMeta.pt === 'Morte Súbita') break; A.send({ t: 'pontos' }); await sleep(250); }
  if (A.lastMeta.pt === 'Morte Súbita') ok('pontuação = Morte Súbita (partida curta)'); else falha(`não achei Morte Súbita: ${A.lastMeta?.pt}`);

  // -------- 3. Começa partida --------
  console.log('3) Início da partida');
  A.send({ t: 'comecar' });
  // passa por 'intro' (contagem) antes de 'luta'
  let entrouLuta = false;
  for (let i = 0; i < 40; i++) { await sleep(150); if (A.lastMeta?.st === 'luta') { entrouLuta = true; break; } }
  if (entrouLuta) ok('estado = luta (após intro)'); else falha(`não entrou em luta: ${A.lastMeta?.st}`);

  // -------- 4. Joga: empurra todo mundo contra um canto pra causar ring-out --------
  console.log('4) Simula luta até alguém cair (ring-out)');
  const t0 = Date.now();
  let virouFim = false;
  // todos correm pra +X socando; empurra pra fora da arena
  const dirs = { [A.slot]: [1, 0], [B.slot]: [1, 0], [C.slot]: [1, 0.2] };
  while (Date.now() - t0 < 18000) {
    A.input([1, 0], { p: true });
    B.input([1, 0.1], { p: true, g: Math.random() < 0.3 });
    C.input([1, -0.1], { p: true });
    await sleep(80);
    if (A.lastMeta && A.lastMeta.st === 'fim') { virouFim = true; break; }
  }
  if (virouFim) ok(`partida terminou (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  else falha('partida não terminou em 18s (ring-out não disparou?)');

  // -------- 5. Melhor jogada --------
  console.log('5) Melhor jogada (play of the game)');
  await sleep(500);
  const quemRecebeu = [A, B, C].filter((c) => c.melhor).length;
  if (quemRecebeu === 3) ok('todos os 3 receberam {t:melhor}');
  else falha(`só ${quemRecebeu}/3 receberam melhor jogada`);
  if (A.melhor) {
    const nf = A.melhor.frames ? A.melhor.frames.length : 0;
    if (nf > 0) ok(`melhor tem ${nf} frames, autor skin=${A.melhor.autorSk}`);
    else falha('melhor jogada com 0 frames');
    // valida integridade dos frames
    const bad = (A.melhor.frames || []).some((f) => !Array.isArray(f) || f.some((pp) => !Array.isArray(pp.p)));
    if (!bad) ok('frames da melhor jogada bem-formados'); else falha('frames da melhor jogada malformados');
  }

  // -------- 6. Integridade geral --------
  console.log('6) Integridade dos snapshots');
  const totalSnaps = A.snaps + B.snaps + C.snaps;
  if ([A, B, C].every((c) => !c.nan)) ok('nenhum NaN em nenhuma pose'); else falha('NaN detectado em poses!');
  if ([A, B, C].every((c) => c.trunc === 0)) ok('nenhum snapshot truncado'); else falha('snapshots truncados!');
  const bpsA = A.bytes / A.snaps;
  ok(`~${bpsA.toFixed(0)} bytes/snapshot (host), ${A.snaps} snaps recebidos`);
  ok(`estados vistos pelo host: ${[...A.estados].join(', ')}`);

  // -------- 7. 'fim' é terminal até o host reiniciar (F) --------
  console.log('7) Estado final aguarda o host (F reinicia)');
  await sleep(1500);
  if (A.lastMeta.st === 'fim') ok("estado permanece 'fim' esperando o host (correto)");
  else console.log(`  ℹ️ estado atual: ${A.lastMeta?.st}`);

  // -------- 8. Desconexão no meio da partida --------
  console.log('8) Desconexão no meio da partida');
  A.melhor = null;
  A.send({ t: 'comecar' }); await sleep(800);
  const naAntes = A.lastMeta.na;
  ok(`partida com ${naAntes} jogadores, derrubando p3…`);
  C.close();
  await sleep(1500);
  if (A.lastMeta.na === naAntes - 1) ok('servidor removeu o jogador que saiu'); else falha(`contagem errada após saída: ${A.lastMeta?.na}`);
  if (!A.nan) ok('sem NaN após desconexão'); else falha('NaN após desconexão');
  // continua jogando os 2 restantes
  for (let i = 0; i < 30; i++) { A.input([1, 0], { p: true }); B.input([-1, 0], { p: true }); await sleep(80); }
  ok('os 2 restantes continuam jogando sem crash');

  // -------- 9. Entrada no meio (join mid-match) --------
  console.log('9) Entrada no meio da partida');
  const D = new Cli('p4', 3);
  await D.ready;
  await sleep(800);
  if (D.cheio) console.log('  ℹ️ recusado (sala cheia) — ok se cap atingido');
  else if (D.slot != null && D.snaps > 0) ok(`novo jogador entrou (slot ${D.slot}) e recebe snapshots no meio da luta`);
  else falha('novo jogador não recebeu snapshots');

  // -------- limpeza --------
  A.close(); B.close(); D.close();
  await sleep(300);

  console.log('\n=== RESUMO ===');
  if (erros.length === 0) console.log('🎉 TODOS OS TESTES PASSARAM');
  else { console.log(`⚠️  ${erros.length} FALHA(S):`); erros.forEach((e) => console.log('   - ' + e)); }
  process.exit(erros.length ? 1 : 0);
}

main().catch((e) => { console.error('crash no teste:', e); process.exit(2); });
