/** The subset of the Figma API that gridwright actually uses.
 *  Deliberately not the full type: what is missing here is what Law 2 says to
 *  discard before anything reaches the model. */

export interface FigmaColor { r: number; g: number; b: number; a?: number }

export interface FigmaGradientStop {
  position: number
  color: FigmaColor
}

export interface FigmaPaint {
  type: 'SOLID' | 'IMAGE' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
  imageRef?: string
  gradientStops?: FigmaGradientStop[]
  /** Three normalized points: origin, end of the axis, and width. The CSS angle
   *  comes out of the first two. */
  gradientHandlePositions?: Array<{ x: number; y: number }>
}

/** Shadows and blurs. Figma keeps them apart from fills, which is exactly why
 *  they were being dropped: nothing that only reads `fills` will ever see one. */
export interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | string
  visible?: boolean
  color?: FigmaColor
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
}

export interface FigmaTypeStyle {
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  lineHeightPx?: number
  letterSpacing?: number
  textCase?: string
}

export interface FigmaBox { x: number; y: number; width: number; height: number }

export type FigmaLayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL'
export type FigmaAxisAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | 'BASELINE'

export interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  children?: FigmaNode[]
  fills?: FigmaPaint[]
  strokes?: FigmaPaint[]
  absoluteBoundingBox?: FigmaBox | null
  layoutMode?: FigmaLayoutMode
  itemSpacing?: number
  layoutWrap?: 'NO_WRAP' | 'WRAP'
  primaryAxisAlignItems?: FigmaAxisAlign
  counterAxisAlignItems?: FigmaAxisAlign
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  cornerRadius?: number
  effects?: FigmaEffect[]
  strokeWeight?: number
  characters?: string
  style?: FigmaTypeStyle
  exportSettings?: unknown[]
  componentPropertyDefinitions?: Record<string, { type: string; variantOptions?: string[] }>
  componentProperties?: Record<string, { type: string; value: string }>
}

export interface FigmaNodesResponse {
  name?: string
  nodes: Record<string, { document: FigmaNode } | undefined>
}

export interface FigmaImagesResponse {
  err?: string | null
  images: Record<string, string | null>
}

export interface FigmaMe { id: string; email?: string; handle?: string }
