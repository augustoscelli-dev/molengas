# Monstro gigante (rival do Jaeger) — como gerar no Meshy e plugar no jogo

O jogo já sabe usar um **segundo modelo 3D rigado** por lutador. Você só precisa
gerar o monstro no Meshy, riggar (biped) e soltar o arquivo em `assets/modelos/`.
Nenhuma mudança de código é necessária.

## ⚠️ Regra de ouro pra funcionar

O modelo **precisa ser um bípede em T-pose** (fica em pé, dois braços e duas
pernas), igual ao Jaeger. O esqueleto do jogo é humanoide — o "auto-rig biped"
do Meshy encaixa direitinho num monstro que anda em pé (tipo dinossauro/lagarto
gigante), mas **não** encaixa num bicho de quatro patas. Então peça sempre um
monstro **que fica em pé, postura humanoide, braços e pernas**.

## Direito autoral

Não use nomes/marcas de filmes (nada de "Godzilla", "Kaiju do filme X",
"Pacific Rim", etc.) no prompt. Descreva uma **criatura original**. Os prompts
abaixo já são seguros — é um monstro genérico "inventado".

## Prompts pro Meshy (Text-to-3D)

Cole um destes em **Meshy → Text to 3D**. Estilo: **Realistic** ou **Sculpture**;
depois use **"Adicionar Animações" / Rig → Biped** (o mesmo fluxo do Jaeger).

**Opção A — lagarto gigante (clássico):**
```
A giant original monster creature standing upright in a symmetrical T-pose,
bipedal humanoid posture with two arms out to the sides and two legs, thick
reptilian body, scaly armored skin, rows of jagged dorsal spines down the back,
powerful tail, muscular arms with clawed hands, big clawed feet, fierce head
with sharp teeth and glowing eyes, dark teal and charcoal color scheme with
orange glowing accents, game-ready, clean topology, full body, feet flat on
ground, arms raised horizontally
```

**Opção B — bruto de pedra/magma:**
```
A giant original brute monster standing upright in a symmetrical T-pose,
bipedal humanoid posture with two arms out and two legs, hulking rocky body
made of cracked stone with molten lava glowing between the cracks, broad
shoulders, heavy arms with big fists, stocky legs, angry glowing eyes,
volcanic ember color palette, game-ready, clean topology, full body, arms
raised horizontally
```

**Opção C — fera das profundezas (aquática):**
```
A giant original sea-beast kaiju-style monster standing upright in a
symmetrical T-pose, bipedal humanoid posture with two arms and two legs,
sleek amphibian body, wet dark-blue and bioluminescent cyan skin, fins along
the arms and back, webbed clawed hands, glowing eyes, deep-ocean color scheme,
game-ready, clean topology, full body, arms raised horizontally
```

## Passo a passo (igual foi feito no Jaeger)

1. Gera o modelo com um dos prompts acima.
2. No Meshy, clica em **"Adicionar Animações"** (ou **Rig**) e escolhe **Biped /
   Humanoid**. Confirma que o esqueleto encaixou no corpo (braços, pernas, coluna).
3. **Baixa como GLB** (o pacote costuma vir como `Character_output.glb` dentro de
   um zip — é esse que serve, o que TEM esqueleto).
4. Renomeia pra **`kaiju-rigado.glb`** e coloca em `assets/modelos/`.
5. Me manda o arquivo aqui no chat que eu:
   - decimo pra ficar leve (~15–20k tris, igual o Jaeger),
   - confirmo o rig e ajusto a escala/altura,
   - ligo no jogo.

## Como ligar (depois que o arquivo estiver no lugar)

- **Rápido, por URL:** abre o jogo com
  `?estilo=j&glb=jaeger-rigado,kaiju-rigado` → Jogador 1 vira o Jaeger, Jogador 2
  vira o monstro.
- Sem o parâmetro, os dois usam o Jaeger (comportamento atual do toque **J** no
  menu). Quando o `kaiju-rigado.glb` existir, dá pra eu fazer o toque **J** já
  escalar Jaeger × Kaiju automaticamente.

## Se o rig ficar estranho

Se o monstro esticar/deformar feio ao socar, provavelmente o corpo não é bem
bípede (patas curtas, tronco muito inclinado). Nesse caso a gente:
- gera de novo pedindo postura mais **ereta/humanoide**, ou
- usa o modelo só como estátua (sem articulação) enquanto isso.
