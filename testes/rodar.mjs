// Runner dos testes online: sobe o servidor, roda os 3 testes em sequência
// e reporta o resultado. Uso: npm test   (ou: node testes/rodar.mjs)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const PORT = process.env.PORT || '8899'; // porta separada pra não colidir com um servidor de verdade
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => res(code ?? 1));
  });
}

const testes = ['online.mjs', 'stress20.mjs', 'regressao.mjs'];
let falhou = 0;
for (const t of testes) {
  console.log(`\n━━━━━━ ${t} ━━━━━━`);
  // servidor FRESCO por suíte (isola o estado da sala entre os testes)
  const servidor = spawn('node', [join(RAIZ, 'servidor', 'servidor.mjs')], {
    stdio: 'ignore', env: { ...process.env, PORT },
  });
  await sleep(3000);
  const code = await run('node', [join(AQUI, t)], { env: { ...process.env, PORT } });
  servidor.kill('SIGKILL');
  await sleep(600);
  if (code !== 0) { falhou++; console.log(`  ⛔ ${t} falhou (exit ${code})`); }
}

console.log(`\n════════ RESULTADO: ${testes.length - falhou}/${testes.length} suítes OK ════════`);
process.exit(falhou ? 1 : 0);
