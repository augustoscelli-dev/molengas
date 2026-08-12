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

1. **Escolha a fantasia:** J1 com **A/D**, J2 com **←/→**. Confirme com **F** (J1)
   e **K** (J2). Aperte **C** pra adicionar um **bot 🤖**.
2. **Tela de mapa** (depois de todos confirmarem):
   - **A / D** — troca o **mapa** (são 10)
   - **N** — troca o **modo** (Melhor de 5 · Melhor de 3 · Morte Súbita · CAOS ⚔️)
   - **V** — **dificuldade** dos bots (Fácil · Médio · Difícil)
   - **J** — liga o **Jaeger × Kaiju** (robô × monstro, com força assimétrica)
   - **F** — **começa!**
3. No fim da partida, **R** volta pra seleção.

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

---

## 🌐 Online (LAN — mesma rede)

1. No PC que vai hospedar, rode **`servidor-online.bat`** (na 1ª vez ele instala
   as dependências sozinho).
2. Ele mostra um endereço tipo `http://192.168.x.x:8877/?servidor=1`. Cada jogador
   abre esse endereço no navegador do seu aparelho (PC ou celular, na mesma rede).
3. **Lobby** — o **host** (1º a entrar) escolhe e começa:
   - **F** — começa a partida
   - **M** — modo de sala: **Normal (até 8)** ou **LOUCURA (até 20)** 🤪
   - **N** — pontuação (Melhor de 5/3, Morte Súbita)
   - **J** — **robôs × monstros** (par = Jaeger, ímpar = Kaiju)
   - No **celular** esses viram **botões na tela**.
4. Uma **seta "VOCÊ"** fica sobre o seu boneco pra você se achar no meio da bagunça.

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
