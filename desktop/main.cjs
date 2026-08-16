// WOBBLERS! — app desktop (Electron)
// Sobe o MESMO servidor do jogo embutido (http+ws na 8877) e abre a janela
// apontando pra ele. Bônus: quem compra o jogo já é HOST — amigos entram
// pela rede local (ou túnel) sem instalar nada.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORTA = process.env.WOBBLERS_PORTA || '8877';
// Teste automatizado em máquina SEM GPU (CI): renderiza por software.
// Nunca ligar isso pra jogador real — a GPU de verdade é muito mais rápida.
if (process.env.WOBBLERS_SOFTGL) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
let servidor = null;
let janela = null;

// Onde está o jogo: no dev é a raiz do repositório; empacotado vai em resources/jogo
function raizDoJogo() {
  const dev = path.join(__dirname, '..');
  if (fs.existsSync(path.join(dev, 'index.html'))) return dev;
  return path.join(process.resourcesPath, 'jogo');
}

function subirServidor() {
  const raiz = raizDoJogo();
  const script = path.join(raiz, 'servidor', 'servidor.mjs');
  // ELECTRON_RUN_AS_NODE: o próprio binário do Electron roda o servidor como Node puro
  servidor = spawn(process.execPath, [script], {
    cwd: path.join(raiz, 'servidor'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: PORTA },
    stdio: 'inherit',
  });
}

async function abrirJanela() {
  janela = new BrowserWindow({
    width: 1280, height: 720, minWidth: 900, minHeight: 540,
    autoHideMenuBar: true,
    backgroundColor: '#171130',
    title: 'WOBBLERS!',
    webPreferences: { contextIsolation: true },
  });
  // espera o servidor responder antes de carregar (retry simples)
  const url = `http://localhost:${PORTA}/`;
  for (let i = 0; i < 40; i++) {
    try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  await janela.loadURL(url);
  // modo de teste automatizado: tira um print e fecha (WOBBLERS_SHOT=/caminho.png)
  if (process.env.WOBBLERS_SHOT) {
    setTimeout(async () => {
      try {
        const img = await janela.webContents.capturePage();
        fs.writeFileSync(process.env.WOBBLERS_SHOT, img.toPNG());
      } finally { app.quit(); }
    }, 7000);
  }
}

app.whenReady().then(() => { subirServidor(); abrirJanela(); });
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { if (servidor) servidor.kill(); });
