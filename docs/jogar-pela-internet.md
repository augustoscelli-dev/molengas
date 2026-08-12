# 🌐 Jogar MOLENGAS pela internet (com amigos de fora da tua rede)

Por padrão o servidor online é **LAN** (mesma casa/Wi-Fi). Pra chamar gente de
fora, o teu servidor precisa ficar **alcançável pela internet**. A física roda
toda no servidor (autoritativa), então basta **um** PC hospedar — os amigos só
abrem um link no navegador (PC ou celular), sem instalar nada.

O servidor já entrega o jogo **e** o WebSocket na **mesma porta `8877`**, então
você só precisa expor **uma porta**. O jogo detecta sozinho `ws://` (LAN) ou
`wss://` (túnel/nuvem por https) — não precisa mexer em nada.

Três caminhos, do mais fácil pro mais robusto. **Comece pelo 1.**

---

## 1) Túnel — o jeito mais rápido (5 min, grátis) ⭐

Você roda o servidor local normal e uma ferramenta cria uma **URL pública** que
aponta pro teu PC. Fica no ar enquanto o teu PC estiver ligado com o servidor
aberto. Bom pra "bora jogar agora".

### Passo a passo (o servidor primeiro, sempre)

1. **Suba o servidor** no PC que vai hospedar:
   - Dê dois cliques em **`servidor-online.bat`** (na 1ª vez ele instala as
     dependências sozinho). Deixe essa janela aberta.

2. **Escolha uma ferramenta de túnel** e aponte pra porta **8877**:

   **playit.gg** (não precisa mexer no roteador, feito pra jogos)
   - Crie conta em https://playit.gg, baixe o app, rode.
   - Crie um túnel do tipo **TCP** apontando pra `127.0.0.1:8877`.
   - Ele te dá um endereço tipo `algumacoisa.playit.gg:PORTA`.
   - ⚠️ Como é TCP puro (sem https), abra assim: `http://algumacoisa.playit.gg:PORTA/`

   **Cloudflare Tunnel** (dá um link `https://` bonito e seguro — melhor experiência)
   ```
   # instale o cloudflared (uma vez), depois:
   cloudflared tunnel --url http://localhost:8877
   ```
   Ele imprime uma URL `https://xxxx.trycloudflare.com`. Manda pros amigos.
   O jogo usa `wss://` automático porque veio por https. ✅

   **ngrok** (clássico)
   ```
   ngrok http 8877
   ```
   Copie a URL `https://xxxx.ngrok-free.app` e compartilhe.

3. **Cada amigo abre o link** no navegador (celular ou PC). O **1º a entrar é o
   host** do lobby (escolhe mapa/modo com F/M/N/J). Pronto, todo mundo na mesma
   luta.

> Dica: com **Cloudflare** ou **ngrok** você ganha `https://` de graça, então o
> celular não reclama de "conexão insegura". Prefira esses dois se puder.

### Alternativa sem link público: Tailscale (só entre convidados)
Se são poucos amigos e você não quer um link aberto pra internet:
- Todos instalam **Tailscale** (https://tailscale.com) e entram na sua "tailnet"
  (você convida por e-mail).
- Você sobe o `servidor-online.bat` e passa o seu **IP do Tailscale**
  (tipo `100.x.y.z`): eles abrem `http://100.x.y.z:8877/`.
- Vantagem: é privado (só quem você convidou), sem link público. Desvantagem:
  cada amigo precisa instalar o Tailscale uma vez.

---

## 2) Nuvem / VPS — servidor sempre no ar (o "de verdade") 🚀

Some o PC ligado e o jogo continua no ar, com URL fixa. Ideal se você quer um
servidor permanente pra galera entrar quando quiser.

O servidor é um Node app simples (`servidor/servidor.mjs`, porta via `8877`).
Serve em qualquer host que rode Node:

- **Railway** (https://railway.app) — conecta no repo do GitHub, deploy em 1 clique.
- **Fly.io** (https://fly.io) — `fly launch` + `fly deploy`.
- **Render** (https://render.com) — "New Web Service", aponta pro repo.
- **VPS de ~US$5** (Hetzner, DigitalOcean, Contabo) — mais controle, mais manual.

Passos gerais (Railway/Render):
1. Faça o deploy apontando pro repositório.
2. **Start command:** `node servidor/servidor.mjs`
3. A plataforma expõe uma porta via variável `PORT`. O servidor **já lê
   `process.env.PORT`** automaticamente, então não precisa configurar nada. A
   maioria dessas plataformas encaminha `443 → tua porta` e já te dá `https://`,
   então o `wss://` funciona automático.
4. Compartilhe a URL `https://teu-app.up.railway.app`.

---

## 3) Port-forward no roteador — grátis, mas chato ⚠️

Você abre a porta `8877` no roteador e usa o seu **IP público**.
- **Grátis** e não depende de app de terceiro.
- **Mas:** precisa configurar o roteador (varia por marca), o IP público pode
  mudar, e **muita operadora usa CGNAT** — nesse caso simplesmente não dá, e o
  túnel (opção 1) é o único caminho.
- Teste seu IP público em https://api.ipify.org e a porta em
  https://canyouseeme.org (porta 8877).

---

## Qual escolher?

| Situação | Melhor opção |
|---|---|
| "Bora jogar agora com uns amigos" | **1 — Cloudflare Tunnel** (link https na hora) |
| Grupo fixo e privado | **1 — Tailscale** |
| Servidor sempre no ar | **2 — Railway / Fly.io** |
| Curioso/técnico, sem CGNAT | **3 — Port-forward** |

Dúvida comum: **o celular reclama de conexão insegura?** É porque o link veio por
`http://` (túnel TCP puro). Use **Cloudflare** ou **ngrok** que dão `https://`, ou
hospede na nuvem — aí o jogo usa `wss://` sozinho e o aviso some.
