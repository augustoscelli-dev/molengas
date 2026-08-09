# MOLENGAS! — Lista de melhorias (rodada 2)

Legenda: 💥 impacto alto · 🔨 esforço (P/M/G) · ✅ feito

## Prioridade alta (próximas 5)

1. ✅ **Bot (CPU)** — na fase de mapa, C adiciona bots (até 4 no
   total); persegue o mais próximo, foge da bola, agarra e arrasta pra
   borda, se iça da beirada. Nível único "médio" (mole/brabo: futuro).
2. ✅ **4 jogadores** — briga livre: controles 3/4 entram apertando A
   na seleção; último de pé pontua; placar/câmera/replay pra N.
3. ✅ **Música + vozes** — trilha sintetizada (menu 104bpm, luta
   138bpm: baixo + chimbal) e balbucios por lutador (grunhido no soco,
   "ai!", "uéé?" na beirada, choro na queda, "yay!" na vitória).
4. ✅ **Replay do ponto em câmera lenta** — últimos ~2.5s da queda
   reprisados a 0.4× antes do PONTO!.
5. ✅ **Identidade do link** — favicon 🥊, OpenGraph com capa gerada
   no Pollinations (link bonito no WhatsApp/Discord), manifest PWA
   (instalável) + service worker offline.

## Modos de jogo

6. **Sumô** 🔨P — sem soco, só empurrão e agarrão; arena redonda.
7. **Batata quente** 🔨M — uma bomba passa de mão em mão; explode a
   cada X segundos; quem segura voa.
8. **Rei da bola** 🔨M — pontua quem ficar em cima da bola de
   demolição por mais tempo.
9. **Melhor-de-X configurável** 🔨P — hoje fixo em 5 pontos.

## Combate

10. **Voadora** 🔨P — pulo + soco = tackle de corpo inteiro (e fica
    caído 1s: risco × recompensa).
11. **Nocaute acumulativo** 🔨P — socos seguidos atordoam mais tempo.
12. **Cansaço** 🔨P — spam de soco esgota o fôlego.
13. **Levantar acima da cabeça** 🔨M — carregar caixote/pessoa com os
    dois braços e arremessar de verdade.
14. **Empurrão de corpo (dash)** 🔨P — investida com o ombro.

## Mapas

15. **Plataforma que encolhe** 🔨P — morte súbita natural por round.
16. **Plataformas móveis / elevador** 🔨P — o raycast já suporta.
17. **Gelo** 🔨P — fricção baixa, comédia garantida.
18. **Ventilador / esteira** 🔨P — zonas que empurram.
19. **Martelo giratório** 🔨M — hazard ativo varrendo a arena.

## Arte & polimento

20. **Mais fantasias** 🔨P cada — abacaxi, robô, banana, fantasma,
    unicórnio… (pipeline pronto, inclusive retrato).
21. **Trilha de soco** 🔨P — arco borrado tipo anime atrás do punho.
22. **Torcida reagindo** 🔨M — confete extra + zoom nos "OOOH!".
23. **Estatísticas pós-partida** 🔨P — socos acertados, quedas,
    tempo pendurado, maior arremesso.
24. **Emotes** 🔨P — tecla de provocação (tchauzinho, dancinha).
25. **Bloom** 🔨M — brilho nos holofotes e listras.

## Online (o projetão — decisão: 100% online)

26. **Fase 1: LAN** 🔨G — servidor Node com a física (Rapier já roda
    no Node), 2 navegadores na mesma rede.
27. **Fase 2: nuvem + salas** 🔨G — código de sala pra jogar de longe.
28. **Fase 3: netcode fino** 🔨G — interpolação, previsão, lag.

## Já feito

- ✅ Rodada 1 completa: som sintetizado, gamepad, tela de pré-luta
  (retratos + mapa + ROUND N/LUTEM!), agarrar a beirada, arremesso
  com carga
- ✅ Ragdoll ativo com passos de verdade, freio, braços vivos, guarda
- ✅ 9 fantasias + retratos Pollinations; toon shading + juice completo
  (POF!, estrelas, poeira, shake, squash)
- ✅ 3 mapas interativos (bola de demolição, gangorra, queijo) +
  raycast de chão
- ✅ Holofotes, confete, tone mapping ACES
- ✅ GitHub Pages: https://augustoscelli-dev.github.io/molengas/
- ✅ Dev: ?zoom ?debug ?avancar ?skins ?mapa ?direto + 13 testes headless
