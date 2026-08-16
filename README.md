# WOBBLERS! 🥊

Briga de bonecos molengas no navegador — estilo Gang Beasts / Fall Guys. Física
de ragdoll, socos, agarrões, arremessos, armas e caos. Roda direto no browser,
sem instalar nada (three.js + Rapier3D, ES modules puros).

- **Offline:** 2 no mesmo teclado + até 4 com controles, contra bots ou entre amigos.
- **Online (LAN):** até **20 jogadores**, cada um no seu aparelho.
- **Celular:** controles de toque na tela.

---

## ▶️ Como abrir

- **App desktop (o produto!):** `cd desktop && npm install && npm start` — janela
  própria com o servidor online embutido. `npm run dist` gera o instalador
  (.exe/.AppImage/.dmg). Plano de lojas em `docs/lancamento-lojas.md`.
- **No PC (dev rápido):** dê dois cliques em **`jogar.bat`** (sobe um servidor
  local e abre o navegador).
- **Publicado (demo web):** `https://augustoscelli-dev.github.io/molengas/`

---

## 🎮 Controles

### Teclado

| Ação | 🔴 Jogador 1 | 🔵 Jogador 2 |
|---|---|---|
| Andar | **W A S D** | **Setas** |
| Soco | **F** | **K** |
| Agarrar | **G** | **L** |
| Pular (2× no ar) | **Espaço** | **Enter** |
| Esquiva (i-frames) | **Shift esq.** | **Shift dir.** |
| Emote | **T** | **O** |

### Golpes especiais (valem pros dois)

- **Investida (dash):** toque **duplo** numa direção.
- **Cabeçada:** **agarrar + soco** (com alguém agarrado).
- **Chute:** andar **pra trás + soco**.
- **Voadora:** soco no ar.

### Controle (gamepad)

Analógico/direcional anda · **A** pula · **X / RB** soco · **B / LB / RT** agarra ·
**Y** emote · **LT / L3** esquiva. Cada jogador usa o controle na ordem (1º
controle = jogador 1, etc.).

### Celular (toque)

No celular o jogo mostra um **analógico** na esquerda e botões **SOCO / AGARRA /
PULO / ESQUIVA** na direita. Ao abrir, já cai numa luta rápida contra um bot.

---

## 🕹️ Menu (offline)

0. **Tela de título:** 🎮 JOGAR · 🌐 JOGAR ONLINE · 🏆 TORNEIO · 🎓 TUTORIAL ·
   ❓ COMO JOGAR (**ENTER** pula direto pro jogo; **ESC** volta um passo).
   Na primeira vez, faça o **TUTORIAL**: 5 passos jogáveis no DOJO contra um
   manequim (andar → soco → agarrão → dash → ring-out) e **+50 🪙** no final.
   No **TORNEIO** 🏆, 4/6/8 pessoas revezam o teclado num mata-mata com árvore
   de chaves: cada luta é 1×1 (🔴 WASD × 🔵 setas), arena sorteada, final
   melhor de 3 — e o campeão leva +40 🪙.
1. **Escolha o lutador** no palco 3D: J1 com **A/D**, J2 com **←/→** (ou clique no
   card). **Pinte o seu boneco** 🎨: J1 com **W/S**, J2 com **↑/↓** (12 tintas — o
   boneco no palco muda na hora). Confirme com **F** (J1) e **K** (J2). Aperte **C**
   pra adicionar um **bot 🤖**.
2. **Tela de arena:** fileira de **cards com foto** de cada mapa (são 20! — no
   **ABISMO 🕳️** não tem chão, no **JARDIM 🌿** a grama amassa na briga e o **DOJO 🥋** tem sacos de pancada pra treinar) e o
   mapa de verdade montado ao vivo atrás. **A / D** navega · **X** sorteia 🎲 ·
   clique no card também funciona · **F** confirma.
3. **Tela de modo:** cards dos 6 modos — Melhor de 5 🏆 · Melhor de 3 ⚡ ·
   Morte Súbita 💀 · CAOS ⚔️ · REI DO MORRO 👑 · **DUPLAS 2v2 🤝** (você +
   aliado, sem fogo amigo, anel colorido mostra o time; bots completam a sala).
   Na mesma tela: **V** — dificuldade dos bots · **G** — modificador de festa
   (LUA 🌙 · TURBO ⚡ · FORTÕES 💪) · **J** — Jaeger × Kaiju · **F** — **começa!**
4. No fim da partida, **R** volta pra seleção. **ESC** volta um passo em
   qualquer tela do menu.

---

## 🛒 Loja (moedas de brincadeira)

Jogando você ganha moedas: **+5** por round vencido, **+10 a +30** por partida
(cresce com o tamanho do modo), **+8** de consolação quando perde, **+25**
vencendo online, **+50** no tutorial e **+40** sendo campeão do torneio
(detalhes e simulação em `docs/economia.md`). Na **LOJA** (botão na tela de
título) dá pra comprar:

- **Tintas especiais** 🎨 — OURO, CROMADO, NEON (brilha!) e SOMBRA, com material
  de verdade (metal/brilho). Entram no ciclo de pintura e **valem online**.
- **Novos lutadores** 🧸 — em produção no Meshy (guia e prompts em
  `docs/personagens-meshy.md`). Guarde suas moedas!

Tudo salvo no navegador — sem dinheiro real, é só diversão.

## 🔫 Armas e power-ups

De tempos em tempos caem coisas na arena (mais rápido no modo **CAOS**):

| Arma | O que faz |
|---|---|
| 🏏 Bastão / 🔧 Cano | Pancada; quanto mais rápido o swing, mais forte |
| 🔨 Martelo | Pesadão — manda o oponente voando (ring-out fácil) |
| 🔫 Laser | Segure e **soco** pra atirar; superaquece se spammar |
| 🪝 Gancho | **Soco** com ele na mão ARPOA o rival à frente e o **puxa** — combo cruel no ABISMO |
| 💣 Bomba | Pega e o pavio acende — **jogue no rival antes de explodir!** |

**Pega** com **agarrar**, **usa** com **soco**, e **arremessa** soltando o agarrar.

| Power-up | Efeito |
|---|---|
| ❤️ Cura | Zera o dano acumulado |
| ⚡ Velocidade | Mais rápido por alguns segundos |
| 💪 Força | Soco mais forte por alguns segundos |
| 🛡️ Escudo | Absorve **um golpe inteiro** e some |

---

## 🌐 Online (LAN ou servidor público)

1. No PC que vai hospedar, rode **`servidor-online.bat`** (na 1ª vez ele instala
   as dependências sozinho). Pra jogar **pela internet**, rode o mesmo servidor
   num VPS (guia em `docs/lancamento-lojas.md`).
2. Ele mostra um endereço tipo `http://192.168.x.x:8877/?servidor=1`. Cada jogador
   abre esse endereço no navegador do seu aparelho (PC ou celular).
3. Ao entrar você digita seu **apelido**, **pinta seu boneco** 🎨 e escolhe a
   **sala**: 🎲 **JOGAR AGORA** (cai numa sala pública com vaga), 🔑 **CRIAR
   SALA** (sala privada com **código de 4 letras** pros amigos), digita um
   código — ou escolhe direto na lista de **SALAS ABERTAS** (mostra jogadores,
   estado e arena de cada sala, ao vivo). O lobby mostra o código, e o botão
   **copiar link** já leva o amigo direto pra sua sala. São até **12 salas
   simultâneas**, cada uma com sua própria física — vazias fecham sozinhas.
   No lobby você vê os **retratos** de quem tá na sala (⭐ host, 📵 caiu e
   pode voltar) e **vota na arena clicando nos cards** 🗳️ — a contagem sobe
   ao vivo pra todo mundo.
4. **Lobby** — **qualquer um** aperta **T** pra trocar seu lutador (🤖 robô ↔ 🦖
   monstro). O **host** (1º a entrar) escolhe e começa:
   - **F** — começa a partida
   - **M** — modo de sala: **Normal (até 8)** ou **LOUCURA (até 20)** 🤪
   - **N** — pontuação (Melhor de 5/3, Morte Súbita)
   - **B** — **vota** 🗳️ na arena (todo mundo vota, não só o host!): **CLÁSSICA**,
     **GELO 🧊**, **ENCOLHE 😱**, **ABISMO 🕳️** (buraco no meio) ou **RODÍZIO 🎲**.
     A urna aparece no lobby e a mais votada vence no F (empate = sorteio)
   - **H** — **REI DO MORRO 👑** (dominar o centro por 10s fecha o round)
   - **Y** — **TIMES 🔴x🔵**: slots pares vs ímpares, **sem fogo amigo**, anel
     colorido sob cada jogador — funciona com qualquer tamanho de sala, **até
     10x10** no modo LOUCURA! O round fecha quando um time inteiro cai e o
     ponto vai pro time todo.
   - **1-4** — provocações 😂💀😱❤️ · **T** troca seu lutador
   - No **celular** esses viram **botões na tela**.
5. Uma **seta "VOCÊ"** fica sobre o seu boneco pra você se achar no meio da bagunça.

> **Caiu o Wi-Fi?** Relaxa: o servidor **segura seu boneco por 30s** e o jogo
> reconecta sozinho — você volta no mesmo slot, com a mesma pontuação.

> **Sala cheia?** Se você abrir o link e a sala estiver lotada (ex.: chegou
> antes do host abrir o modo **até 20**), você fica numa **sala de espera** e
> entra **sozinho** assim que abrir vaga — não precisa recarregar.

> É rede local (LAN), não internet aberta. A física roda toda no servidor
> (autoritativa), então todo mundo vê a mesma luta.

---

## 🛠️ Tech

- **three.js** (render) + **Rapier3D** (física), sem build step — ES modules via importmap.
- Ragdoll de 11 corpos com molas de marionete; skinning esqueletal opcional (Jaeger/Kaiju
  do Meshy, dirigido pela física).
- Online autoritativo: servidor Node roda a mesma física e manda **snapshots
  binários** (poses Int16) a 15–20 Hz; colisão por filtro de contato "por dono"
  (escala pra 20+ jogadores sem auto-colisão).

Divirta-se — e joga com os amigos! 🎉
