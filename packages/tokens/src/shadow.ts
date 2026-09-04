/**
 * Comparing shadows.
 *
 * A shadow is a list of layers, each one offsets, a blur, a spread and a
 * colour, optionally inset. Two identical shadows can be written completely
 * differently: Figma exports `rgba(10, 13, 18, 0.05)` and modern Tailwind
 * configs write `rgb(10 13 18 / 0.05)`; `0` and `0px` are the same length; and
 * the layers do not always come out in the same order.
 *
 * Found on a real run — santillanafrancais already had `boxShadow.button` with
 * exactly the three layers gridwright was proposing to add, and string
 * comparison saw two unrelated values.
 */

/** One shadow layer, in a form two of them can be compared in. */
export interface ShadowLayer {
  inset: boolean
  x: number
  y: number
  blur: number
  spread: number
  /** `r,g,b,a` with alpha rounded, so notation stops mattering. */
  color: string
}

export function parseShadow(value: string): ShadowLayer[] {
  return splitLayers(value).map(parseLayer).filter((l): l is ShadowLayer => l !== null)
}

/**
 * Splits on commas that separate layers, not on the ones inside `rgb(...)`.
 *
 * A plain `split(',')` tears `rgba(10, 13, 18, 0.05)` into four pieces, which
 * is how a comparison of two identical shadows ends up comparing nonsense.
 */
function splitLayers(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function parseLayer(layer: string): ShadowLayer | null {
  if (/^none$/i.test(layer.trim())) return null

  const inset = /\binset\b/i.test(layer)
  let rest = layer.replace(/\binset\b/gi, ' ').trim()

  const colorMatch = rest.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?![\d(]))/i)
  const color = colorMatch ? normalizeColor(colorMatch[0]) : '0,0,0,1'
  if (colorMatch) rest = rest.replace(colorMatch[0], ' ')

  const lengths = [...rest.matchAll(/-?\d*\.?\d+(?:px|rem|em)?/g)].map((m) => toPx(m[0]))
  if (lengths.length < 2) return null

  return {
    inset,
    x: lengths[0] ?? 0,
    y: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color,
  }
}

/** `rgb(10 13 18 / 0.18)`, `rgba(10, 13, 18, 0.18)` and `#0a0d12` all land on
 *  the same string. */
export function normalizeColor(input: string): string {
  const value = input.trim().toLowerCase()

  const fn = value.match(/^rgba?\(([^)]*)\)$/)
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
    const [r, g, b] = parts
    const a = parts.length > 3 ? parts[3]! : 1
    return `${r ?? 0},${g ?? 0},${b ?? 0},${round(a)}`
  }

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return `${r},${g},${b},${round(a)}`
  }

  if (value === 'transparent') return '0,0,0,0'
  return value
}

/**
 * Whether two shadows would paint the same.
 *
 * Layers are compared as a set. Order changes what paints on top, but a design
 * tool and a stylesheet routinely list the same stack in opposite orders, and
 * treating that as a different shadow is what makes a project add a second copy
 * of one it already has.
 */
export function sameShadow(a: string, b: string): boolean {
  const la = parseShadow(a)
  const lb = parseShadow(b)
  if (la.length === 0 || la.length !== lb.length) return false

  const key = (l: ShadowLayer) => `${l.inset ? 'i' : 'o'}:${l.x}:${l.y}:${l.blur}:${l.spread}:${l.color}`
  const setA = la.map(key).sort()
  const setB = lb.map(key).sort()
  return setA.every((k, i) => k === setB[i])
}

function toPx(value: string): number {
  const n = parseFloat(value)
  if (Number.isNaN(n)) return 0
  return /rem|em/.test(value) ? n * 16 : n
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
