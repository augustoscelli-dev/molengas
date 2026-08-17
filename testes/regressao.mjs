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

function mkCli(skin, tk, sala) {
  const c = { slot: null, last: null, cheio: false, tk: null, cd: null, s404: false };
  c.ws = new WebSocket(URL); c.ws.binaryType = 'arraybuffer';
  c.ready = new Promise((res) => { c._res = res; });
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'entrar', skin, tk: tk || undefined, sala: sala || undefined })));
  c.ws.on('message', (d) => {
    if (Buffer.isBuffer(d) && d.length && d[0] === 0x7b) { try { const m = JSON.parse(d.toString()); if (m.t === 'oi') { c.slot = m.slot; c.tk = m.tk || null; c.cd = m.cd || null; c._res(); } else if (m.t === 'cheio') { c.cheio = true; c._res(); } else if (m.t === 'sala404') { c.s404 = true; c._res(); } } catch {} return; }
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
  // em série: o A precisa chegar primeiro pra ser o host (usa 'modo' e 'comecar')
  const A = mkCli(0); await A.ready;
  const B = mkCli(1); await B.ready;
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
  await sleep(500);

  // ---- E) reconexão com token segura o slot ----
  console.log('E) queda no meio da luta: slot fica 30s esperando e o token religa');
  // em série: o E1 é o host (manda 'comecar') e é dele o slot que cai/reconecta
  const E1 = mkCli(0); await E1.ready;
  const E2 = mkCli(1); await E2.ready;
  const E3 = mkCli(2); await E3.ready;
  E1.send({ t: 'comecar' });
  let lutaE = false;
  for (let i = 0; i < 40; i++) { await sleep(150); if (E2.last?.st === 'luta') { lutaE = true; break; } }
  if (!lutaE || !E1.tk) { falha(`não preparou o cenário (luta=${lutaE}, tk=${!!E1.tk})`); }
  else {
    const slotCaido = E1.slot, tkCaido = E1.tk;
    E1.ws.terminate(); // queda abrupta (sem close limpo)
    await sleep(900);
    const plOff = E2.last?.pl?.find((p) => p.s === slotCaido);
    if (E2.last?.pl?.length === 3 && plOff?.of === 1) ok('slot segurado: 3 bonecos no snapshot, caído marcado of=1');
    else falha(`slot não foi segurado (pl=${E2.last?.pl?.length}, of=${plOff?.of})`);
    if (E2.last?.st === 'luta') ok('a luta seguiu rolando pros conectados'); else falha(`luta parou: ${E2.last?.st}`);
    const E1b = mkCli(0, tkCaido); // religa com o token
    await Promise.race([E1b.ready, sleep(1500)]);
    if (E1b.slot === slotCaido) ok(`token religou no MESMO slot (${slotCaido})`);
    else falha(`voltou no slot errado (${E1b.slot} ≠ ${slotCaido})`);
    await sleep(700);
    const plOn = E2.last?.pl?.find((p) => p.s === slotCaido);
    if (plOn && plOn.of == null) ok('flag of limpa após reconectar'); else falha('of continuou marcado');
    E1b.ws.close();
  }
  E2.ws.close(); E3.ws.close();
  await sleep(500);

  // ---- F) multi-salas: isolamento, código e JOGAR AGORA ----
  console.log('F) multi-salas: privada com código, isolamento e quick play');
  const F_pub = mkCli(0); // quick play -> sala pública
  await Promise.race([F_pub.ready, sleep(1500)]);
  const F_priv = mkCli(1, null, 'NOVA'); // cria sala privada
  await Promise.race([F_priv.ready, sleep(1500)]);
  if (F_priv.cd && F_priv.cd.length === 4 && F_priv.cd !== F_pub.cd) ok(`sala privada criada com código ${F_priv.cd} (pública: ${F_pub.cd})`);
  else falha(`código estranho: priv=${F_priv.cd} pub=${F_pub.cd}`);
  const F_am = mkCli(2, null, F_priv.cd); // amigo entra com o código
  await Promise.race([F_am.ready, sleep(1500)]);
  if (F_am.cd === F_priv.cd) ok('amigo entrou na MESMA sala pelo código'); else falha(`amigo caiu em ${F_am.cd}`);
  await sleep(700);
  if (F_priv.last?.na === 2 && F_pub.last?.na === 1) ok(`isolamento ok: privada com 2, pública com 1`);
  else falha(`vazou gente entre salas (priv na=${F_priv.last?.na}, pub na=${F_pub.last?.na})`);
  const F_qp = mkCli(3); // JOGAR AGORA de novo -> cai na pública (tem vaga), NUNCA na privada
  await Promise.race([F_qp.ready, sleep(1500)]);
  if (F_qp.cd === F_pub.cd) ok('JOGAR AGORA caiu na sala pública com vaga'); else falha(`quick play caiu em ${F_qp.cd}`);
  const F_404 = mkCli(4, null, 'ZZZZ'); // código inexistente
  await Promise.race([F_404.ready, sleep(1500)]);
  if (F_404.s404) ok("código inexistente recebe 'sala404'"); else falha('sala404 não veio');
  for (const c of [F_pub, F_priv, F_am, F_qp]) c.ws.close();
  await sleep(300);
  console.log('\n=== RESUMO ===');
  if (erros.length === 0) console.log('🎉 REGRESSÃO PASSOU');
  else { console.log(`⚠️  ${erros.length} FALHA(S):`); erros.forEach((e) => console.log('   - ' + e)); }
  process.exit(erros.length ? 1 : 0);
}
main().catch((e) => { console.error('crash:', e); process.exit(2); });
