# Gridwright

Pipeline end-to-end de maquetación. Entra un nodo de Figma, sale un componente
construido, verificado visualmente y registrado en el design system del
proyecto. Se opera desde Claude Code.

> **El diseño entra como nodo, sale como sistema.**
>
> Gridwright no genera componentes: construye el design system del proyecto de a
> un nodo por vez. Cada corrida deja el repo con más tokens resueltos, más
> componentes registrados y más superficie verificada. Si un componente sale
> bien pero no aportó nada al sistema, la corrida falló.

**Estado: fase 1 de 5.** Andan `fetch` y `distill`. El resto de las etapas
existen en la máquina de estados y se reportan explícitamente como no
construidas, en vez de fingir que corrieron. Ver [el roadmap](#roadmap).

---

## La idea

La tentación obvia es escribir un prompt largo que le explique a un agente cómo
maquetar. Ya se probó: en un repo anterior hay un workflow de cinco fases escrito
en prosa, y el agente se saltea la fase de análisis cada vez que el pedido parece
simple. **Un prompt es una sugerencia.**

Gridwright invierte el reparto. La máquina de estados vive en disco y la hace
cumplir un CLI. Claude no decide qué etapa viene: se la pregunta.

```console
$ gw next --json
{
  "run": "hero-about-us-01",
  "stage": "author",
  "actor": "agent",
  "action": "escribir el componente",
  "inputs": { "ir": "…/ir.json", "reference": "…/reference.png" },
  "gate": null
}
```

Claude hace la parte creativa, escribe archivos y corre `gw verify`. Si el gate
falla, la etapa sigue siendo `refine`. No hay forma de saltar a `golden` sin
pasar, porque el CLI no lo permite. Si se corta la sesión, el estado sigue en
`.gridwright/runs/<id>/state.json`.

El reparto es explícito:

| Lo hace el código | Lo hace el modelo |
|---|---|
| Traer el nodo, los assets y la referencia | Escribir el componente idiomático del repo |
| Destilar el árbol al IR | Nombrar cosas, decidir la API de props |
| Matchear y clasificar tokens | Nombrar los tokens nuevos |
| Indexar componentes existentes | Decidir qué reutilizar |
| Renderizar, medir, diffear | Interpretar el diff y corregir |

Si se puede verificar con un assert, no lo hace el modelo. Si necesita criterio
sobre el código que ya existe, no lo hace el programa.

---

## Instalación

```bash
npm i -g @gridwright/cli     # el motor
gw auth login                # una vez por máquina
```

El token de Figma **lo tipeás vos, en tu terminal**. Nunca a través del agente:
si aparece en un mensaje queda en el transcript, en el contexto y en la memoria
persistente, y hay que considerarlo comprometido. Dentro de Claude Code, el
prefijo `!` ejecuta en tu shell, fuera de la conversación:

```
! gw auth login
```

`gw auth login` lee de stdin oculto y valida contra la API antes de guardar
nada, en `~/.config/gridwright/credentials.json` con modo `0600`. No existe un
flag `--token`: un argumento queda en el historial del shell y en `ps`.

---

## Uso

En el repo donde va a vivir el componente:

```bash
gw init                      # detecta framework, tokens y library. Una vez.
gw build "https://www.figma.com/design/<KEY>/<nombre>?node-id=3978-35299"
```

`gw init` no pregunta lo que puede averiguar. El framework sale del
`package.json`, y el destino de los tokens se **busca** en vez de asumirse: hay
proyectos con Tailwind 4 que igual declaran sus tokens en un
`tailwind.config.js` legacy. "Qué versión tenés instalada" y "dónde están
declarados tus tokens" son preguntas distintas.

```console
$ gw build "https://www.figma.com/design/D7qf…?node-id=3978-35299"
✓ Corrida hero-about-us-01 — frame "Hero About Us" → HeroAboutUs
→ 3 assets
    · hero-about-us.png 1440x405 · recortado 1440x512 → 1440x405
→ IR: 4 nodos, 6 valores crudos (312KB → 4KB, 99% menos)
    hash a3f2c1d4e5b6
```

| Comando | |
|---|---|
| `gw build <url>` | abre una corrida y ejecuta hasta donde llegue |
| `gw next [--json]` | qué etapa toca y quién la ejecuta — **el protocolo** |
| `gw status` | corridas y en qué etapa está cada una |
| `gw ir [<run>]` | imprime el IR |
| `gw auth status` | qué credencial se está usando y de dónde salió |

---

## El IR

El árbol crudo de un frame son 2.000 a 5.000 nodos. Meterlo en el contexto del
modelo no es sólo caro: da **peor** resultado, porque se aferra a los
`absoluteBoundingBox` que ve y escribe `position: absolute`. Entre Figma y el
modelo va siempre la destilación.

```json
{
  "name": "HeroAboutUs",
  "layout": { "kind": "flex", "dir": "col", "gap": 24, "align": "center" },
  "tokens": { "bg": "#1a1a1a" },
  "children": [
    { "role": "image", "name": "Hero Background", "asset": "hero-background.png", "ratio": "32/9" },
    { "role": "heading", "level": 1, "slot": "title", "default": "Sobre nosotros" }
  ],
  "warnings": [],
  "hash": "a3f2c1d4e5b6"
}
```

Dos de las traducciones son isomorfismos, no heurísticas:

**Auto-layout es flex con gap.** `layoutMode` + `itemSpacing` +
`primaryAxisAlignItems` mapea uno a uno a `flex-col gap-6 justify-*`. Efecto
lateral valioso: gridwright **no puede** generar margins entre hermanos, porque
Figma no le da esa información.

**Los variants son props.** Un componente con `Size=Large, State=Hover` entrega
la matriz sin inventar nada.

Y un corolario incómodo: si el Figma no usa auto-layout, no hay layout que
extraer. Eso no se arregla con mejor prompt. `distill` lo detecta y frena.

```console
✗ El IR no es utilizable.

  7 nodos están posicionados de forma absoluta (el máximo tolerado es 5).
  Este frame no usa auto-layout, así que no hay layout que inferir.
  Esto no se arregla con mejor prompt: se arregla en Figma.
```

---

## Verificación

El motor de texto de Figma y el de Chromium hacen kerning y antialiasing
distintos: un componente **perfecto** da 3–8% de píxeles diferentes. Un umbral
de diff crudo al 1% no se alcanza nunca, y al 10% pasa cualquier cosa. Por eso
el score es compuesto:

| Dimensión | Peso | Cómo se mide | Ruido |
|---|---|---|---|
| Estructural | 50% | bounding boxes, tolerancia ±2px | ninguno |
| Cromática | 25% | muestreo de color, ΔE | ninguno |
| Perceptual | 25% | diff de píxeles con máscara sobre el texto | alto |

Umbral **90%**, sobre el **peor viewport, no el promedio**: si rompe en mobile,
rompe. Cuando no llega, el refine no es "intentá de nuevo" — recibe qué falló y
dónde, que es lo que hace que converja en dos iteraciones en vez de quemar
tokens hasta el tope.

---

## Las etapas

| # | Etapa | Quién | Gate |
|---|---|---|---|
| — | `auth` | la persona | precondición, una vez por máquina |
| 0 | `init` | humano | una vez por proyecto |
| 1 | `fetch` | código | |
| 2 | `distill` | código | frena si el IR sale pobre |
| 3 | `resolve` | código | |
| 4 | **`tokens`** | código + modelo | **humano** · obligatoria |
| 5 | **`library:ensure`** | código | **humano 1ª vez** · obligatoria |
| 6 | `survey` | código | |
| 7 | `plan` | modelo | **humano** |
| 8 | `author` | modelo | |
| 9 | `harness` | código | |
| 10 | `verify` | código | score ≥ 90 |
| 11 | `refine` | modelo | tope 4 iteraciones |
| 12 | `golden` | humano | **humano** |
| 13 | **`library:register`** | código | obligatoria |
| 14 | `report` | código | |

Tres gates humanos: `plan`, `tokens` y `golden`. Nada que mute el proyecto se
escribe sin aprobación. Un componente mal generado se reescribe en diez minutos;
un sistema de tokens contaminado se hereda para siempre.

Y fijate el orden de 4 y 8: **los tokens se escriben antes que el componente.**
Al revés, el modelo escribe `bg-[#1a1a1a]` y después hay que refactorizar.

---

## Roadmap

| Fase | Qué | Estado |
|---|---|---|
| 0 | La spec | ✅ [`specs/001-pipeline.md`](specs/001-pipeline.md) |
| 1 | CLI, máquina de estados, `fetch`, `distill` | ✅ |
| 2 | `verify` con Playwright, sobre un componente escrito a mano | ⬜ |
| 3 | Plugin de Claude Code, `author`, `refine` | ⬜ |
| 4 | `tokens`, `library`, `golden`, dashboard | ⬜ |
| 5 | Modo vista: `survey` y composición | ⬜ |

**La fase 2 va antes que la 3 a propósito.** Si no sabés medir, no podés cerrar
el loop: un pipeline generativo sin métrica calibrada es un generador de texto
con pasos extra. Primero la regla, después la fábrica.

---

## Desarrollo

```bash
pnpm install
pnpm test        # 52 tests
pnpm typecheck
pnpm build
```

```
packages/
├── core/     tipos del IR, máquina de estados, config, credenciales
├── figma/    cliente API, distill, extracción de assets
└── cli/      el binario `gw`
```

Los tests de `distill` corren contra fixtures con la forma real de la API de
Figma, incluido un frame sin auto-layout que **debe** hacer frenar al pipeline.

## No-objetivos

- No genera diseño. Traduce el que existe.
- No arregla un Figma mal hecho. Lo detecta y lo reporta.
- No hace data fetching, routing ni lógica de negocio.
- No busca pixel-perfect.
- No publica, no commitea, no pushea nada por su cuenta.

## Licencia

MIT
