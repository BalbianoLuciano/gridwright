/**
 * Law 6 — the composite score.
 *
 * Figma's text engine and Chromium's disagree on kerning, hinting and
 * antialiasing, so a *perfect* component still comes out 3–8% different at the
 * pixel level. A raw diff threshold at 1% is never reached; at 10% anything
 * passes. Three dimensions instead, weighted by how much rendering noise each
 * one carries.
 *
 * Everything here is pure arithmetic over already-collected numbers. No
 * browser, no images — so the rule can be tested, and calibrated, without one.
 */

import type { Box, MeasuredNode } from './measure.js'
import { iou, normalize, edgeDeltas } from './measure.js'

export type Dimension = 'structural' | 'chromatic' | 'perceptual'

export interface NodeFinding {
  path: string
  /** What moved and by how much, in render pixels. Actionable; a number is not. */
  edge: string
  delta: number
  overlap: number
}

export interface DimensionScore {
  dimension: Dimension
  score: number
  findings: NodeFinding[]
  /** Present when the dimension could not be measured at all. A missing
   *  dimension is reported, never scored as zero — a zero would say "wrong"
   *  when the truth is "unknown". */
  unavailable?: string
}

export interface ViewportScore {
  viewport: string
  width: number
  total: number
  dimensions: DimensionScore[]
}

export interface RunScore {
  /** The worst viewport, not the average. If it breaks on mobile, it is broken. */
  total: number
  worstViewport: string
  passed: boolean
  threshold: number
  viewports: ViewportScore[]
}

export interface Weights {
  structural: number
  chromatic: number
  perceptual: number
}

// --- structural --------------------------------------------------------------

/**
 * Matches design nodes to rendered ones by depth and reading order, then scores
 * each pair by overlap.
 *
 * Matching by geometry alone would be circular: a badly placed element would
 * pair with whatever happens to sit where it should have been, and score well.
 * Tree position is the thing that survives being wrong.
 */
export function scoreStructural(
  design: MeasuredNode[],
  designRoot: Box,
  rendered: MeasuredNode[],
  renderedRoot: Box,
  tolerancePx: number,
): DimensionScore {
  if (design.length === 0) {
    return { dimension: 'structural', score: 0, findings: [], unavailable: 'the design has no measurable nodes' }
  }
  if (rendered.length === 0) {
    return { dimension: 'structural', score: 0, findings: [], unavailable: 'nothing rendered' }
  }

  const byDepth = (ns: MeasuredNode[]) => {
    const m = new Map<number, MeasuredNode[]>()
    for (const n of ns) {
      const list = m.get(n.depth) ?? []
      list.push(n)
      m.set(n.depth, list)
    }
    // Reading order within a depth: top to bottom, then left to right.
    for (const list of m.values()) list.sort((a, b) => a.y - b.y || a.x - b.x)
    return m
  }

  const dd = byDepth(design)
  const rr = byDepth(rendered)
  const findings: NodeFinding[] = []
  let sum = 0
  let counted = 0

  // Tolerance is in render pixels; overlap is normalized. Convert once.
  const slack = renderedRoot.width > 0 ? tolerancePx / renderedRoot.width : 0

  for (const [depth, designNodes] of dd) {
    const renderedNodes = rr.get(depth) ?? []
    for (let i = 0; i < designNodes.length; i++) {
      const d = designNodes[i]!
      counted++
      const r = renderedNodes[i]
      if (!r) {
        // Present in the design, absent from the render. Scores zero, and says so.
        findings.push({ path: d.path, edge: 'missing', delta: 0, overlap: 0 })
        continue
      }
      const dn = normalize(d, designRoot)
      const rn = normalize(r, renderedRoot)
      const overlap = iou(dn, rn)

      // Within tolerance counts as exact: a 1px rounding difference is not a bug.
      const scored = overlap >= 1 - slack * 2 ? 1 : overlap
      sum += scored

      if (scored < 0.98) {
        const expected = {
          x: dn.x * renderedRoot.width, y: dn.y * renderedRoot.height,
          width: dn.width * renderedRoot.width, height: dn.height * renderedRoot.height,
        }
        for (const e of edgeDeltas(expected, r, tolerancePx)) {
          findings.push({ path: d.path, edge: e.edge, delta: e.delta, overlap: round(overlap) })
        }
      }
    }
  }

  // Extra rendered nodes at a depth are not penalised here: a wrapper div that
  // the design did not need is a code-style question, not a fidelity one.
  const score = counted === 0 ? 0 : (sum / counted) * 100
  findings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.overlap - b.overlap)
  return { dimension: 'structural', score: round(score), findings: findings.slice(0, 16) }
}

// --- chromatic ---------------------------------------------------------------

/**
 * CIEDE2000. Worth the arithmetic: euclidean distance in sRGB calls
 * #1A1A1B and #1A1A1A meaningfully different, which starts token rot in
 * `resolve` and false failures here.
 */
export function deltaE(hex1: string, hex2: string): number {
  const [l1, a1, b1] = labOf(hex1)
  const [l2, a2, b2] = labOf(hex2)

  const kL = 1, kC = 1, kH = 1
  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const cBar = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)))
  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1)
  const c2p = Math.hypot(a2p, b2)
  const h1p = hueOf(b1, a1p)
  const h2p = hueOf(b2, a2p)

  const dLp = l2 - l1
  const dCp = c2p - c1p
  let dhp = 0
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2)

  const lBarP = (l1 + l2) / 2
  const cBarP = (c1p + c2p) / 2
  let hBarP = h1p + h2p
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hBarP += h1p + h2p < 360 ? 360 : -360
    hBarP /= 2
  }

  const t = 1 - 0.17 * Math.cos(rad(hBarP - 30)) + 0.24 * Math.cos(rad(2 * hBarP))
    + 0.32 * Math.cos(rad(3 * hBarP + 6)) - 0.20 * Math.cos(rad(4 * hBarP - 63))
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2))
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7))
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2)
  const sc = 1 + 0.045 * cBarP
  const sh = 1 + 0.015 * cBarP * t
  const rt = -Math.sin(rad(2 * dTheta)) * rc

  return Math.sqrt(
    (dLp / (kL * sl)) ** 2 +
    (dCp / (kC * sc)) ** 2 +
    (dHp / (kH * sh)) ** 2 +
    rt * (dCp / (kC * sc)) * (dHp / (kH * sh)),
  )
}

export interface ProbeResult { from: string; expected: string; got: string; deltaE: number }

/**
 * ΔE ≤ 1 is "indistinguishable to a trained eye" and scores full marks. Beyond
 * that it falls off linearly to ΔE 10, which is unmistakably a different colour.
 */
export function scoreChromatic(probes: ProbeResult[], tolerance = 1): DimensionScore {
  if (probes.length === 0) {
    return { dimension: 'chromatic', score: 0, findings: [], unavailable: 'no colour probes taken' }
  }
  let sum = 0
  const findings: NodeFinding[] = []
  for (const p of probes) {
    const over = Math.max(0, p.deltaE - tolerance)
    const s = Math.max(0, 1 - over / 9)
    sum += s
    if (s < 0.98) {
      findings.push({ path: `${p.from}: ${p.expected} → ${p.got}`, edge: 'colour', delta: round(p.deltaE, 1), overlap: round(s) })
    }
  }
  findings.sort((a, b) => b.delta - a.delta)
  return { dimension: 'chromatic', score: round((sum / probes.length) * 100), findings: findings.slice(0, 12) }
}

// --- perceptual ---------------------------------------------------------------

/** Share of differing pixels, text already masked out by the caller. */
export function scorePerceptual(differing: number, compared: number): DimensionScore {
  if (compared <= 0) {
    return { dimension: 'perceptual', score: 0, findings: [], unavailable: 'nothing to compare' }
  }
  const ratio = differing / compared
  return { dimension: 'perceptual', score: round(Math.max(0, 1 - ratio) * 100), findings: [] }
}

// --- composition ---------------------------------------------------------------

export function combine(dims: DimensionScore[], weights: Weights): number {
  // An unavailable dimension is dropped and the rest reweighted, rather than
  // counted as zero. Scoring "unknown" as "wrong" makes the number a lie.
  const usable = dims.filter((d) => !d.unavailable)
  if (usable.length === 0) return 0
  const total = usable.reduce((acc, d) => acc + weights[d.dimension], 0)
  if (total <= 0) return 0
  return round(usable.reduce((acc, d) => acc + d.score * weights[d.dimension], 0) / total)
}

/** The worst viewport, never the average (Law 6). */
export function combineViewports(viewports: ViewportScore[], threshold: number): RunScore {
  if (viewports.length === 0) {
    return { total: 0, worstViewport: '—', passed: false, threshold, viewports }
  }
  const worst = viewports.reduce((a, b) => (b.total < a.total ? b : a))
  return {
    total: worst.total,
    worstViewport: worst.viewport,
    passed: worst.total >= threshold,
    threshold,
    viewports,
  }
}

// --- colour space ------------------------------------------------------------

function labOf(hex: string): [number, number, number] {
  const { r, g, b } = parseHex(hex)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const R = lin(r / 255), G = lin(g / 255), B = lin(b / 255)

  // sRGB → XYZ (D65), then XYZ → CIELAB.
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180
function hueOf(b: number, ap: number): number {
  if (b === 0 && ap === 0) return 0
  const h = (Math.atan2(b, ap) * 180) / Math.PI
  return h >= 0 ? h : h + 360
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}
