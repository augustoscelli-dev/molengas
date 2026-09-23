# ☁️ Subir o MOLENGAS na nuvem (servidor sempre no ar)

O jogo já vem com os arquivos de deploy prontos. O servidor serve o jogo **e** o
WebSocket na mesma porta, lê `PORT` do ambiente, e só depende de `ws`. Escolha
uma plataforma:

## Railway (mais fácil) ⭐
1. https://railway.app → **New Project → Deploy from GitHub repo** → escolha `molengas`.
2. Railway detecta o `package.json` e roda `npm install` + `npm start`
   (start = `node servidor/servidor.mjs`). Ele injeta `PORT` sozinho.
3. Em **Settings → Networking → Generate Domain**, pega uma URL `https://…up.railway.app`.
4. Manda a URL pros amigos. Pronto — o jogo usa `wss://` automático.

## Render
1. https://render.com → **New → Blueprint** e aponte pro repo (usa o `render.yaml`).
   - Ou **New → Web Service**: Build `npm install`, Start `node servidor/servidor.mjs`.
2. Render dá uma URL `https://…onrender.com`.
> No plano free o serviço "dorme" sem uso e demora ~30s pra acordar no 1º acesso.

## Fly.io (Docker, região Brasil)
```bash
fly launch --now          # usa o fly.toml e o Dockerfile já prontos (região gru = SP)
# depois, pra atualizar:
fly deploy
```
Fly injeta `PORT=8080` (definido no `fly.toml`) e dá `https://molengas.fly.dev`.

## Docker (qualquer VPS)
```bash
docker build -t molengas .
docker run -p 8877:8877 molengas
# atrás de um proxy https (Caddy/Nginx) pro wss:// funcionar no celular
```

---

### Arquivos de deploy no repo
- `package.json` — `scripts.start` + dep `ws` + `engines.node >=18`
- `Procfile` — `web: node servidor/servidor.mjs` (Railway/Render/Heroku)
- `Dockerfile` + `.dockerignore` — imagem Node 20 slim
- `fly.toml` — Fly.io (porta 8080, https forçado, região gru)
- `render.yaml` — blueprint do Render

Tudo lê `PORT` do ambiente, então funciona sem ajuste em qualquer um deles.
