/**
 * The IR — Intermediate Representation.
 *
 * Law 2 of the spec: the raw Figma tree never reaches the LLM. A real frame is
 * 2,000 to 5,000 nodes with absolute coordinates; this is its semantic
 * distillation, on the order of 120 lines.
 *
 * The reason is not only context cost. Given the raw tree the model latches
 * onto the `absoluteBoundingBox` values it sees and writes `position: absolute`.
 * Less information, well chosen, produces better code than more raw
 * information.
 */

/** How children are arranged. `absolute` is a defeat: it means the design did
 *  not use auto-layout and there is no layout to infer. */
export type LayoutKind = 'flex' | 'grid' | 'absolute' | 'none'

export type Axis = 'row' | 'col'

/** Mapped from Figma's `primaryAxisAlignItems` / `counterAxisAlignItems`. */
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'

export interface IRLayout {
  kind: LayoutKind
  dir?: Axis
  /** Figma's `itemSpacing`. It is the CSS `gap`, one to one. */
  gap?: number
  align?: Align
  justify?: Justify
  wrap?: boolean
  /** Resolved padding in [top, right, bottom, left] order. */
  padding?: [number, number, number, number]
}

/**
 * Semantic role of the node. Not Figma's `type` (FRAME, TEXT, RECTANGLE): what
 * it is *for*, which is what the generator needs in order to pick the right
 * HTML element.
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
  /** Layer name, sanitized. Prop and slot names come from here. */
  name: string
  layout?: IRLayout
  /** Resolved tokens, or raw values still pending resolution. */
  tokens?: Record<string, string>
  /** Heading level (1-6). Only for role: 'heading'. */
  level?: number
  /** Name of the slot/prop the content comes in through. */
  slot?: string
  /** The real copy from the design. Becomes the prop's default value rather
   *  than being hardcoded in the markup (spec, "Content" section). */
  default?: string
  /** Asset filename, relative to the run folder. */
  asset?: string
  /** Aspect ratio as a CSS string, e.g. "16/9". */
  ratio?: string
  children?: IRNode[]
}

export interface IRSource {
  file: string
  node: string
  /** The frame name in Figma, verbatim. */
  frameName: string
  fetchedAt: string
}

/**
 * A warning is not an error: it is something the pipeline detected and cannot
 * resolve on its own. `distill` halts if too many high-severity ones pile up,
 * rather than guessing (Law 2, "the uncomfortable corollary").
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
  /** Layer path in Figma, e.g. "Hero / Content / Title". */
  path?: string
}

export interface IR {
  name: string
  source: IRSource
  layout: IRLayout
  tokens: Record<string, string>
  children: IRNode[]
  /** Figma variants become component props. It is a direct mapping. */
  variants?: Record<string, string[]>
  warnings: IRWarning[]
  /** Hash of the semantic content, metadata excluded. This is what gives
   *  idempotency: the same node twice is recognized and offered as an update. */
  hash: string
}

/**
 * A raw value pulled from the design, before it is resolved against the
 * project's token system. The `resolve` stage sorts these into exact/near/new.
 */
export interface RawToken {
  kind: 'color' | 'spacing' | 'typography' | 'radius' | 'shadow'
  value: string
  /** Where it showed up, so it can be reported. */
  usedIn: string[]
}
