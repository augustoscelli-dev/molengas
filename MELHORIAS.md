# MOLENGAS! — Lista de melhorias

Legenda: 💥 impacto alto · 🔨 esforço (P/M/G) · ✅ feito

## Prioridade alta (próximas)

1. 💥 **Som** 🔨M — o jogo é mudo! Socos, POF!, queda no vazio (grito
   sumindo), bolada, torcida reagindo, musiquinha de menu. Web Audio +
   efeitos gerados ou banco livre (Kenney/freesound).
2. 💥 **Gamepad** 🔨P — 2 controles no sofá é o jeito certo de jogar
   (Gamepad API, mapear analógico + 3 botões).
3. 💥 **Tela de pré-luta** 🔨M — seleção de fantasia com retratos
   grandes + escolha de mapa + "ROUND 1... LUTEM!", em vez de teclas
   1/2/3 durante o jogo.
4. **Agarrar a beirada** 🔨M — caiu da borda mas a mão alcançou? Fica
   pendurado e pode subir de volta (clássico Gang Beasts, gera drama).
5. **Arremesso com carga** 🔨P — segurando alguém/caixote, girar
   acumula força; soltar arremessa longe.

## Combate

6. **Mergulho/voadora** 🔨P — pulo + soco = tackle voador (e fica
   caído 1s, risco × recompensa).
7. **Nocaute acumulativo** 🔨P — socos repetidos deixam mais tempo
   atordoado (hoje é tempo fixo), incentivo a combos.
8. **Cansaço** 🔨P — spam de soco esgota; barra invisível de fôlego.
9. **Levantar objetos acima da cabeça** 🔨M — carregar caixote com os
   dois braços e arremessar de verdade.

## Mapas

10. **Plataforma que encolhe** 🔨P — a cada round o chão diminui
    (morte súbita natural).
11. **Plataformas móveis / elevador** 🔨P — o raycast de chão já
    suporta; só criar bodies cinemáticos.
12. **Gelo** 🔨P — mapa escorregadio (fricção baixa) — comédia pura.
13. **Ventilador/esteira** 🔨P — zona que empurra constantemente.
14. **Hazards ativos** 🔨M — martelo que varre, serra que passa.

## Arte & efeitos

15. **Replay em câmera lenta do ponto** 🔨M — rebobinar os últimos 2s
    da queda em slow-mo (rende clipe!).
16. **Mais fantasias** 🔨P cada — abacaxi, robô, banana, fantasma...
    (pipeline pronto: cores + acessórios + retrato Pollinations).
17. **Trilha de soco** 🔨P — arco borrado atrás do punho tipo anime.
18. **Torcida reagindo** 🔨M — confete extra + "OOOOH!" no ponto.
19. **Sombra blob** 🔨P — sombra redonda fofa sob cada boneco.
20. **Bloom** 🔨M — brilho nos holofotes e listras (pós-processamento).

## UI

21. **Menu inicial + pausa (ESC)** 🔨P
22. **Melhor-de-X configurável** 🔨P — hoje é fixo em 5 pontos.
23. **Toque no navegador (mobile)** 🔨G — só se um dia fizer sentido.

## Online (o projetão — decisão: jogo será 100% online)

24. **Fase 1: LAN** 🔨G — servidor Node rodando a física (Rapier já
    roda no Node — os testes provam), 2 navegadores na mesma rede.
25. **Fase 2: nuvem + salas** 🔨G — servidor hospedado, código de sala
    pra jogar com qualquer um.
26. **Fase 3: netcode fino** 🔨G — interpolação, previsão local,
    compensação de lag. O chefão final.

## Já feito

- ✅ Ragdoll ativo (marionete + antigrav + torque)
- ✅ Soco, agarrão, nocaute, rounds, placar
- ✅ 9 fantasias + retratos Pollinations + troca (tecla 1/2)
- ✅ Toon shading, contorno, squash, POF!, estrelas, poeira, shake
- ✅ Holofotes, confete, tone mapping, piso rico
- ✅ Pés que pisam + passadas + freio; braços que balançam + guarda
- ✅ 3 mapas (Estádio/bola de demolição, Gangorra, Queijo) + raycast de chão
- ✅ GitHub Pages: https://augustoscelli-dev.github.io/molengas/
- ✅ Ferramentas dev: ?zoom ?debug ?avancar=N ?skins=a,b ?mapa=N,
  teste-fisica.js (13 cenários headless)
