# Lançar o WOBBLERS nas lojas 🚀

A base web NÃO impede vender o jogo — ela vira app de baixar via **Electron**
(o *Vampire Survivors*, feito em JavaScript, vendeu milhões na Steam assim).
A versão desktop já existe em `desktop/` e **embute o servidor online**: quem
compra vira host apertando JOGAR ONLINE.

## Rodar/empacotar a versão desktop

```bash
cd desktop
npm install          # 1ª vez
npm start            # abre o jogo em janela
npm run dist         # gera o instalador da SUA plataforma (dist/)
```

- No **Windows** gera instalador `.exe` (NSIS, 1 clique).
- No **Linux** gera `.AppImage`; no **macOS**, `.dmg`.
- Cada plataforma builda no próprio sistema (padrão do electron-builder).

## 🌍 Servidor público (online pela internet, sem LAN)

O servidor agora é **multi-salas** (JOGAR AGORA + salas privadas com código),
então UM servidor na nuvem atende todo mundo:

1. Alugue um VPS barato (Hetzner/DigitalOcean/Contabo, ~US$ 5-8/mês, 2 vCPU).
2. Node 20+, clone o repositório, `cd servidor && npm install`.
3. Rode com auto-restart: `npx pm2 start servidor.mjs --name wobblers && npx pm2 save`.
4. Libere a porta 8877 no firewall — jogadores entram por `http://SEU_IP:8877`.
5. (Opcional, bonito) domínio + HTTPS com Caddy: `caddy reverse-proxy --from
   wobblers.seudominio.com --to localhost:8877` (o wss:// já funciona sozinho).

Cada sala roda a própria física: 2 vCPU seguram ~4-6 salas cheias; o teto
`MAX_SALAS = 12` protege a CPU e salas vazias fecham sozinhas após 60s.
Matchmaking por fila/região só vale a pena com massa de jogadores — o caminho
na Steam é lobby de amigos via steamworks.js (relay da Valve, zero servidor).

## 🎮 Steam — alcançável AGORA

O caminho realista e barato:

1. **Conta Steamworks** (https://partner.steamgames.com) — taxa única de
   **US$ 100** por jogo (recuperável após US$ 1.000 em vendas).
2. Preencher a página da loja: capsule art, screenshots, trailer, descrição.
   (Os GIFs/screenshots que já geramos servem de base; capsule dá pra pedir
   junto com a arte do Meshy.)
3. Subir o build do `npm run dist` no SteamPipe.
4. **Wishlist primeiro**: soltar a página meses antes, juntar wishlists
   (métrica nº 1 do algoritmo da Steam), lançar em seguida.
5. Depois do lançamento: integrar **steamworks.js** (npm) pra conquistas
   Steam (as nossas 9 já mapeiam direto), rich presence e convites de amigos.

Multiplayer na Steam v1: host-based como hoje (um jogador hospeda, manda o
link/IP). v2: lobbies via Steam Networking (steamworks.js) — sem IP nenhum.

## 🎮 PlayStation Store — meta de médio prazo (é outro campeonato)

Sendo direto: **Electron/web não roda em PS5**. Pra PS Store é preciso:

1. **PlayStation Partners** (https://partners.playstation.com): cadastro de
   empresa (CNPJ), aprovação da Sony, NDA e **devkit**.
2. **Port nativo**: reescrever o runtime pra o SDK da Sony — na prática, ou
   portar o jogo pra uma engine com export console (Godot/Unity), ou contratar
   um **estúdio de porting** (comum na indústria; eles cobram % ou fixo).
3. Certificação (TRC) — processo de QA da Sony, bem mais rígido que Steam.

**Estratégia recomendada:** lançar na **Steam primeiro** (custo baixo, público
gigante, feedback real). Se vender bem, o próprio sucesso paga e atrai
parceiro de porting pra PS/Switch/Xbox — é o caminho que praticamente todo
indie segue (inclusive o Vampire Survivors: web → Steam → consoles depois).

## O que já está pronto pra isso

- App desktop com janela própria e servidor embutido (`desktop/`).
- Loja interna com moedas **ganhas jogando** (sem compra — importante:
  lojas de consoles têm regras duras pra moeda comprada; a nossa é só
  progressão, zero problema).
- 9 conquistas prontas pra mapear em Steam Achievements.
- Replays em vídeo (marketing gratuito feito pelos jogadores).
- Auditoria de IP feita: nomes e personagens originais (Meshy), fontes OFL.

## Próximos passos (ordem sugerida)

1. Retexture + personagens novos no Meshy (a cara comercial do jogo).
2. Ícone do app + capsule art.
3. `npm run dist` no seu Windows → testar o instalador com amigos.
4. Abrir a conta Steamworks e montar a página (wishlist!).
