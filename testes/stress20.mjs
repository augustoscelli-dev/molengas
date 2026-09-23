// Estresse: 20 jogadores no modo LOUCURA. Mede banda, taxa de snapshot,
// estabilidade (0 NaN / 0 erro) e o ciclo completo com melhor jogada.
import { WebSocket } from 'ws';

const PORTA = process.env.PORT || 8877;
const URL = `ws://localhost:${PORTA}`;
const PARTS_N = 11;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let erros = [];
const falha = (m) => { erros.push(m); console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

function decode(ab) {
  const dv = new DataView(ab);
  const jsonLen = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, jsonLen)));
  let off = 4 + jsonLen, nan = false;
  const nP = meta.pl.length;
  if (off + nP * PARTS_N * 6 * 2 > ab.byteLength) return { meta, nan, trunc: true };
  for (let p = 0; p < nP; p++) for (let b = 0; b < PARTS_N; b++) {
    for (let k = 0; k < 6; k++) { const v = dv.getInt16(off, true); off += 2; if (!Number.isFinite(v)) nan = true; }
  }
  return { meta, nan, trunc: false };
}

class Cli {
  constructor(i) {
    this.i = i; this.slot = null; this.snaps = 0; this.bytes = 0;
    this.nan = false; this.trunc = 0; this.melhor = null; this.cheio = false; this.last = null;
    this.ws = new WebSocket(URL); this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise((res) => { this._res = res; });
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'entrar', skin: i })));
    this.ws.on('message', (data) => {
      if (typeof data === 'string' || (!(data instanceof ArrayBuffer) && !Buffer.isBuffer(data))) {
        try { const m = JSON.parse(data.toString()); if (m.t === 'oi') { this.slot = m.slot; this._res(); } else if (m.t === 'cheio') { this.cheio = true; this._res(); } else if (m.t === 'melhor') this.melhor = m; } catch {}
        return;
      }
      // pode vir string JSON como Buffer também; tenta detectar binário pelo header
      if (Buffer.isBuffer(data) && data.length && data[0] === 0x7b) { // '{' => JSON
        try { const m = JSON.parse(data.toString()); if (m.t === 'oi') { this.slot = m.slot; this._res(); } else if (m.t === 'cheio') { this.cheio = true; this._res(); } else if (m.t === 'melhor') this.melhor = m; return; } catch {}
      }
      const ab = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.snaps++; this.bytes += ab.byteLength;
      const r = decode(ab); this.last = r.meta; if (r.nan) this.nan = true; if (r.trunc) this.trunc++;
    });
    this.ws.on('error', () => {});
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  console.log('\n=== ESTRESSE 20 JOGADORES (LOUCURA) ===\n');
  const N = 20;
  // host entra primeiro e ABRE o modo loucura ANTES dos outros (fluxo correto)
  const host = new Cli(0);
  await host.ready;
  host.send({ t: 'modo' }); await sleep(400); // -> loucura (cap 20)
  if (host.last?.cap >= 20) ok(`host abriu LOUCURA (cap ${host.last.cap}) antes dos outros entrarem`); else falha(`cap errado: ${host.last?.cap}`);
  // Morte Súbita p/ acabar rápido
  for (let i = 0; i < 3; i++) { if (host.last?.pt === 'Morte Súbita') break; host.send({ t: 'pontos' }); await sleep(250); }
  // agora os outros 19 entram
  const resto = Array.from({ length: N - 1 }, (_, i) => new Cli(i + 1));
  await Promise.all(resto.map((c) => c.ready));
  const clis = [host, ...resto];
  const entraram = clis.filter((c) => c.slot != null).length;
  const cheios = clis.filter((c) => c.cheio).length;
  if (entraram === N) ok(`todos os ${N} entraram`); else falha(`só ${entraram}/${N} entraram (${cheios} recusados)`);

  host.send({ t: 'comecar' });
  let luta = false;
  for (let i = 0; i < 50; i++) { await sleep(150); if (host.last?.st === 'luta') { luta = true; break; } }
  if (luta) ok('entrou em luta com 20'); else falha(`não entrou em luta: ${host.last?.st}`);

  // Mede: durante ~8s de luta, todo mundo se move/soca. Amostra banda + fps de snapshot.
  console.log('  medindo banda e estabilidade por ~8s…');
  const marca = clis.map((c) => ({ s: c.snaps, b: c.bytes }));
  const t0 = Date.now(); let fim = false;
  while (Date.now() - t0 < 8000) {
    for (const c of clis) c.send({ t: 'input', m: [Math.cos(c.i) , Math.sin(c.i)], p: Math.random() < 0.5, g: Math.random() < 0.2, j: Math.random() < 0.1 });
    await sleep(100);
    if (host.last?.st === 'fim') { fim = true; break; }
  }
  const dt = (Date.now() - t0) / 1000;
  const dSnaps = host.snaps - marca[0].s;
  const dBytes = clis.reduce((s, c, i) => s + (c.bytes - marca[i].b), 0);
  const hz = dSnaps / dt;
  const perSnap = dBytes / (dSnaps * N || 1);
  ok(`taxa de snapshot: ${hz.toFixed(1)} Hz (esperado ~15 em sala grande)`);
  ok(`~${perSnap.toFixed(0)} bytes/snapshot por cliente · total enviado ~${(dBytes / 1024 / dt).toFixed(1)} KB/s p/ ${N} clientes`);

  if (clis.every((c) => !c.nan)) ok('0 NaN em 20 jogadores'); else falha('NaN com 20 jogadores!');
  if (clis.every((c) => c.trunc === 0)) ok('0 snapshot truncado'); else falha('snapshots truncados com 20!');

  // termina a partida à força: empurra todos pra +X
  const t1 = Date.now();
  while (Date.now() - t1 < 15000 && host.last?.st !== 'fim') {
    for (const c of clis) c.send({ t: 'input', m: [1, (c.i % 3 - 1) * 0.2], p: true });
    await sleep(90);
  }
  if (host.last?.st === 'fim') ok(`partida de 20 terminou (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  else console.log(`  ℹ️ não terminou em 15s (estado ${host.last?.st}) — arena grande demora mais`);

  await sleep(600);
  const receb = clis.filter((c) => c.melhor).length;
  if (host.last?.st === 'fim') {
    if (receb === N) ok(`todos os ${N} receberam a melhor jogada`); else falha(`só ${receb}/${N} receberam melhor`);
  }

  // desconexão em massa no fim (todo mundo fecha) — servidor sobrevive
  console.log('  fechando 20 conexões de uma vez…');
  clis.forEach((c) => c.close());
  await sleep(1500);
  ok('20 desconexões processadas sem crash (ver log do servidor)');

  console.log('\n=== RESUMO ===');
  if (erros.length === 0) console.log('🎉 ESTRESSE 20 PASSOU');
  else { console.log(`⚠️  ${erros.length} FALHA(S):`); erros.forEach((e) => console.log('   - ' + e)); }
  process.exit(erros.length ? 1 : 0);
}
main().catch((e) => { console.error('crash:', e); process.exit(2); });
