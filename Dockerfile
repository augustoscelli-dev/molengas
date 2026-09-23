# MOLENGAS — servidor online (Node + ws + Rapier headless)
# Serve o jogo e o WebSocket na mesma porta. Lê PORT do ambiente (nuvem) ou 8877.
FROM node:20-slim

WORKDIR /app

# instala só as deps (ws) — cacheável
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

# copia o resto do jogo (index.html, src, libs, assets, servidor…)
COPY . .

# porta padrão em LAN; a nuvem normalmente injeta PORT e ignora isto
ENV PORT=8877
EXPOSE 8877

CMD ["node", "servidor/servidor.mjs"]
