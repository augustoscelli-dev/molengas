// Regressão dos bugs HIGH corrigidos:
//  A) mensagem 'input' malformada NÃO derruba o servidor (DoS)
//  B) cair abaixo de 2 jogadores no meio da luta NÃO trava (volta pro lobby)
//  C) trocar pra 'normal' com >8 jogadores é recusado (cap)
import { WebSocket } from 'ws';
const URL = `ws://localhost:${process.env.PORT || 8877}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let erros = [];
const ok = (m) => console.log('  ✅ ' + m);
const falha = (m) => { erros.push(m); console.log('  ❌ ' + m); };

function mkCli(skin) {
  const c = { slot: null, last: null, cheio: false };
  c.ws = new WebSocket(URL); c.ws.binaryType = 'arraybuffer';
  c.ready = new Promise((res) => { c._res = res; });
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'entrar', skin })));
  c.ws.on('message', (d) => {
    if (Buffer.isBuffer(d) && d.length && d[0] === 0x7b) { try { const m = JSON.parse(d.toString()); if (m.t === 'oi') { c.slot = m.slot; c._res(); } else if (m.t === 'cheio') { c.cheio = true; c._res(); } } catch {} return; }
    if (d instanceof ArrayBuffer) { try { const dv = new DataView(d); const jl = dv.getUint32(0, true); c.last = JSON.parse(new TextDecoder().decode(new Uint8Array(d, 4, jl))); } catch {} }
  });
  c.send = (o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
  c.raw = (s) => { if (c.ws.readyState === 1) c.ws.send(s); };
  return c;
}
const alive = async () => { // o servidor ainda responde? conecta um probe
  const p = mkCli(9); await Promise.race([p.ready, sleep(1500)]);
  const vivo = p.slot != null || p.cheio; p.ws.close(); return vivo;
};

async function main() {
  console.log('\n=== REGRESSÃO (bugs HIGH) ===\n');

  // ---- A) input malformado ----
  console.log('A) input malformado não derruba o servidor');
  const A = mkCli(0), B = mkCli(1);
  await Promise.all([A.ready, B.ready]);
  A.send({ t: 'input' });                    // sem .m
  A.send({ t: 'input', m: null });           // m null
  A.send({ t: 'input', m: 'xis' });          // m string
  A.send({ t: 'input', m: [] });             // m vazio
  A.send({ t: 'input', m: [{}, {}] });       // m com objetos
  A.raw('{"t":"input"}');                     // idem via raw
  A.raw('não é json');                        // lixo
  await sleep(500);
  if (await alive()) ok('servidor sobreviveu a inputs malformados'); else falha('SERVIDOR CAIU com input malformado!');

  // ---- C) cap ao trocar de modo ----
  console.log('C) trocar pra normal com muitos jogadores é recusado');
  // abre loucura e enche com 10
  A.send({ t: 'modo' }); await sleep(300); // -> loucura (cap 20)
  const extras = Array.from({ length: 8 }, (_, i) => mkCli(i + 2));
  await Promise.all(extras.map((c) => c.ready)); // agora 10 no total
  await sleep(300);
  const capAntes = A.last?.cap, naAntes = A.last?.na;
  A.send({ t: 'modo' }); await sleep(400); // tenta voltar pra normal (cap 8) com 10 jogadores
  if (A.last?.cap === capAntes) ok(`troca recusada: ${naAntes} jogadores > cap normal, manteve cap ${A.last?.cap}`);
  else falha(`deixou encolher a sala pra cap ${A.last?.cap} com ${naAntes} jogadores`);
  extras.forEach((c) => c.ws.close());
  await sleep(400);

  // ---- B) cair abaixo de 2 no meio da luta ----
  console.log('B) desconexão que deixa <2 jogadores volta pro lobby');
  // agora só A e B; garante modo normal caberia, mas estamos em loucura — tudo bem
  // começa a partida
  A.send({ t: 'comecar' });
  let luta = false;
  for (let i = 0; i < 40; i++) { await sleep(150); if (A.last?.st === 'luta') { luta = true; break; } }
  if (!luta) { falha('não entrou em luta pra testar'); }
  else {
    B.ws.close(); // deixa só A -> jogadores.size == 1
    await sleep(1500);
    if (A.last?.st === 'lobby') ok("caiu pra 1 jogador e voltou pro 'lobby' (sem travar)");
    else falha(`travou no estado '${A.last?.st}' com 1 jogador`);
    if (await alive()) ok('servidor segue vivo após o esvaziamento'); else falha('servidor morreu');
  }

  // ---- D) flood de mensagens é ignorado sem derrubar ----
  console.log('D) flood de mensagens (anti-DoS por volume)');
  const F1 = mkCli(0), F2 = mkCli(1);
  await Promise.all([F1.ready, F2.ready]);
  for (let i = 0; i < 3000; i++) F1.send({ t: 'grito', g: i % 4 }); // rajada muito acima do limite
  await sleep(800);
  F2.send({ t: 'lutador' }); await sleep(500); // outro cliente segue funcionando?
  if (await alive()) ok('servidor vivo após rajada de 3000 msgs'); else falha('flood derrubou o servidor');
  if (F2.last?.st != null) ok('outros clientes seguem recebendo snapshots'); else falha('flood travou os snapshots');
  F1.ws.close(); F2.ws.close();

  A.ws.close();
  await sleep(300);
  console.log('\n=== RESUMO ===');
  if (erros.length === 0) console.log('🎉 REGRESSÃO PASSOU');
  else { console.log(`⚠️  ${erros.length} FALHA(S):`); erros.forEach((e) => console.log('   - ' + e)); }
  process.exit(erros.length ? 1 : 0);
}
main().catch((e) => { console.error('crash:', e); process.exit(2); });
