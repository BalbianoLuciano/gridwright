/**
 * El IR — Intermediate Representation.
 *
 * Ley 2 de la spec: el árbol crudo de Figma nunca toca el LLM. Un frame real
 * son 2.000 a 5.000 nodos con coordenadas absolutas; esto es su destilación
 * semántica, del orden de 120 líneas.
 *
 * El motivo no es sólo costo de contexto. Con el árbol crudo el modelo se
 * aferra a los `absoluteBoundingBox` que ve y escribe `position: absolute`.
 * Menos información bien elegida produce mejor código que más información
 * cruda.
 */

/** Cómo se acomodan los hijos. `absolute` es una derrota: significa que el
 *  diseño no usó auto-layout y no hay layout que inferir. */
export type LayoutKind = 'flex' | 'grid' | 'absolute' | 'none'

export type Axis = 'row' | 'col'

/** Se mapean desde `primaryAxisAlignItems` / `counterAxisAlignItems` de Figma. */
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'

export interface IRLayout {
  kind: LayoutKind
  dir?: Axis
  /** `itemSpacing` de Figma. Es el `gap` de CSS, uno a uno. */
  gap?: number
  align?: Align
  justify?: Justify
  wrap?: boolean
  /** padding resuelto en el orden [top, right, bottom, left] */
  padding?: [number, number, number, number]
}

/**
 * Rol semántico del nodo. No es el `type` de Figma (FRAME, TEXT, RECTANGLE):
 * es para qué sirve, que es lo que el generador necesita saber para elegir
 * el elemento HTML correcto.
 */
export type IRRole =
  | 'container'
  | 'heading'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'input'
  | 'divider'
  | 'unknown'

export interface IRNode {
  role: IRRole
  /** Nombre del layer, sanitizado. Sirve para nombrar props y slots. */
  name: string
  layout?: IRLayout
  /** Tokens resueltos o valores crudos pendientes de resolver. */
  tokens?: Record<string, string>
  /** Nivel de heading (1-6). Sólo para role: 'heading'. */
  level?: number
  /** Nombre del slot/prop por el que entra el contenido. */
  slot?: string
  /** El copy real del diseño. Va como valor por defecto del prop
   *  (decisión de la spec, sección "Contenido"). */
  default?: string
  /** Nombre de archivo del asset, relativo a la carpeta de la corrida. */
  asset?: string
  /** Relación de aspecto como string CSS, ej "16/9". */
  ratio?: string
  children?: IRNode[]
}

export interface IRSource {
  file: string
  node: string
  /** Nombre del frame en Figma, tal cual. */
  frameName: string
  fetchedAt: string
}

/**
 * Una advertencia no es un error: es algo que el pipeline detectó y no puede
 * resolver solo. `distill` frena si acumula demasiadas de severidad alta,
 * en vez de adivinar (Ley 2, "corolario incómodo").
 */
export interface IRWarning {
  code:
    | 'absolute-positioning'
    | 'unnamed-layer'
    | 'no-auto-layout'
    | 'unsupported-node'
    | 'image-without-fill'
    | 'deep-nesting'
  message: string
  severity: 'info' | 'warn' | 'error'
  /** Ruta del layer en Figma, ej "Hero / Content / Title". */
  path?: string
}

export interface IR {
  name: string
  source: IRSource
  layout: IRLayout
  tokens: Record<string, string>
  children: IRNode[]
  /** Variants de Figma → props del componente. Es un mapeo directo. */
  variants?: Record<string, string[]>
  warnings: IRWarning[]
  /** Hash del contenido semántico, sin metadata. Da idempotencia:
   *  el mismo nodo dos veces se reconoce y se ofrece actualizar. */
  hash: string
}

/**
 * Valor crudo extraído del diseño, antes de resolverse contra el sistema de
 * tokens del proyecto. La etapa `resolve` los clasifica en exact/near/new.
 */
export interface RawToken {
  kind: 'color' | 'spacing' | 'typography' | 'radius' | 'shadow'
  value: string
  /** Dónde apareció, para poder reportarlo. */
  usedIn: string[]
}
