# WOBBLERS! 🥊

Briga de bonecos molengas no navegador — estilo Gang Beasts / Fall Guys. Física
de ragdoll, socos, agarrões, arremessos, armas e caos. Roda direto no browser,
sem instalar nada (three.js + Rapier3D, ES modules puros).

- **Offline:** 2 no mesmo teclado + até 4 com controles, contra bots ou entre amigos.
- **Online (LAN):** até **20 jogadores**, cada um no seu aparelho.
- **Celular:** controles de toque na tela.

---

## ▶️ Como abrir

- **No PC:** dê dois cliques em **`jogar.bat`** (sobe um servidor local e abre o
  navegador). Abrir o `index.html` direto **não funciona** — o navegador bloqueia
  a física e a arte.
- **Publicado:** `https://augustoscelli-dev.github.io/molengas/`

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

0. **Tela de título:** 🎮 JOGAR · 🌐 JOGAR ONLINE · ❓ COMO JOGAR (**ENTER** pula
   direto pro jogo; **ESC** volta um passo em qualquer tela).
1. **Escolha o lutador** no palco 3D: J1 com **A/D**, J2 com **←/→** (ou clique no
   card). **Pinte o seu boneco** 🎨: J1 com **W/S**, J2 com **↑/↓** (12 tintas — o
   boneco no palco muda na hora). Confirme com **F** (J1) e **K** (J2). Aperte **C**
   pra adicionar um **bot 🤖**.
2. **Tela de arena:** fileira de **cards com foto** de cada mapa (são 18! — no
   **ABISMO 🕳️** não tem chão: agarre o rival e **arraste ele pro buraco**) e o
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

## 🔫 Armas e power-ups

De tempos em tempos caem coisas na arena (mais rápido no modo **CAOS**):

| Arma | O que faz |
|---|---|
| 🏏 Bastão / 🔧 Cano | Pancada; quanto mais rápido o swing, mais forte |
| 🔨 Martelo | Pesadão — manda o oponente voando (ring-out fácil) |
| 🔫 Laser | Segure e **soco** pra atirar; superaquece se spammar |
| 💣 Bomba | Pega e o pavio acende — **jogue no rival antes de explodir!** |

**Pega** com **agarrar**, **usa** com **soco**, e **arremessa** soltando o agarrar.

| Power-up | Efeito |
|---|---|
| ❤️ Cura | Zera o dano acumulado |
| ⚡ Velocidade | Mais rápido por alguns segundos |
| 💪 Força | Soco mais forte por alguns segundos |
| 🛡️ Escudo | Absorve **um golpe inteiro** e some |

---

## 🌐 Online (LAN — mesma rede)

1. No PC que vai hospedar, rode **`servidor-online.bat`** (na 1ª vez ele instala
   as dependências sozinho).
2. Ele mostra um endereço tipo `http://192.168.x.x:8877/?servidor=1`. Cada jogador
   abre esse endereço no navegador do seu aparelho (PC ou celular, na mesma rede).
3. Ao entrar você digita seu **apelido** e **pinta seu boneco** 🎨 na paleta
   (aparece sobre o boneco, no placar, e todo mundo vê a sua cor).
4. **Lobby** — **qualquer um** aperta **T** pra trocar seu lutador (🤖 robô ↔ 🦖
   monstro). O **host** (1º a entrar) escolhe e começa:
   - **F** — começa a partida
   - **M** — modo de sala: **Normal (até 8)** ou **LOUCURA (até 20)** 🤪
   - **N** — pontuação (Melhor de 5/3, Morte Súbita)
   - **B** — arena: **CLÁSSICA**, **GELO 🧊** (escorrega), **ENCOLHE 😱** (o chão
     diminui!), **ABISMO 🕳️** (buraco no meio — arrasta o rival pra morte!) ou
     **RODÍZIO 🎲** (sorteia uma a cada partida)
   - **H** — **REI DO MORRO 👑** (dominar o centro por 10s fecha o round)
   - **Y** — **TIMES 🔴x🔵**: slots pares vs ímpares, **sem fogo amigo**, anel
     colorido sob cada jogador — funciona com qualquer tamanho de sala, **até
     10x10** no modo LOUCURA! O round fecha quando um time inteiro cai e o
     ponto vai pro time todo.
   - **1-4** — provocações 😂💀😱❤️ · **T** troca seu lutador
   - No **celular** esses viram **botões na tela**.
5. Uma **seta "VOCÊ"** fica sobre o seu boneco pra você se achar no meio da bagunça.

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
