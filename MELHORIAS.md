# MOLENGAS! — Lista de melhorias (rodada 2)

Legenda: 💥 impacto alto · 🔨 esforço (P/M/G) · ✅ feito

## Prioridade alta (próximas 5)

1. 💥 **Bot (CPU)** 🔨M — jogar sozinho! P2 controlado por IA simples:
   persegue, soca perto, foge da bola, às vezes agarra e arrasta pra
   borda. Três níveis (mole, médio, brabo). Destrava treinar e testar
   sem segundo jogador.
2. 💥 **4 jogadores** 🔨M — mais 2 lutadores locais (controles 3 e 4,
   ou +2 esquemas de teclado). Todo mundo contra todo mundo = o caos
   que o Gang Beasts promete. Placar e seleção pra 4.
3. 💥 **Música + vozes** 🔨M — trilha sintetizada (menu animado, luta
   tensa) e "vozes" molengas: grunhidos no soco, "uéé?" pendurado na
   beirada, choro no nocaute (estilo balbucio de Banjo-Kazooie).
4. **Replay do ponto em câmera lenta** 🔨M — rebobinar os últimos ~2s
   da queda em slow-mo com zoom antes do "PONTO!" (gera o clipe
   perfeito pro canal).
5. **Identidade do link** 🔨P — título/favicon caprichados, meta
   OpenGraph (imagem bonita quando cola o link no WhatsApp/Discord),
   e PWA instalável (ícone na área de trabalho, funciona offline).

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
