# MOLENGAS — Notas da noite (auditoria IP + trabalho)

## Tarefa 1 — Auditoria de IP (ocorrencias fora de libs/)
PUBLICO / SHIPPABLE (prioridade de troca):
- index.html:7  (meta description)  -> "estilo Gang Beasts"
- index.html:13 (og:description)    -> "estilo Gang Beasts"
- manifest.json:4 (PWA description) -> "estilo Gang Beasts"
INTERNO (comentarios de codigo / meus concepts, baixo risco):
- src/main.js:733 -> comentario "estilo Gang Beasts"
- src/main.js:888 -> comentario "gang beasts"
- preview-glb.html:17 -> comentario "vibe Pacific Rim"
- assets/modelos/jaeger.glb + preview-glb.html:72 -> nome "jaeger" (evoca Pacific Rim)
- meus artifacts de concept usam "Pacific Rim/Jaeger/Kaiju" (so mood; trocar por nomes originais)
Libs de terceiros (OK, licenca permissiva):
- libs/three.module.js -> MIT (Three.js Authors)
- libs/rapier3d.es.js, libs/jsm/loaders/GLTFLoader.js -> Rapier (Apache-2.0) / three MIT

## Tarefa 2 — Inventario de assets + origem/licenca
| Asset | Origem | Risco | Acao sugerida |
|---|---|---|---|
| assets/fundo.jpg, fundo-cidade.jpg | Pollinations (IA) — "arte do Pollinations" (main.js:88) | MEDIO/ALTO: output de IA tem copyright incerto e pode imitar obra protegida | Confirmar termos do Pollinations OU substituir por arte propria/CC0 |
| assets/capa.jpg | Pollinations (IA) — capa OpenGraph (MELHORIAS:54) | MEDIO/ALTO (mesma coisa; e e a cara publica do link) | Substituir por capa original |
| assets/retratos/*.jpg (14) | Pollinations (IA) — "retratos Pollinations" (MELHORIAS:109) | MEDIO | Regerar/substituir por retratos proprios (ou render dos proprios personagens) |
| assets/papel/tubarao-*.png (4) | Origem NAO documentada | INCERTO | Confirmar autoria; se sourced, trocar |
| assets/modelos/robo.glb | generator FBX2glTF (convertido de FBX) — fonte desconhecida | INCERTO/ALTO: modelo importado sem licenca conhecida | Confirmar origem/licenca ou remover |
| assets/modelos/jaeger.glb | Meshy (generator "meshy-scene") — conta Pro do usuario | BAIXO p/ licenca (plano pago da uso comercial), MEDIO p/ semelhanca de design (ver tarefa 5) | Manter design generico; guardar comprovante do plano |
| assets/icone-192/512.png | Provavel proprio (favicon 🥊) | BAIXO | Confirmar |
| Sons (som.js) | Sintetizados em Web Audio, nada de arquivo | NENHUM | OK |
| Fontes | Nenhuma webfont embutida; usa fontes de sistema | NENHUM | OK |
| libs/three, rapier, GLTFLoader | MIT / Apache-2.0 | NENHUM (permissivo) | Manter aviso de licenca |

Resumo: o maior risco de direito autoral esta nos ASSETS DE IA do Pollinations
(fundos, capa, retratos) e no robo.glb de origem desconhecida. Sons, fontes e
libs estao OK. O jaeger.glb esta OK de licenca (plano pago), so cuidar do design.

## Tarefa 3 — Naming 100% original (para voce escolher de manha)
Objetivo: evocar "mecha gigante vs. monstro gigante" no clima molenga, SEM marcas.
"Pacific Rim / Jaeger / Kaiju / Gang Beasts" viram apenas referencia interna de
mood (nunca em texto publico).

FACCAO DOS MECHAS (substitui "Jaeger"):
  A) LATÕES    (lata gigante — robotico, engracado, bem molenga)  <- recomendado
  B) BLINDÕES  (blindado, encorpado)
  C) CASCUDOS  (casca dura)

FACCAO DOS MONSTROS (substitui "Kaiju"):
  A) GOSMÕES   (gosma gigante — combina com molenga/gelatina)     <- recomendado
  B) BRUTÕES   (bicho bruto)
  C) PAPÕES    (de "bicho-papao")

NOME DO PERSONAGEM/MODELO (substitui "Iron Sentinel/Jaeger"):
  A) LATÃO     B) FERRÃO     C) SUCATA        (mecha)
  A) GOSMÃO    B) BRUTÃO     C) GASTÃO        (monstro)

SUBTITULO DO JOGO (opcional, evoca sem copiar):
  A) MOLENGAS: Rinha de Gigantes
  B) MOLENGAS: Latões vs Gosmões
  C) MOLENGAS: Plantão Colossal na Cidade

DESCRICAO PUBLICA (troca a que cita "Gang Beasts" em index.html/manifest.json):
  "Briga de bonecos molengas — soque, agarre e arremesse os amigos pra fora da
   arena, direto no navegador e de graca!"
  (descreve a jogabilidade sem citar nenhum jogo/marca de terceiros)

Modos atuais (SUMO, BATATA QUENTE, MARTELO, GELO, MORTE SUBITA, CIDADE...) sao
descritivos/genericos -> OK, sem risco de IP.

## Tarefa 5 — Avaliacao de semelhanca do modelo Meshy (NAO e parecer juridico)
Modelo: jaeger.glb ("Iron Sentinel"), gerado na Meshy.
Observacao visual (dos renders): humanoide atletico, nucleo/reator no peito,
ombreiras, barbatanas nas costas, pernas robóticas. E a "linguagem" generica do
genero mecha (comum a MUITOS robôs gigantes), nao uma copia 1:1 de um mecha
nomeado especifico (ex.: nao tem a cabeca/pintura icônica de designs protegidos).
- Risco de LICENCA: BAIXO — Meshy em plano pago concede uso comercial do output.
  (guardar comprovante do plano/geracao.)
- Risco de SEMELHANCA de design: BAIXO-MEDIO — o "vibe jaeger" evoca o genero.
Recomendacoes:
  1) Manter a silhueta generica; nao replicar marcas/pinturas icônicas de filmes.
  2) Na etapa de textura, usar cores/insignias ORIGINAIS da faccao (nao a pintura
     azul/laranja de mechas famosos).
  3) Renomear o asset de "jaeger" para o nome original escolhido (ex.: latao.glb).
  4) Nao usar "Jaeger/Pacific Rim" em nenhum texto publico do jogo/loja.

## Tarefa 6 — Decimacao do GLB (FEITO)
jaeger.glb 429.976 tris (7.4M)  ->  jaeger-low.glb 34.394 tris (404K).
Validado no jogo (?glb=jaeger-low): visual praticamente identico. 18x menor.
Recomendo usar o -low como default do estilo 'g' pra performance com 4 jogadores.
