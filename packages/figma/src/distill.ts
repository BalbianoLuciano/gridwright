/**
 * Law 2 — The raw Figma tree never reaches the LLM.
 *
 * This is where the distillation lives. Two of the translations are
 * isomorphisms rather than heuristics, which is why the result is trustworthy:
 *
 *   auto-layout  →  flex with gap   (layoutMode + itemSpacing + *AxisAlignItems)
 *   variants     →  props           (componentPropertyDefinitions)
 *
 * A valuable side effect of the first: gridwright CANNOT generate margins
 * between siblings, because Figma never gives it that information. The rule
 * enforces itself.
 *
 * What is not an isomorphism — the semantic role of each node — is a declared
 * heuristic, and when it fails it says so in `warnings` instead of guessing
 * quietly.
 */

import { createHash } from 'node:crypto'
import type {
  IR, IRLayout, IRNode, IRRole, IRWarning, RawToken, Align, Justify, Axis,
  Measurements, MeasuredNode, ColorProbe, Box,
} from '@gridwright/core'
import type { FigmaAxisAlign, FigmaColor, FigmaEffect, FigmaNode, FigmaPaint } from './types.js'

export interface DistillOptions {
  maxAbsoluteNodes: number
  maxDepth: number
}

export interface DistillResult {
  ir: IR
  /** The numbers `verify` scores against. Kept out of the IR on purpose: Law 2
   *  keeps absolute coordinates away from the model, Law 6 needs them for the
   *  machine. Same pass, two files, neither compromises for the other. */
  measurements: Measurements
  /** Raw design values, not yet resolved against the token system. This is what
   *  the `resolve` stage (phase 4) consumes. Until then `ir.tokens` also holds
   *  raw values, not token names. */
  rawTokens: RawToken[]
}

export function distill(
  root: FigmaNode,
  source: { fileKey: string; nodeId: string },
  opts: DistillOptions,
): DistillResult {
  const rootBox: Box = {
    x: root.absoluteBoundingBox?.x ?? 0,
    y: root.absoluteBoundingBox?.y ?? 0,
    width: root.absoluteBoundingBox?.width ?? 0,
    height: root.absoluteBoundingBox?.height ?? 0,
  }
  const ctx: Ctx = {
    warnings: [], raw: new Map(), opts, absoluteCount: 0,
    measured: [], probes: [], textRegions: [], root: rootBox,
  }

  const children = (root.children ?? [])
    .filter(isVisible)
    .map((c) => walk(c, ctx, root.name, 1))
    .filter((n): n is IRNode => n !== null)

  const ir: IR = {
    name: toPascalCase(root.name),
    source: {
      file: source.fileKey,
      node: source.nodeId,
      frameName: root.name,
      fetchedAt: new Date().toISOString(),
    },
    layout: readLayout(root, ctx, root.name),
    tokens: readTokens(root, ctx, root.name),
    children: collapse(children),
    warnings: ctx.warnings,
    hash: '',
  }

  const variants = readVariants(root)
  if (variants) ir.variants = variants

  ir.hash = semanticHash(ir)

  const measurements: Measurements = {
    source: { file: source.fileKey, node: source.nodeId },
    root: rootBox,
    nodes: ctx.measured,
    probes: ctx.probes,
    textRegions: ctx.textRegions,
  }

  return { ir, measurements, rawTokens: [...ctx.raw.values()] }
}

/** If the design did not use auto-layout there is no layout to extract.
 *  Halting beats emitting two hundred lines that merely look right. */
export function shouldHalt(ir: IR, opts: DistillOptions): { halt: boolean; reason?: string } {
  const absolute = ir.warnings.filter((w) => w.code === 'absolute-positioning').length
  if (absolute > opts.maxAbsoluteNodes) {
    return {
      halt: true,
      reason:
        `${absolute} nodes are absolutely positioned (the tolerated maximum is ${opts.maxAbsoluteNodes}). ` +
        `This frame does not use auto-layout, so there is no layout to infer. ` +
        `A better prompt will not fix this: it gets fixed in Figma.`,
    }
  }
  return { halt: false }
}

// ---------------------------------------------------------------------------

interface Ctx {
  warnings: IRWarning[]
  raw: Map<string, RawToken>
  opts: DistillOptions
  absoluteCount: number
  measured: MeasuredNode[]
  probes: ColorProbe[]
  textRegions: Box[]
  root: Box
}

function walk(node: FigmaNode, ctx: Ctx, parentPath: string, depth: number): IRNode | null {
  const path = `${parentPath} / ${node.name}`

  if (depth > ctx.opts.maxDepth) {
    ctx.warnings.push({
      code: 'deep-nesting',
      severity: 'warn',
      message: `${depth} levels of nesting; cut off here. Usually Figma wrappers with no semantic meaning.`,
      path,
    })
    return null
  }

  if (isUnnamed(node.name)) {
    ctx.warnings.push({
      code: 'unnamed-layer',
      severity: 'info',
      message: `Unnamed layer ("${node.name}"). Component and prop names come from these.`,
      path,
    })
  }

  const role = detectRole(node)
  const out: IRNode = { role, name: sanitize(node.name) }

  // Recorded for `verify` even though it never reaches the IR. Nodes with no
  // box (Figma sometimes omits it) are skipped rather than measured as zero.
  const box = node.absoluteBoundingBox
  if (box && box.width > 0 && box.height > 0) {
    ctx.measured.push({ path, name: out.name, role, depth, x: box.x, y: box.y, width: box.width, height: box.height })

    // Text regions get masked out of the perceptual diff: Figma and Chromium
    // will never agree on kerning no matter how right the code is.
    if (role === 'heading' || role === 'text') {
      ctx.textRegions.push({ x: box.x, y: box.y, width: box.width, height: box.height })
    }

    // One probe at the centre of anything with a flat fill. Normalized to the
    // root so it survives being rendered at another scale.
    const solid = (node.fills ?? []).find((f) => f.type === 'SOLID' && f.visible !== false)
    if (solid?.color && ctx.root.width > 0 && ctx.root.height > 0) {
      ctx.probes.push({
        u: (box.x + box.width / 2 - ctx.root.x) / ctx.root.width,
        v: (box.y + box.height / 2 - ctx.root.y) / ctx.root.height,
        hex: toHex(solid),
        from: path,
      })
    }
  }

  const layout = readLayout(node, ctx, path)
  if (layout.kind !== 'none') out.layout = layout

  const tokens = readTokens(node, ctx, path)
  if (Object.keys(tokens).length > 0) out.tokens = tokens

  if (role === 'heading' || role === 'text') {
    const text = node.characters?.trim()
    if (text) {
      // The design copy becomes the prop's default value, not hardcoded markup
      // (spec, "Content" section).
      out.default = text
      out.slot = slotName(node.name, text)
    }
    if (role === 'heading') out.level = headingLevel(node)
  }

  if (role === 'image') {
    out.asset = `${slugify(node.name)}.png`
    const box = node.absoluteBoundingBox
    if (box && box.width > 0 && box.height > 0) out.ratio = aspectRatio(box.width, box.height)
  }

  const kids = (node.children ?? [])
    .filter(isVisible)
    .map((c) => walk(c, ctx, path, depth + 1))
    .filter((n): n is IRNode => n !== null)

  if (kids.length > 0) out.children = collapse(kids)

  return out
}

/**
 * auto-layout → flex. One to one, no inference.
 * If the node has children and NO auto-layout, that is a warning: its children
 * are absolutely positioned and the layout is not recoverable.
 */
function readLayout(node: FigmaNode, ctx: Ctx, path: string): IRLayout {
  const mode = node.layoutMode
  const childCount = (node.children ?? []).filter(isVisible).length

  if (!mode || mode === 'NONE') {
    if (childCount > 1) {
      ctx.warnings.push({
        code: 'absolute-positioning',
        severity: 'error',
        message: `"${node.name}" has ${childCount} children with no auto-layout. The layout is not inferable.`,
        path,
      })
      return { kind: 'absolute' }
    }
    return { kind: 'none' }
  }

  const layout: IRLayout = {
    kind: 'flex',
    dir: mode === 'VERTICAL' ? 'col' : ('row' as Axis),
  }
  if (node.itemSpacing) layout.gap = node.itemSpacing
  if (node.layoutWrap === 'WRAP') layout.wrap = true

  const justify = mapJustify(node.primaryAxisAlignItems)
  if (justify) layout.justify = justify
  const align = mapAlign(node.counterAxisAlignItems)
  if (align) layout.align = align

  const p: [number, number, number, number] = [
    node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0,
  ]
  if (p.some((v) => v !== 0)) layout.padding = p

  return layout
}

function mapJustify(a: FigmaAxisAlign | undefined): Justify | undefined {
  switch (a) {
    case 'MIN': return 'start'
    case 'CENTER': return 'center'
    case 'MAX': return 'end'
    case 'SPACE_BETWEEN': return 'between'
    default: return undefined
  }
}

function mapAlign(a: FigmaAxisAlign | undefined): Align | undefined {
  switch (a) {
    case 'MIN': return 'start'
    case 'CENTER': return 'center'
    case 'MAX': return 'end'
    case 'BASELINE': return 'baseline'
    default: return undefined
  }
}

/**
 * Raw values: background, radius, typography, shadows, borders. `resolve` swaps
 * them for project token names in phase 4.
 *
 * Anything visible that cannot be represented gets a warning rather than
 * silence. A design value that vanishes here does not come back: the component
 * is authored without it, `verify` then blames the component for a difference
 * the IR caused, and `refine` chases a fix that is not there.
 */
function readTokens(node: FigmaNode, ctx: Ctx, path: string): Record<string, string> {
  const out: Record<string, string> = {}
  const fills = (node.fills ?? []).filter((f) => f.visible !== false)

  const solid = fills.find((f) => f.type === 'SOLID')
  if (solid?.color) {
    const hex = toHex(solid)
    out.bg = hex
    record(ctx, { kind: 'color', value: hex, usedIn: [path] })
  }

  const gradient = fills.find((f) => f.type.startsWith('GRADIENT_'))
  if (gradient) {
    const css = toGradient(gradient)
    if (css) {
      out.bg = css
      record(ctx, { kind: 'gradient', value: css, usedIn: [path] })
    } else {
      ctx.warnings.push({
        code: 'unsupported-paint',
        severity: 'warn',
        message: `"${node.name}" has a ${node.fills?.find((f) => f.type.startsWith('GRADIENT_'))?.type} fill that could not be read. It will be missing from the component.`,
        path,
      })
    }
  }

  // Anything left that is neither solid, gradient nor image is a fill we would
  // otherwise drop without saying so.
  for (const f of fills) {
    if (f.type === 'SOLID' || f.type === 'IMAGE' || f.type.startsWith('GRADIENT_')) continue
    ctx.warnings.push({
      code: 'unsupported-paint',
      severity: 'warn',
      message: `"${node.name}" has a ${f.type} fill, which the IR cannot express yet.`,
      path,
    })
  }

  if (node.cornerRadius) {
    const v = `${node.cornerRadius}px`
    out.radius = v
    record(ctx, { kind: 'radius', value: v, usedIn: [path] })
  }

  // Figma keeps effects outside `fills`, which is exactly why they used to be
  // dropped: reading fills alone never sees a shadow.
  const shadows: string[] = []
  for (const e of node.effects ?? []) {
    if (e.visible === false) continue
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      shadows.push(toShadow(e))
    } else {
      ctx.warnings.push({
        code: 'unsupported-effect',
        severity: 'warn',
        message: `"${node.name}" has a ${e.type} effect, which the IR cannot express yet.`,
        path,
      })
    }
  }
  if (shadows.length > 0) {
    const v = shadows.join(', ')
    out.shadow = v
    record(ctx, { kind: 'shadow', value: v, usedIn: [path] })
  }

  const stroke = (node.strokes ?? []).find((s) => s.visible !== false && s.type === 'SOLID')
  if (stroke?.color && node.strokeWeight) {
    const v = `${node.strokeWeight}px solid ${toHex(stroke)}`
    out.border = v
    record(ctx, { kind: 'border', value: v, usedIn: [path] })
  }

  if (node.style?.fontSize) {
    const s = node.style
    const v = [
      s.fontFamily ?? 'inherit',
      s.fontWeight ?? 400,
      `${s.fontSize}px`,
      s.lineHeightPx ? `${Math.round(s.lineHeightPx)}px` : 'normal',
    ].join('/')
    out.type = v
    record(ctx, { kind: 'typography', value: v, usedIn: [path] })
  }

  const gap = node.itemSpacing
  if (gap) record(ctx, { kind: 'spacing', value: `${gap}px`, usedIn: [path] })

  return out
}

function record(ctx: Ctx, token: RawToken): void {
  const key = `${token.kind}:${token.value}`
  const existing = ctx.raw.get(key)
  if (existing) existing.usedIn.push(...token.usedIn)
  else ctx.raw.set(key, { ...token })
}

/** Figma variants → the prop matrix. Direct mapping, nothing invented. */
function readVariants(node: FigmaNode): Record<string, string[]> | undefined {
  const defs = node.componentPropertyDefinitions
  if (!defs) return undefined
  const out: Record<string, string[]> = {}
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'VARIANT' && def.variantOptions?.length) {
      out[camelCase(name)] = def.variantOptions
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Collapses useless wrappers: a container with a single child, no layout of its
 * own, no padding and no background, contributes nothing and would only add a
 * div.
 *
 * This is the difference between a 120-line IR and a 400-line one.
 */
function collapse(nodes: IRNode[]): IRNode[] {
  return nodes.map((n) => {
    let cur = n
    while (
      cur.role === 'container' &&
      cur.children?.length === 1 &&
      !cur.tokens &&
      !cur.layout?.padding &&
      !cur.layout?.gap
    ) {
      cur = cur.children[0]!
    }
    if (cur.children) cur = { ...cur, children: collapse(cur.children) }
    return cur
  })
}

// --- declared heuristics ---------------------------------------------------

function detectRole(node: FigmaNode): IRRole {
  const n = node.name.toLowerCase()

  if (node.type === 'TEXT') {
    return isHeadingish(node) ? 'heading' : 'text'
  }
  if (hasImageFill(node)) return 'image'
  if (/\bicon\b|^ic[-_]/.test(n)) return 'icon'
  if (/\bbutton\b|\bbtn\b|\bcta\b/.test(n)) return 'button'
  if (/\binput\b|\bfield\b|\btextarea\b/.test(n)) return 'input'
  if (node.type === 'LINE' || /\bdivider\b|\bseparator\b/.test(n)) return 'divider'
  if (node.children?.length) return 'container'
  if (['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'RECTANGLE'].includes(node.type)) return 'container'
  return 'unknown'
}

function isHeadingish(node: FigmaNode): boolean {
  const n = node.name.toLowerCase()
  if (/\b(h[1-6]|title|heading|headline)\b/.test(n)) return true
  return (node.style?.fontSize ?? 0) >= 24
}

/** The level comes from the size, unless the layer name states it explicitly.
 *  It is a heuristic: `plan` can override it with human judgment. */
function headingLevel(node: FigmaNode): number {
  const explicit = node.name.toLowerCase().match(/\bh([1-6])\b/)
  if (explicit) return Number(explicit[1])
  const size = node.style?.fontSize ?? 16
  if (size >= 48) return 1
  if (size >= 36) return 2
  if (size >= 28) return 3
  if (size >= 22) return 4
  return 5
}

export function hasImageFill(node: FigmaNode): boolean {
  return (node.fills ?? []).some((f: FigmaPaint) => f.type === 'IMAGE' && f.visible !== false)
}

function isVisible(node: FigmaNode): boolean {
  return node.visible !== false
}

function isUnnamed(name: string): boolean {
  return /^(Frame|Group|Rectangle|Vector|Ellipse|Line|Component)\s+\d+$/i.test(name.trim())
}

// --- utilities -------------------------------------------------------------

function toHex(paint: FigmaPaint): string {
  const c = paint.color!
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  const hex = [to255(c.r), to255(c.g), to255(c.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
  const alpha = (paint.opacity ?? 1) * (c.a ?? 1)
  if (alpha >= 0.999) return `#${hex}`
  return `#${hex}${to255(alpha).toString(16).padStart(2, '0')}`
}

/**
 * A Figma gradient becomes a CSS one.
 *
 * The angle comes from `gradientHandlePositions`: the first two points are the
 * start and end of the axis, in coordinates normalized to the node's box. CSS
 * measures its angle from "up" and clockwise, hence the +90 and the flipped y.
 * With no handles we fall back to top-to-bottom, which is Figma's own default.
 */
function toGradient(paint: FigmaPaint): string | null {
  const stops = paint.gradientStops
  if (!stops || stops.length === 0) return null

  const parts = stops.map((s) => {
    const hex = toHex({ type: 'SOLID', color: s.color, opacity: paint.opacity })
    return `${hex} ${round(s.position * 100)}%`
  })

  if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(${parts.join(', ')})`

  const h = paint.gradientHandlePositions
  let angle = 180
  if (h && h.length >= 2) {
    const dx = h[1]!.x - h[0]!.x
    const dy = h[1]!.y - h[0]!.y
    angle = round((Math.atan2(dx, -dy) * 180) / Math.PI)
    if (angle < 0) angle += 360
  }
  return `linear-gradient(${angle}deg, ${parts.join(', ')})`
}

/** CSS box-shadow. Figma's INNER_SHADOW is CSS's `inset`. */
function toShadow(e: FigmaEffect): string {
  const x = round(e.offset?.x ?? 0)
  const y = round(e.offset?.y ?? 0)
  const blur = round(e.radius ?? 0)
  const spread = round(e.spread ?? 0)
  const color = e.color ? rgba(e.color) : 'rgba(0,0,0,0.25)'
  const inset = e.type === 'INNER_SHADOW' ? 'inset ' : ''
  return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`
}

function rgba(c: FigmaColor): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  const a = c.a ?? 1
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${round(a, 2)})`
}

function round(n: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

export function aspectRatio(w: number, h: number): string {
  const g = gcd(Math.round(w), Math.round(h))
  return `${Math.round(w) / g}/${Math.round(h) / g}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function sanitize(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

export function slugify(name: string): string {
  return sanitize(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'layer'
}

export function toPascalCase(name: string): string {
  const parts = sanitize(name).replace(/[^A-Za-z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean)
  const pascal = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('')
  // An identifier cannot start with a digit.
  return /^[0-9]/.test(pascal) ? `C${pascal}` : pascal || 'Component'
}

export function camelCase(name: string): string {
  const p = toPascalCase(name)
  return p[0]!.toLowerCase() + p.slice(1)
}

/** Name of the prop the content comes in through. Prefers the layer name; when
 *  that is generic, falls back to the content. */
function slotName(layerName: string, text: string): string {
  const clean = camelCase(layerName)
  if (clean && !/^(text|label|content|frame|group)\d*$/i.test(clean)) return clean
  return camelCase(text.split(/\s+/).slice(0, 3).join(' ')) || 'text'
}

/**
 * Hash of the semantic content: structure, roles and layout. No filenames, no
 * timestamps, no warnings.
 *
 * This is what gives idempotency: the same Figma node twice is recognized and
 * offered as an update rather than a duplicate. Without it, two months later
 * you have HeroAboutUs, HeroAboutUs2 and HeroAboutUsNew.
 */
export function semanticHash(ir: IR): string {
  const skeleton = (n: IRNode): unknown => ({
    r: n.role, l: n.layout, t: n.tokens, lv: n.level,
    c: (n.children ?? []).map(skeleton),
  })
  const payload = JSON.stringify({
    layout: ir.layout,
    tokens: ir.tokens,
    variants: ir.variants,
    children: ir.children.map(skeleton),
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 12)
}
