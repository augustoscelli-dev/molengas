# 🤖 Automação Meshy → WOBBLERS

Em vez de gerar no site do Meshy, baixar zip, renomear e mandar o arquivo,
um comando faz tudo: chama a **API do Meshy**, espera, baixa o GLB, deixa leve,
coloca em `assets/modelos/`, **pluga no jogo** (`src/skins.js` ou `ARMAS_DEF`
em `src/main.js`) e **renderiza o retrato** da seleção. Sem passo manual.

Ferramenta: `ferramentas/meshy.mjs` · Lista de assets: `ferramentas/meshy-assets.json`.

## 1. Chave da API (uma vez)

1. Meshy → **Settings → API Keys** (https://www.meshy.ai/settings/api). A API
   só existe em plano pago (Pro pra cima) e gasta os mesmos créditos do site.
2. Crie a chave (começa com `msy_`) e salve no arquivo **`.env` na raiz** do
   projeto (já está no `.gitignore`, não vai pro git):

   ```
   MESHY_API_KEY=msy_xxxxxxxxxxxxxxxxxxxxxxxx
   ```

3. Confira: `npm run meshy -- saldo` → mostra os créditos.

## 2. Comandos

```bash
npm run meshy -- listar                 # o que tem no manifesto + custo estimado
npm run meshy -- gerar jaeger kaiju     # pinta os dois (retexture + re-rig + retrato)
npm run meshy -- gerar rochedo          # lutador novo: 3D → textura → rig → skins.js → retrato
npm run meshy -- gerar bastao cano martelo bomba gancho   # modelos das armas
npm run meshy -- gerar todos --paralelo 4
npm run meshy -- retrato jaeger         # só refaz a foto
npm run meshy -- integrar rochedo       # só pluga no código (se você trocou o GLB à mão)
npm run meshy -- estado                 # tarefas em andamento / concluídas
```

Opções: `--paralelo N` (padrão 3; o plano Pro aceita 10 tarefas ao mesmo tempo),
`--forcar` (refaz um item já concluído), `--sem-retrato`, `--sem-otimizar`,
`--seco` (mostra o que faria e o custo, sem gastar).

O script **retoma sozinho**: se cair a internet ou você fechar o terminal, roda
de novo o mesmo comando e ele reaproveita as tarefas já criadas
(`ferramentas/.meshy-estado.json`).

## 3. O que cada tipo faz

| tipo | passos na API | resultado |
|---|---|---|
| `retexture` | Retexture (GLB atual, novo UV, PBR) → Auto-Rigging | substitui `assets/modelos/<saida>.glb` (backup em `assets/meshy-brutos/backup/`) + retrato |
| `lutador` | Text-to-3D preview (T-pose) → refine (textura) → Auto-Rigging | GLB novo + entrada em `src/skins.js` + `assets/retratos/<id>.jpg` |
| `arma` | Text-to-3D preview → refine | GLB novo + `glb:`/`escala:` em `ARMAS_DEF.<id>` |
| `cenario` | Text-to-3D preview → refine | GLB novo (você referencia no código) |

Custos (tabela oficial, set/2026): preview 20 · refine 10 · retexture 10 ·
rigging 5. Ou seja: **retexture ≈ 15**, **lutador ≈ 35**, **arma ≈ 30**
créditos. `listar` soma tudo.

Otimização: `gltf-transform` (via `npx`, baixa sozinho) reduz texturas a 1024px
e quantiza vértices — mesmo truque que já deixou o Kaiju 41% menor.

## 4. Editar / adicionar itens

Abra `ferramentas/meshy-assets.json`. Campos:

- `id` — nome curto (vira o id do lutador no jogo e o nome do retrato).
- `tipo` — `retexture` | `lutador` | `arma` | `cenario`.
- `saida` — nome do GLB em `assets/modelos/` (lutador: use `<id>-rigado`).
- `prompt` — descrição em inglês. **Sem marcas/filmes** (docs/auditoria-ip.md).
- `entrada` (retexture) — GLB atual que vai ser pintado.
- `altura` — altura em metros passada pro rigging (1.9 casa com o ragdoll).
- `nome`, `cores` (lutador) — nome na seleção e cores do HUD/tinta (hex sem #).
- `escala` (arma) — maior dimensão em metros na mão (bastão 0.78, bomba 0.36).
- `polycount` — triângulos alvo (lutador 30000, arma 3000–5000).
- `anguloRetrato` — rotação da foto (negativo = olhando pra esquerda).
- `promptTextura` — opcional, prompt separado só pra textura no refine.

Pra um lutador novo basta copiar um bloco, trocar id/nome/prompt/cores e rodar
`gerar <id>`. Ele aparece na seleção de lutadores e no online (tecla T).

## 5. Regras pra funcionar bem

- **Lutador tem de ser bípede humanoide em T-pose**, sem arma na mão. O jogo
  mapeia os ossos do rig do Meshy (Hips, LeftArm, RightUpLeg…) pras 11 partes
  do ragdoll; quadrúpede não encaixa.
- Se o rigging falhar com 422 ("pose estimation failed"), o modelo não ficou
  humanoide o bastante: ajuste o prompt (reforce "bipedal humanoid, T-pose,
  two arms two legs") e rode com `--forcar`.
- Armas: o jogo escala pela maior dimensão (`escala`) e centraliza. Se ficar
  torta na mão, ajuste `escala` ou gire no prompt ("upright"/"horizontal").
- Texturas ficam preservadas: o carregador de armas agora mantém o material
  quando o GLB tem textura (antes pintava tudo de uma cor só).

## 6. Depois de gerar

1. Abre o jogo (`jogar.bat`) e testa: seleção → lutador novo → luta.
2. Gostou → `git add assets/modelos assets/retratos src ferramentas` e commit.
3. Não gostou → `gerar <id> --forcar` refaz (novo sorteio do Meshy), ou ajusta
   o prompt. O GLB anterior fica em `assets/meshy-brutos/backup/`.

`assets/meshy-brutos/` (downloads crus) e `.meshy-estado.json` estão no
`.gitignore`.
