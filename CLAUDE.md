# Gridwright

## Qué es

Un pipeline end-to-end de maquetación: entra un nodo de Figma, sale un componente
o una vista construida, verificada visualmente y registrada en el design system
del proyecto. Se opera desde Claude Code.

**El principio rector**: el diseño entra como nodo, sale como sistema. Cada
corrida deja el proyecto con más tokens resueltos, más componentes registrados y
más superficie verificada. Si un componente sale bien pero no aportó nada al
sistema, la corrida falló.

## La spec manda

`specs/001-pipeline.md` define las 10 leyes, las 15 etapas y las fases de
desarrollo. **Leerla antes de escribir código.** Cualquier decisión de
implementación que contradiga una ley de ahí está mal.

Las cuatro que más se olvidan:

- **Ley 1** — el workflow es estado en disco (`.gridwright/runs/<id>/state.json`),
  no texto en un prompt. El CLI orquesta, Claude actúa.
- **Ley 2** — el árbol crudo de Figma nunca toca el LLM. Siempre pasa por el IR.
- **Ley 5** — nada que mute el proyecto se escribe sin aprobación: `plan`,
  `tokens` y `golden` son gates humanos.
- **Ley 10** — el secreto no pasa por el modelo. **Claude nunca corre
  `gw auth login`**: si falta el token de Figma, corta y le pide a la persona que
  lo corra en su terminal con `! gw auth login`. Un token que atravesó el
  transcript está comprometido.

## Decidido

| | |
|---|---|
| Stack | TypeScript + Node, pnpm workspaces, Vitest, Playwright |
| Distribución | repo standalone + binario global `gw` + plugin de Claude Code |
| Adaptadores | Vue 3 SFC y React 19, ambos Tailwind. Vue primero. |
| Render | harness aislado que genera `gw` (Vite efímero) |
| Umbral | score compuesto ≥ 90%, peor viewport |

## Prior art

- `prolicht/tools/figma/figma-image-extractor.cjs` — extracción de assets desde
  la API de Figma + `sharp.trim()` + manifest. Se porta al pipeline.
- `prolicht/FrontEndAgent/docs/` — el mismo workflow escrito en prosa. Gridwright
  lo ejecuta en vez de sugerirlo.

## Cómo trabaja Luciano

Esto sí está establecido, sale de trabajar con él en el portfolio, en `autofill`
y en los productos de Dmeter.

**Spec antes que código.** Spec-driven development, y no como eslogan: en el
portfolio hay un `specs/001-interaction-language.md` con cuatro leyes que
gobiernan cada interacción del sitio, escritas antes de implementar. Para algo
de este tamaño, el primer entregable es una spec, no un scaffold.

**Las reglas de negocio son dato, no código.** Patrón que repite en todos sus
productos: la tabla de esfuerzo por actividad, los límites por franja etaria, el
esquema de cada rubro. Si algo cambia sin tocar el algoritmo, va como dato.

**Comentarios en español, y explican el porqué.** No lo que hace la línea —eso
se lee— sino la razón por la que está así. Los buenos comentarios de sus repos
cuentan qué se rompió antes.

**Tests que valen.** No cobertura por cobertura: tests contra la cosa real.
Hornero tiene 248 contra un Postgres de verdad. `autofill` tiene 127, varios
calcados de formularios reales que rompieron.

**Sin margins entre hermanos.** Flex o grid con `gap`. Es regla dura en sus
proyectos de UI.

**Nada se envía ni se publica solo.** Principio de diseño transversal en Dmeter:
*el sistema genera, la persona decide*.

## Git

- Cuenta personal: **BalbianoLuciano** (`balbiano06@gmail.com`).
  Si `gh` tiene activa la cuenta de trabajo, cambiar con
  `gh auth switch -u BalbianoLuciano`.
- El push por SSH falla en esta máquina para esa cuenta; anda por HTTPS con el
  token de `gh`.
- Mensajes de commit en español, en minúscula, explicando el porqué del cambio.

## Quién es

Luciano Balbiano — AI Engineer. Co-fundador y Frontend Architect en Dmeter
(seis productos en producción), Team Leader en Invisible Geeks.
TypeScript, Laravel, Vue, React, Postgres. Viene de Arquitectura y Urbanismo,
que es de donde le sale el ojo para interfaces.
