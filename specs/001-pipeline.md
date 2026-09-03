# Spec 001 — El pipeline

> Estado: en revisión · 2026-09-03
> Define qué es gridwright y las reglas que gobiernan cada etapa.
> Cualquier decisión de implementación que contradiga una ley de acá está mal.

## Principio rector

**El diseño entra como nodo, sale como sistema.**

Gridwright no genera componentes. Construye el design system del proyecto de a un
nodo de Figma por vez. Cada corrida deja el proyecto con más tokens resueltos,
más componentes registrados y más superficie verificada que antes. Un generador
de componentes produce archivos; gridwright produce acumulación.

De ahí sale todo lo demás: si un componente sale bien pero no aportó nada al
sistema, la corrida falló.

---

## Ley 1 — El workflow es estado en disco, no texto en un prompt

La máquina de estados vive en `.gridwright/runs/<id>/state.json` y la hace
cumplir el CLI. Claude Code no decide qué etapa viene: se la pregunta a `gw`.

```
$ gw next
{
  "run": "hero-about-us-01",
  "stage": "author",
  "action": "escribir el componente",
  "inputs": { "ir": "...", "reference": "...", "reuse": [...] },
  "gate": "correr `gw verify`. No hay avance sin pasar."
}
```

**Por qué es ley y no preferencia.** Ya se probó lo contrario. En
`prolicht/FrontEndAgent/docs/WORKFLOW.md` hay un workflow de cinco fases escrito
en prosa, y el agente se saltea la fase de análisis de similitud cada vez que el
pedido parece simple. Un prompt es una sugerencia; un prompt largo es una
sugerencia que además se diluye con el contexto. Una máquina de estados no se
puede ignorar porque no es persuasión, es control de flujo.

Consecuencias:

- El estado sobrevive al corte de sesión, al compact y al reinicio.
- Ninguna etapa puede saltearse, ni "porque este caso es simple".
- El CLI es la única fuente de verdad sobre en qué punto está una corrida.
- Si una etapa no aplica, el CLI la marca `skipped` con motivo. No desaparece.

---

## Ley 2 — El árbol crudo de Figma nunca toca el LLM

Entre Figma y Claude va siempre el **IR**. El árbol crudo de un frame son 2.000 a
5.000 nodos con coordenadas absolutas, fills anidados, constraints y effects. El
IR es su destilación semántica: ~120 líneas.

**Por qué.** Meter el árbol crudo en contexto no es sólo caro: da *peor*
resultado. El modelo se ahoga en ruido, se aferra a los `absoluteBoundingBox` que
ve y escribe `position: absolute`. Menos información bien elegida produce mejor
código que más información cruda.

### Formato del IR

```json
{
  "name": "HeroAboutUs",
  "source": { "file": "D7qfUlKn...", "node": "3978:35299" },
  "layout": { "kind": "flex", "dir": "col", "gap": 24, "align": "center" },
  "tokens": { "bg": "surface.primary", "pad": "space.12" },
  "children": [
    { "role": "image", "asset": "hero-about-us.png", "ratio": "16/9" },
    { "role": "heading", "level": 1, "token": "text.display",
      "slot": "title", "default": "Sobre nosotros" }
  ],
  "variants": { "size": ["sm", "lg"] },
  "warnings": ["3 nodos con posición absoluta — layout no inferible"]
}
```

### Dos traducciones que son isomorfismos, no heurísticas

**Auto-layout es flex con gap.** `layoutMode` + `itemSpacing` +
`primaryAxisAlignItems` mapea uno a uno a `flex-col gap-6 justify-*`. No hay
inferencia. Efecto lateral valioso: gridwright **no puede** generar margins entre
hermanos, porque Figma no le da esa información. La regla se cumple sola.

**Los variants de Figma son props.** Un componente con `Size=Large, State=Hover`
entrega la matriz de props sin inventar nada.

### Corolario incómodo

Si el Figma no usa auto-layout, no hay layout que extraer. Eso no se arregla con
mejor prompt. `distill` lo detecta, lo pone en `warnings` y frena si supera el
umbral. **Es preferible frenar que generar doscientas líneas que parecen bien.**

---

## Ley 3 — Todo lo medible es determinista; el LLM sólo hace lo que no se puede medir

| Código | LLM |
|---|---|
| Traer nodo, assets, imagen de referencia | Escribir el componente idiomático del repo |
| Destilar a IR | Nombrar cosas, decidir la API de props |
| Matchear y clasificar tokens | Nombrar los tokens nuevos siguiendo la convención |
| Indexar componentes existentes | Decidir qué reutilizar |
| Renderizar, medir, diffear | Interpretar el diff y corregir |
| Escribir tokens, barrel, registry, dashboard | |

Si una tarea se puede verificar con un assert, no la hace el modelo. Si necesita
criterio sobre el código existente, no la hace el programa.

---

## Ley 4 — Los tokens se escriben antes que el componente

Orden obligatorio: `resolve` → `tokens` → `author`.

**Por qué.** Si Claude escribe el componente antes de que los tokens existan,
escribe `bg-[#1A1A1A]` y después hay que refactorizar. Con los tokens ya en el
sistema, escribe `bg-surface-primary` en el primer intento. El orden es lo que
hace que salga código con tokens y no con valores mágicos.

### Matcheo con tolerancia

| Tipo | Cómo se matchea | Por qué |
|---|---|---|
| Color | **ΔE (CIEDE2000) ≤ 1.0** | `#1A1A1B` y `#1A1A1A` son el mismo color para un ojo. Con igualdad de hex creás un token nuevo y arranca la podredumbre. |
| Espaciado | Exacto, o snap a la escala existente | Si la escala es 4/8/12/16 y el diseño dice 14, eso **no es un token nuevo, es un error de diseño**. Se reporta, no se absorbe. |
| Tipografía | Tupla `family + weight + size + lineHeight` | Un size sin su line-height no es un token, es un valor suelto. |

### Los tres cajones

- **`exact`** — usá el que existe. Silencio.
- **`near`** — usá el que existe **igual**, y reportá la deriva:
  *"el diseño trae `#1A1A1B`, el sistema tiene `#1A1A1A` (ΔE 0.4). Usé el del
  sistema."* Este cajón es el que salva el design system.
- **`new`** — proponer token nuevo. Pasa por el gate de la Ley 5.

### Escritura

1. **Detectar dónde viven los tokens buscando los que ya existen**, no por
   versión de la herramienta. Prolicht corre Tailwind 4.1.18 *y* tiene
   `tailwind.config.js` con `theme.extend`. El mundo real mezcla. Casos a
   soportar: config JS de v3, bloque `@theme` de v4, custom properties CSS, SCSS.
2. **AST, nunca regex.** `ts-morph` para el config JS, `postcss` para CSS. Es un
   archivo compartido del proyecto: un regex mal puesto rompe el build de todos.
3. **Reportar siempre** el diff en el dashboard, aunque el gate haya dado OK.

---

## Ley 5 — Nada que mute el proyecto se escribe sin que Luciano lo apruebe

Tres gates humanos, y son los únicos puntos donde el pipeline espera:

| Gate | Cuándo | Qué se aprueba |
|---|---|---|
| **`plan`** | antes de escribir código | estructura, props, qué se reutiliza |
| **`tokens`** | antes de tocar el sistema | los tokens del cajón `new`, con su nombre |
| **`golden`** | antes de congelar | el baseline y el test de regresión |

La etapa de tokens **siempre corre** — es obligatoria, no opcional — pero el
*write* muestra el diff y espera.

**Por qué el gate de tokens y no confianza.** Un componente mal generado se
reescribe en diez minutos. Un sistema de tokens contaminado se hereda para
siempre: `neutral-900`, `neutral-900-alt`, `neutral-901`, y a los seis meses
nadie sabe cuál usar. La asimetría de reversibilidad justifica la fricción.

*El sistema genera, la persona decide.*

---

## Ley 6 — Pixel-perfect contra Figma es un espejismo

El motor de texto de Figma y el de Chromium hacen kerning, hinting y antialiasing
distintos. Un componente **perfecto** da 3–8% de píxeles diferentes. Un umbral de
diff crudo al 1% no se alcanza nunca; al 10% pasa cualquier cosa.

El score es compuesto y ponderado:

| Dimensión | Peso | Cómo se mide | Ruido |
|---|---|---|---|
| **Estructural** | 50% | bounding boxes de nodos principales, tolerancia ±2px | ninguno |
| **Cromática** | 25% | muestreo de color en puntos definidos, ΔE | ninguno |
| **Perceptual** | 25% | diff de píxeles con máscara sobre regiones de texto | alto |

- **Umbral de aprobación: 90%.**
- Se mide por viewport, y el score final es **el peor viewport, no el promedio**.
  Si rompe en mobile, rompe.
- La estructural pesa la mitad porque es la única sin ruido de rendering y la que
  detecta errores reales de maquetación.

### El refine no es "intentá de nuevo"

`gw refine --focus=<dimensión>` le entrega a Claude *qué* falló y *dónde*:

```
Estructural 71% — falla en mobile (375px):
  • [heading]   top: esperado 148, obtenido 156  (+8px)
  • [container] gap: esperado 32,  obtenido 24
  • [image]     height: esperado 240, obtenido 240  ✓
Cromática 100% ✓    Perceptual 94% ✓
```

Eso converge en dos iteraciones. Una mancha roja no converge nunca. **Tope duro
de 4 iteraciones**: si no llega, corta y muestra el dashboard.

---

## Ley 7 — Dos tipos de verificación, nunca mezclados

**Fidelidad** — ¿se parece al diseño? Gate de aceptación, se mide una vez,
durante la construcción, contra la imagen exportada de Figma. **No es un test
permanente**: el Figma va a cambiar y el componente real va a llevar datos
reales, no el lorem del mockup.

**Regresión** — una vez aprobado, el screenshot **del componente propio** queda
como baseline en el repo. *Ese* sí corre en CI para siempre.

El primero pregunta "¿lo construí bien?". El segundo, "¿lo rompí?". Confundirlos
produce una suite que falla cada vez que un diseñador mueve un frame.

---

## Ley 8 — La frontera del adaptador es sagrada

El adaptador de framework es dueño de **cinco cosas y sólo cinco**:

1. Forma del archivo (`.vue` SFC / `.tsx`)
2. Scaffold de la library y sintaxis del barrel
3. Código de montaje del harness (`createApp` / `createRoot`)
4. Fragmento de prompt con los idioms del framework
5. Forma del archivo de test

**No toca**: IR, resolve, tokens, verify, dashboard, máquina de estados.

> Si un adaptador necesita tocar algo de esa lista, la frontera está mal trazada
> y se arregla la frontera, no el adaptador.

Adaptadores del día uno: **Vue 3 SFC** y **React 19**, ambos con Tailwind. Vue va
primero porque prolicht permite dogfoodear contra Figma real desde la fase 2.

Si el IR está bien hecho, un adaptador son ~200 líneas. Que sea corto es la
prueba de que el IR está bien.

---

---

## Ley 9 — Toda regla ajustable es dato

Van en `gridwright.config.json`, nunca en código:

- mapa y ubicación de tokens
- umbrales de las tres métricas y del score
- viewports
- tolerancia de ΔE y de bounding box
- nomenclatura de archivos y assets
- rutas de la library
- tope de iteraciones de refine

Cambiar el umbral de fidelidad no puede requerir tocar el algoritmo de diff.

---

## Ley 10 — El secreto no pasa por el modelo

Gridwright necesita un **personal access token de Figma**. Sin eso `fetch` no
existe y el pipeline entero es decorativo. Tres reglas sobre cómo se maneja.

### 10.a — Lo tipea la persona, en su terminal, nunca a través de Claude

El pipeline corre dentro de una sesión de Claude Code. Si Claude ejecuta el
comando que pide el token, o si el token aparece en un mensaje, termina en el
transcript, en el contexto, en los logs y eventualmente en la memoria
persistente. Un secreto que atravesó el LLM hay que considerarlo comprometido.

**El skill nunca corre `gw auth login`.** Cuando falta credencial, Claude corta y
le dice a la persona que lo corra ella:

```
Falta el token de Figma. Corré en tu terminal:

    ! gw auth login

(el prefijo `!` lo ejecuta en tu shell, fuera de la conversación)
```

`gw auth login` lee el token de **stdin en modo oculto**. No lo acepta como
argumento — `gw auth login --token=figd_xxx` no existe, porque un argumento queda
en el historial del shell y en la lista de procesos.

### 10.b — Vive una vez en la máquina, no una vez por proyecto

`gw` es un binario global que se usa en muchos repos. Poner el token en el `.env`
de cada proyecto — como hace hoy el extractor de prolicht — obliga a pegarlo N
veces y multiplica por N las chances de commitearlo.

Orden de resolución, primero que gane:

| Origen | Para qué |
|---|---|
| `FIGMA_TOKEN` en el entorno | CI, y escape hatch |
| `.env` del proyecto | proyecto con token propio (equipo distinto) |
| `~/.config/gridwright/credentials.json`, modo `0600` | **el caso normal** |

Nunca en `gridwright.config.json`: ese archivo se commitea.

### 10.c — El token no toca ningún artefacto de la corrida

No entra en `state.json`, ni en el IR, ni en el manifest, ni en el dashboard, ni
en los logs. Si un mensaje de error tiene que mencionarlo, va enmascarado
(`figd_…a3f2`). Los assets de Figma se descargan de URLs firmadas temporales:
**esas URLs tampoco se persisten**, porque son credenciales con patas.

### Validación al guardar, no al usar

`gw auth login` pega contra `GET /v1/me` antes de escribir nada y confirma con
qué cuenta quedó:

```
✓ Token válido — luciano@… (Prolicht, Dmeter)
  Guardado en ~/.config/gridwright/credentials.json
```

Guardar un token inválido y descubrirlo tres etapas después es la peor UX
posible. Se falla en el segundo cero.

Scope mínimo: **`file_content:read` y `file_dev_resources:read`**. Gridwright sólo
lee. Si el token trae permisos de escritura, `gw auth` avisa que sobran.

### Los errores de Figma que confunden

| Código | Lo que parece | Lo que suele ser |
|---|---|---|
| `403` | token inválido | token válido pero expirado, o sin el scope de lectura |
| `404` | el archivo no existe | **el archivo existe pero el token no tiene acceso** — está en un equipo del que la cuenta no es miembro |
| `429` | falló | rate limit: reintento con backoff exponencial, no error |

El `404` es el que más tiempo hace perder. Cuando pasa, el mensaje tiene que
decir *"el nodo no existe **o** tu cuenta no tiene acceso a ese archivo"*, no
sólo lo primero.

### Precondición, no etapa

La credencial se chequea en `gw next`, antes de resolver la etapa. Si falta, la
corrida ni empieza: no tiene sentido dejar un run a medio crear para morir en
`fetch`. Un `run` que no puede completarse no se abre.

---

## Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│  CÁSCARA — plugin de Claude Code                           │
│  commands/  skills/  hooks/  .mcp.json                     │
│  Fina, sin lógica. Sólo enseña el protocolo `gw next`.     │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  MOTOR — CLI `gw`  (TypeScript / Node)                     │
│                                                             │
│  @gridwright/core       máquina de estados, tipos, IR       │
│  @gridwright/figma      API, traversal, assets, distill     │
│  @gridwright/tokens     match, clasificación, write-back    │
│  @gridwright/library    scaffold, barrel, registry          │
│  @gridwright/verify     Playwright, métricas, diff          │
│  @gridwright/adapters   vue3 · react19                      │
│  @gridwright/dashboard  reporte estático                    │
│  @gridwright/cli        el binario `gw`                     │
└────────────┬───────────────────────────┬───────────────────┘
             ▼                           ▼
   .gridwright/runs/<id>/         el repo del proyecto
   estado · IR · screenshots      componentes · tokens · tests
```

**Stack**: TypeScript, Node, pnpm workspaces. Vitest para el core, Playwright
para verify, `sharp` para assets (se porta el extractor de prolicht), `odiff`
para el diff perceptual, `ts-morph` y `postcss` para el write-back.

**Distribución**: repo standalone. `npm i -g @gridwright/cli` para el binario;
`/plugin marketplace add BalbianoLuciano/gridwright` para la cáscara.

---

## Las etapas

| # | Etapa | Quién | Entrada → Salida | Gate |
|---|---|---|---|---|
| — | `auth` | **la persona** | stdin oculto → `~/.config/gridwright/` | precondición, una vez por máquina |
| 0 | `init` | humano | repo → `gridwright.config.json` | una vez por proyecto |
| 1 | `fetch` | código | URL Figma → árbol + referencia + assets | — |
| 2 | `distill` | código | árbol → `ir.json` | frena si el IR sale pobre |
| 3 | `resolve` | código | IR + sistema → exact / near / new | — |
| 4 | `tokens` | código + LLM | new → tokens escritos | **humano** |
| 5 | `library:ensure` | código | — → library existe | **humano, 1ª vez** |
| 6 | `survey` | código | repo → candidatos a reutilizar | — |
| 7 | `plan` | Claude | IR + candidatos → plan de archivos | **humano** |
| 8 | `author` | Claude | plan → código | — |
| 9 | `harness` | código | componente → Vite efímero montado | — |
| 10 | `verify` | código | render → score por viewport | score ≥ 90 |
| 11 | `refine` | Claude | diff enfocado → correcciones | tope 4 |
| 12 | `golden` | vos | aprobado → baseline + test | **humano** |
| 13 | `library:register` | código | → barrel + `registry.json` | — |
| 14 | `report` | código | todo → dashboard | — |

`auth` no es una etapa: es una **precondición**. No tiene número porque no es
parte de una corrida, y `gw next` la chequea antes de abrir el run (Ley 10).

Obligatorias sin excepción: **4, 5, 13**. Son las que construyen el sistema.
Las demás pueden marcarse `skipped` con motivo; esas tres no.

---

## La library

Cuando no existe, `library:ensure` arma lo mínimo que funciona:

```
src/components/ui/
├── index.ts          barrel de exports
└── registry.json     generado, legible por máquina
```

Nada más. **Poco invasivo a propósito**: entra en un repo existente sin pelear
con su estructura. Nada de `packages/ui` ni reestructurar el repo de nadie.

### El registry

```json
{
  "HeroAboutUs": {
    "path": "src/components/ui/HeroAboutUs.vue",
    "figma": { "file": "D7qfUlKn...", "node": "3978:35299", "irHash": "a3f2..." },
    "props": ["title", "description", "image"],
    "tokens": ["surface.primary", "text.display", "space.12"],
    "baseline": ".gridwright/baselines/HeroAboutUs.png",
    "score": 94,
    "runs": 3
  }
}
```

Hace tres cosas a la vez:

1. Es lo que lee `survey` para saber qué reutilizar.
2. Alimenta el historial del dashboard.
3. Da **idempotencia**: mismo nodo de Figma dos veces → lo reconoce por `irHash`
   y ofrece *actualizar* en lugar de duplicar. Sin esto, a los dos meses hay
   `HeroAboutUs`, `HeroAboutUs2` y `HeroAboutUsNew`.

Es el `COMPONENTES_REGISTRY.md` de prolicht, pero generado. El de prosa se
desactualiza el día que alguien tiene apuro. Éste no puede.

---

## Contenido

El componente es **presentacional puro**. El copy de Figma entra como valor por
defecto de los props y como fixture del harness:

```vue
<script setup lang="ts">
defineProps<{ title?: string; description?: string; image?: string }>()
</script>
```

con `title = "Sobre nosotros"` como default. Así el componente se ve solo en el
harness y en el showcase, pero no arrastra copy cuando se compone una vista.

Sin data fetching, sin stores, sin lógica de negocio. Eso vive en la vista.

---

## Componente vs vista

Mismo pipeline, **una etapa de diferencia**: `survey`.

- **Componente** — un nodo, un archivo. Variants → props. Sin composición.
- **Vista** — composición. `survey` es obligatorio: sin él generás una vista que
  reimplementa el botón, el card y el hero que ya tenías, y en seis vistas el
  proyecto es impresentable.

Por eso el modo vista va último: **vista sin survey es peor que no tener vista.**

---

## Dashboard

Estático, en `.gridwright/dashboard/`. Sin servidor ni build step.

- Figma / render / diff lado a lado, por viewport
- El IR, plegable
- Tokens: exact, near (con la deriva), new (con lo que se escribió)
- Warnings del distill
- El código generado, con las iteraciones de refine
- Historial: iteraciones por componente, qué métrica falla siempre

**El historial es lo que hace que el sistema mejore.** Si el 80% de las corridas
falla en la misma dimensión, ahí hay una regla que agregar al config — no un
prompt que retocar.

---

## Qué se commitea del proyecto consumidor

`.gridwright/` no es todo descartable ni todo versionable. Se parte:

```gitignore
.gridwright/runs/        # scratch: estado, IR, screenshots de trabajo
.gridwright/dashboard/   # regenerable
!.gridwright/baselines/  # ESTO SÍ — son los golden tests
```

Los baselines **son código de test** (Ley 7): si no están en el repo, la suite de
regresión no existe para nadie más. Los runs son andamio.

Y nunca, en ninguno de los dos: el token.

---

## Fases de desarrollo

| Fase | Qué se construye | Se verifica con |
|---|---|---|
| **0** | Esta spec | aprobación |
| **1** | CLI + máquina de estados + `fetch` + `distill` | IR contra fixtures reales de prolicht |
| **2** | `verify` con Playwright, **sobre un componente escrito a mano** | métricas calibradas contra algo que sabés que está bien |
| **3** | Plugin de Claude Code + `author` + `refine` | el loop cierra |
| **4** | `tokens` + `library` + `golden` + dashboard | el sistema acumula |
| **5** | Modo vista: `survey` + composición | reutilización real |

### Por qué la fase 2 va antes que la 3

Es el orden contraintuitivo y es el importante. **Si no sabés medir, no podés
cerrar el loop.** Un pipeline generativo sin métrica calibrada es un generador de
texto con pasos extra: no hay forma de saber si mejoró o empeoró.

Primero la regla, después la fábrica.

---

## No-objetivos

- No genera diseño. Traduce el que existe.
- No arregla un Figma mal hecho. Lo detecta y lo reporta.
- No hace data fetching, routing ni lógica de negocio.
- No busca pixel-perfect. Busca 90% con la estructural pesando la mitad.
- No publica, no commitea, no pushea nada por su cuenta.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Fuentes: diff crudo da 3–8% con render perfecto | métrica compuesta, estructural al 50% (Ley 6) |
| Figma sin auto-layout → IR pobre | `distill` detecta y frena, no adivina (Ley 2) |
| Refine quema tokens sin converger | `--focus` + tope duro de 4 (Ley 6) |
| Explosión de tokens | ΔE + cajón `near` + gate humano (Leyes 4 y 5) |
| Componentes casi-duplicados | `irHash` en el registry → idempotencia |
| El token de Figma se filtra al transcript o a memoria | lo tipea la persona en su shell, nunca vía Claude (Ley 10.a) |
| URLs firmadas de assets persistidas en el run | se consumen y se descartan, no se guardan (Ley 10.c) |
| `survey` es un problema difícil de verdad | va último; arranca heurístico (nombres + estructura de IR), embeddings después si hace falta |
