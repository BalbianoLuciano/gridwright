/**
 * Measurements — the numbers `verify` compares against.
 *
 * These deliberately do NOT live in the IR. Law 2 keeps absolute coordinates
 * away from the model, because a model that can see `absoluteBoundingBox`
 * reaches for `position: absolute`. But Law 6 needs those same coordinates to
 * score a render.
 *
 * So they are split by audience rather than by content: `ir.json` is what the
 * model reads, `measurements.json` is what the machine reads. Same distill pass,
 * two files, and neither one has to compromise for the other.
 */

import type { IRRole } from './ir.js'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface MeasuredNode extends Box {
  /** Layer path, e.g. "Wrapper full / Card destacada / Title". Stable enough to
   *  match against a rendered tree, unlike Figma's node ids. */
  path: string
  name: string
  role: IRRole
  /** Depth in the tree. Matching only ever compares nodes at the same depth. */
  depth: number
}

export interface ColorProbe {
  /** Normalized to the root box, so it survives any render scale. */
  u: number
  v: number
  hex: string
  from: string
}

export interface Measurements {
  source: { file: string; node: string }
  /** The frame's own size. Everything else is relative to its top-left. */
  root: Box
  nodes: MeasuredNode[]
  probes: ColorProbe[]
  /** Regions holding text. The perceptual metric masks these out: Figma and
   *  Chromium disagree on kerning and hinting no matter how right the code is. */
  textRegions: Box[]
}

// --- geometry ---------------------------------------------------------------

/** Intersection over union. 1.0 is identical, 0 is no overlap at all. */
export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union <= 0 ? 0 : inter / union
}

/** The largest single-edge error, in pixels. Reported alongside the score
 *  because "the heading is 8px low" is actionable and "0.94" is not. */
export function worstEdge(a: Box, b: Box): { edge: string; delta: number } {
  const edges: Array<[string, number]> = [
    ['left', b.x - a.x],
    ['top', b.y - a.y],
    ['width', b.width - a.width],
    ['height', b.height - a.height],
  ]
  let worst: [string, number] = ['left', 0]
  for (const e of edges) if (Math.abs(e[1]) > Math.abs(worst[1])) worst = e
  return { edge: worst[0], delta: Math.round(worst[1]) }
}

/**
 * Scales a design box into render space.
 *
 * A frame drawn at 1920 and rendered at 1440 is not wrong, it is responsive —
 * so boxes are compared in proportion to their own root, never in raw pixels.
 */
export function normalize(box: Box, root: Box): Box {
  return {
    x: (box.x - root.x) / root.width,
    y: (box.y - root.y) / root.height,
    width: box.width / root.width,
    height: box.height / root.height,
  }
}
