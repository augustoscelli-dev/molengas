# Skills de gráficos three.js (curadoria)

Subconjunto do pacote [Threejs-Awesome-Graphics-Agent-Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills)
(MIT, © Scott Sun — ver `LICENSE-threejs-skills.txt`), escolhido pro que o
WOBBLERS realmente usa:

| Skill | Uso no WOBBLERS |
|---|---|
| threejs-skill-router | roteia pra skill certa (nem todas do pacote estão aqui) |
| threejs-bloom | brilho da tinta NEON, laser, telão holográfico |
| threejs-exposure-color-grading | look cartoon "punchy" (tone mapping/grade) |
| threejs-shadow-systems | sombras melhores sem matar FPS |
| threejs-screen-space-ambient-occlusion | profundidade no visual cartoon |
| threejs-camera-direction | câmeras de replay/intro cinematográficas |
| threejs-procedural-animation | movimento secundário (squash, wobble) |
| threejs-procedural-vfx | efeitos de golpe/partículas |
| threejs-procedural-fields | ruído coerente (terreno, máscaras) |
| threejs-water-optics | água do RIO |
| threejs-visual-validation | validar gráficos por screenshot com critério |
| threejs-precipitation-surfaces | neve da NEVE (sem `assets/` — só o conhecimento) |
| threejs-procedural-vegetation | grama do JARDIM (sem `assets/` — só o conhecimento) |

Os `assets/` pesados (texturas demo, ~50 MB) e as skills fora do nosso escopo
(planetas, nuvens volumétricas, arquitetura, oceano espectral…) ficaram de
fora — se precisar, estão no repositório original.

**Atenção de performance:** o WOBBLERS roda até no celular e o servidor simula
20 jogadores. Toda técnica dessas skills entra COM orçamento: nada de
raymarching pesado ou passes múltiplos sem medir FPS antes/depois.
