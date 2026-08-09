# Integração de modelo 3D rigado (auto-rig) ao ragdoll

Guia para plugar um GLB **com esqueleto** (ex.: auto-rig da Meshy/Mixamo) na
física do jogo, fazendo o modelo **amassar nas juntas** junto com o ragdoll.

## Onde estamos

Hoje o estilo `g` (`?estilo=g&glb=NOME`) cola o GLB como **casca rígida**: o
modelo inteiro vira filho do grupo do `torso` e segue a translação/rotação do
corpo do tronco. Ele tomba, gira e é arremessado — mas **não dobra** cotovelo/
joelho, porque é malha única sem ossos.

Ver `buildVisual()` (branch `ESTILO === 'g'`) e `syncVisual()` em `src/main.js`.

## As 11 partes do ragdoll (destino dos ossos)

De `src/ragdoll.js` (`PARTS`), com a pose de descanso (offset em Y):

| Parte      | Papel            | Offset (x, y, z)      |
|------------|------------------|-----------------------|
| pelvis     | quadril          | (0, 0.95, 0)          |
| torso      | tronco           | (0, 1.28, 0)          |
| head       | cabeça           | (0, 1.62, 0)          |
| upperArmL  | braço sup. esq.  | (-0.285, 1.28, 0)     |
| upperArmR  | braço sup. dir.  | (0.285, 1.28, 0)      |
| forearmL   | antebraço esq.   | (-0.285, 1.02, 0)     |
| forearmR   | antebraço dir.   | (0.285, 1.02, 0)      |
| thighL     | coxa esq.        | (-0.10, 0.56, 0)      |
| thighR     | coxa dir.        | (0.10, 0.56, 0)       |
| calfL      | canela esq.      | (-0.10, 0.22, 0)      |
| calfR      | canela dir.      | (0.10, 0.22, 0)       |

Cada `rag.parts[nome]` é um rigid body do Rapier com `.translation()` e
`.rotation()` (quaternion) em espaço de mundo.

## Mapeamento osso → parte (heurística por nome)

Auto-riggers costumam nomear ossos em inglês (padrão Mixamo-like). Mapa sugerido:

```js
const BONE_MAP = {
  hips: 'pelvis', pelvis: 'pelvis',
  spine: 'torso', spine1: 'torso', spine2: 'torso', chest: 'torso',
  head: 'head', neck: 'head',
  leftarm: 'upperArmL', left_upperarm: 'upperArmL', upperarm_l: 'upperArmL',
  rightarm: 'upperArmR', right_upperarm: 'upperArmR', upperarm_r: 'upperArmR',
  leftforearm: 'forearmL', lowerarm_l: 'forearmL', forearm_l: 'forearmL',
  rightforearm: 'forearmR', lowerarm_r: 'forearmR', forearm_r: 'forearmR',
  leftupleg: 'thighL', thigh_l: 'thighL', upperleg_l: 'thighL',
  rightupleg: 'thighR', thigh_r: 'thighR', upperleg_r: 'thighR',
  leftleg: 'calfL', calf_l: 'calfL', lowerleg_l: 'calfL', shin_l: 'calfL',
  rightleg: 'calfR', calf_r: 'calfR', lowerleg_r: 'calfR', shin_r: 'calfR',
};
// normalizar: bone.name.toLowerCase().replace(/[^a-z0-9]/g,'')  e casar no mapa
```

Se o rig da Meshy usar outros nomes, imprima `bone.name` de cada osso
(`skinnedMesh.skeleton.bones`) e ajuste o mapa.

## Onde plugar (2 pontos em src/main.js)

### 1) Carregar o modelo rigado — em `buildVisual`, um novo `ESTILO === 'h'`
```js
if (ESTILO === 'h') {                 // 'h' = GLB rigado (skinned)
  for (const spec of PARTS) { const g = new THREE.Group(); scene.add(g); meshes[spec.name] = g; }
  const nome = MODELO_GLB.split(',')[slot]?.trim() || MODELO_GLB.split(',')[0];
  new GLTFLoader().load(ASSET('assets/modelos/' + nome + '.glb'), (gltf) => {
    const model = gltf.scene; scene.add(model);
    // auto-fit de escala como no estilo 'g' (usar Box3)
    meshes._rig = { model, bones: {} };
    model.traverse((o) => {
      if (o.isBone) {
        const key = o.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const parte = BONE_MAP[key];
        if (parte) meshes._rig.bones[parte] = o;
      }
      if (o.isMesh) o.castShadow = true;
    });
    // TODO: guardar o "rest" de cada osso (quaternion inverso) para compor
    // corretamente rotação-de-descanso + rotação-da-física (ver abaixo).
  });
  return meshes;
}
```

### 2) Dirigir os ossos pela física — em `syncVisual`
```js
if (meshes._rig) {
  for (const [parte, bone] of Object.entries(meshes._rig.bones)) {
    const b = rag.parts[parte]; if (!b) continue;
    const t = b.translation(), r = b.rotation();
    // Como os ossos são hierárquicos, o mais robusto é escrever a pose
    // de MUNDO do osso e deixar o three resolver o local:
    bone.matrixWorld.compose(
      new THREE.Vector3(t.x, t.y, t.z),
      new THREE.Quaternion(r.x, r.y, r.z, r.w),
      bone.scale,
    );
    bone.matrixWorldNeedsUpdate = true;
    // TODO: se a orientação do osso em descanso != orientação do corpo,
    // aplicar um offset fixo (deltaRest) medido no load. Alinhar eixos.
  }
  return; // pula o sync padrão (não há grupos por parte)
}
```

## Cuidados / TODOs

1. **Orientação de descanso.** O eixo "para frente" do osso pode não bater com o
   do corpo do Rapier. Meça no load um quaternion de correção por parte
   (`deltaRest = boneRestWorld.inverse() * partRestWorld`) e componha no sync.
2. **Escala.** Auto-fit pela `Box3` como no estilo `g` (`alvoH≈2.33`).
3. **SkinnedMesh.** O modelo precisa vir com `SkinnedMesh` + `Skeleton`; se a
   Meshy exportar bones mas a malha não estiver "skinada", o mesh não deforma.
4. **Performance.** Rodar `simplify` (ver README de decimação) antes; skinning
   de 400k verts é caro no navegador.
5. **Fallback.** Se algum osso não casar no `BONE_MAP`, cair no estilo `g`
   (casca rígida) em vez de quebrar.

## Fluxo recomendado quando o modelo rigado chegar

1. Exportar da Meshy com **auto-rig + skin** em **GLB**, low-poly.
2. `?estilo=h&glb=<nome>` e conferir no console os nomes dos ossos.
3. Ajustar `BONE_MAP`, medir `deltaRest`, validar 1 lutador parado.
4. Validar na luta (agarrão/soco/queda) — deve amassar nas juntas.
