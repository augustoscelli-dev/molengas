// retrato.cjs — renderiza a foto de um modelo (assets/retratos/<id>.jpg) usando o
// preview-glb.html do projeto dentro do Electron (o mesmo do app desktop).
// Chamado por ferramentas/meshy.mjs; à mão:
//   desktop/node_modules/.bin/electron ferramentas/retrato.cjs assets/modelos/X.glb saida.jpg [angulo]
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const [glbRel, saida, anguloStr] = process.argv.slice(2);
const angulo = Number(anguloStr ?? -28);
if (!glbRel || !saida) { console.error('uso: retrato.cjs <assets/modelos/X.glb> <saida.jpg> [angulo]'); app.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
// servidor estático mínimo: módulos ES não carregam por file://
const servidor = http.createServer((req, res) => {
  const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(RAIZ) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const falhar = (msg) => { console.error(msg); servidor.close(); app.exit(1); };

app.disableHardwareAcceleration(); // renderização por software: estável em qualquer máquina/CI
app.whenReady().then(() => servidor.listen(0, '127.0.0.1', async () => {
  const porta = servidor.address().port;
  const win = new BrowserWindow({
    show: false, width: 900, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', (_e, _lvl, m) => { if (/erro|error/i.test(m)) console.error('[página]', m); });
  await win.loadURL(`http://127.0.0.1:${porta}/preview-glb.html?m=/${glbRel.replace(/\\/g, '/')}`);
  const t0 = Date.now();
  for (;;) {
    const st = await win.webContents.executeJavaScript('window.__ready ? "ok" : (window.__error || "")');
    if (st === 'ok') break;
    if (st) return falhar(`preview-glb: ${st}`);
    if (Date.now() - t0 > 45000) return falhar('timeout esperando o modelo carregar');
    await sleep(200);
  }
  await win.webContents.executeJavaScript(`window.setAngle(${angulo}); window.setOutline(true); true`);
  await sleep(800); // alguns frames pra sombra/tonemapping assentarem
  const img = await win.webContents.capturePage();
  if (img.isEmpty()) return falhar('capturePage veio vazio');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, img.resize({ width: 512, height: 512, quality: 'best' }).toJPEG(90));
  const stats = await win.webContents.executeJavaScript('JSON.stringify(window.__stats)');
  console.log(`retrato ok ${saida} ${stats}`);
  servidor.close(); app.exit(0);
})).catch((e) => falhar(String(e && e.stack || e)));
