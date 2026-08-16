# Novos lutadores no Meshy 🥊

Os personagens novos do WOBBLERS serão modelos 3D de verdade, feitos no Meshy —
mesmo caminho do Jaeger e do Kaiju. Este guia tem o passo a passo e os prompts
prontos. **O que você me entrega: um GLB rigado por personagem.** O resto
(decimar, plugar no jogo, retrato, entrada na loja) eu faço.

## Passo a passo (por personagem, ~10 min)

1. **Meshy → Text to 3D** → cole um prompt daqui de baixo → gere e escolha a
   variação com a silhueta mais legível.
2. **Refine** (se o site oferecer) pra fechar textura/cores.
3. **Auto-Rigging**: em *Animation / Rigging*, aplique o **rig humanoide
   automático** do Meshy no modelo (é o que faz ele "andar" no nosso motor —
   os ossos do Meshy casam com o esqueleto do jogo).
4. **Download → GLB** (com rig + textura embutida).
5. Me manda o arquivo (ou o link). Nome sugerido: `nome-rigado.glb`.

> ⚠️ Regras de ouro: **bípede com proporção humanoide** (2 braços, 2 pernas,
> cabeça — senão o rig não encaixa), **sem armas na mão**, **sem marcas ou
> personagens de filmes/jogos** (só ideias originais — o prompt já cuida disso).

## Prompts prontos (originais, no estilo do jogo)

Todos no mesmo estilo pra combinar com o Jaeger e o Kaiju:

**ROCHEDO 🪨 (golem brutamontes)**
```
stylized low-poly cartoon stone golem, bipedal humanoid proportions, chunky
rounded boulders body, mossy cracks, small glowing eyes, standing A-pose,
symmetrical, game-ready character, full body, no weapons, plain background
```

**GELADO ❄️ (yeti — combina com a arena GELO)**
```
stylized low-poly cartoon yeti, bipedal humanoid proportions, fluffy white fur,
big friendly jaw, ice-blue hands and feet, standing A-pose, symmetrical,
game-ready character, full body, no weapons, plain background
```

**BRASA 🔥 (dragão bípede — combina com CHÃO QUENTE)**
```
stylized low-poly cartoon fire dragon warrior, bipedal humanoid proportions,
ember-orange scales, small wings folded on back, standing A-pose, symmetrical,
game-ready character, full body, no weapons, plain background
```

**PRISMA 💎 (alienígena de cristal — combina com a tinta NEON)**
```
stylized low-poly cartoon crystal alien, bipedal humanoid proportions,
translucent geometric gem body, glowing core in chest, standing A-pose,
symmetrical, game-ready character, full body, no weapons, plain background
```

**BARÃO TUBARÃO 🦈 (lutador de academia)**
```
stylized low-poly cartoon muscular shark wrestler, bipedal humanoid
proportions, grey shark head with big grin, athletic body, standing A-pose,
symmetrical, game-ready character, full body, no weapons, plain background
```

**CAPITÃO POLVO 🐙 (cabeça de polvo, corpo de gente)**
```
stylized low-poly cartoon octopus-headed brawler, bipedal humanoid
proportions, purple octopus head with big eyes, tentacle beard, standing
A-pose, symmetrical, game-ready character, full body, no weapons, plain
background
```

## O que acontece depois que você me mandar

1. Eu **decimo** o modelo pra ~30-40k triângulos preservando textura e rig.
2. Coloco em `assets/modelos/`, crio a entrada de personagem (nome, classe,
   força/agilidade) e **renderizo o retrato** pra seleção e pra loja.
3. Ele entra na **LOJA 🛒** como lutador comprável com as moedas do jogo —
   e no online, se o rig casar bem, entra no rodízio do lutador (tecla T).

> O Retexture do **Jaeger** e do **Kaiju** (pra tirá-los do cinza) continua
> sendo o passo nº 1 — prompts em `docs/retexture-meshy.md`.
