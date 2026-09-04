import { describe, it, expect } from 'vitest'
import {
  deltaE, scoreChromatic, scoreStructural, scorePerceptual, combine, combineViewports,
  type MeasuredNode, type Box, type ViewportScore,
} from '../src/index.js'

const ROOT: Box = { x: 0, y: 0, width: 1920, height: 344 }
const W = { structural: 0.5, chromatic: 0.25, perceptual: 0.25 }

const node = (p: string, depth: number, b: Box): MeasuredNode =>
  ({ path: p, name: p.split(' / ').pop()!, role: 'container', depth, ...b })

describe('ΔE — CIEDE2000, not euclidean distance', () => {
  it('a colour against itself is zero', () => {
    expect(deltaE('#1a1a1a', '#1a1a1a')).toBe(0)
  })

  // The whole reason for the arithmetic. Euclidean sRGB calls these different;
  // an eye does not. Treating them as different is what starts token rot.
  it('#1A1A1A and #1A1A1B are the same colour', () => {
    expect(deltaE('#1a1a1a', '#1a1a1b')).toBeLessThan(1)
  })

  it('black against white is unmistakable', () => {
    expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(95)
  })

  it('is symmetric', () => {
    const a = deltaE('#003841', '#008599')
    const b = deltaE('#008599', '#003841')
    expect(a).toBeCloseTo(b, 6)
  })

  it('handles shorthand hex', () => {
    expect(deltaE('#fff', '#ffffff')).toBe(0)
  })
})

describe('chromatic — tolerance before penalty', () => {
  it('scores full marks inside the tolerance', () => {
    const s = scoreChromatic([{ from: 'bg', expected: '#1a1a1a', got: '#1a1a1b', deltaE: 0.4 }])
    expect(s.score).toBe(100)
    expect(s.findings).toHaveLength(0)
  })

  it('reports the drift once it is visible', () => {
    const s = scoreChromatic([{ from: 'bg', expected: '#003841', got: '#008599', deltaE: 24 }])
    expect(s.score).toBeLessThan(20)
    expect(s.findings[0]!.path).toContain('#003841')
  })

  // Nothing measured is not the same as everything wrong.
  it('says it could not measure rather than scoring zero', () => {
    expect(scoreChromatic([]).unavailable).toBeTruthy()
  })
})

describe('structural — the dimension that carries half the weight', () => {
  const design = [
    node('Wrapper / Card', 1, { x: 64, y: 64, width: 432, height: 216 }),
    node('Wrapper / Card / Title', 2, { x: 88, y: 88, width: 384, height: 80 }),
  ]

  it('a pixel-identical render scores 100', () => {
    expect(scoreStructural(design, ROOT, design, ROOT, 2).score).toBe(100)
  })

  // A frame drawn at 1920 and rendered at 1440 is responsive, not wrong.
  it('scores proportion, not raw pixels', () => {
    const smallRoot: Box = { x: 0, y: 0, width: 960, height: 172 }
    const halved = design.map((n) => node(n.path, n.depth, {
      x: n.x / 2, y: n.y / 2, width: n.width / 2, height: n.height / 2,
    }))
    expect(scoreStructural(design, ROOT, halved, smallRoot, 2).score).toBe(100)
  })

  it('names what moved and by how much, not just a number', () => {
    const moved = [
      design[0]!,
      node('Wrapper / Card / Title', 2, { x: 88, y: 96, width: 384, height: 80 }),
    ]
    const s = scoreStructural(design, ROOT, moved, ROOT, 2)
    expect(s.score).toBeLessThan(100)
    const f = s.findings.find((f) => f.path.endsWith('Title'))
    expect(f).toMatchObject({ edge: 'top', delta: 8 })
  })

  it('a missing element scores zero for that node and says so', () => {
    const s = scoreStructural(design, ROOT, [design[0]!], ROOT, 2)
    expect(s.findings.some((f) => f.edge === 'missing')).toBe(true)
    expect(s.score).toBeLessThan(60)
  })

  // Matching on geometry would be circular: a misplaced element would pair with
  // whatever sits where it should have been, and score well.
  it('matches by tree position, so a swap is caught', () => {
    const swapped = [
      design[0]!,
      node('Wrapper / Card / Title', 2, { x: 500, y: 250, width: 384, height: 80 }),
    ]
    expect(scoreStructural(design, ROOT, swapped, ROOT, 2).score).toBeLessThan(70)
  })

  it('an extra wrapper div is not a fidelity problem', () => {
    const withExtra = [...design, node('Wrapper / Card / Spacer', 2, { x: 0, y: 300, width: 10, height: 10 })]
    expect(scoreStructural(design, ROOT, withExtra, ROOT, 2).score).toBe(100)
  })

  it('reports nothing rendered instead of scoring it wrong', () => {
    expect(scoreStructural(design, ROOT, [], ROOT, 2).unavailable).toBeTruthy()
  })

  // The failure that made identity matching necessary. Positional pairing takes
  // design[i] against rendered[i] at a depth, so one inlined <svg> ahead of its
  // siblings shifts every pair after it: the title ends up measured against the
  // illustration's box and a correct component reports nonsense.
  it('an inlined svg ahead of its siblings does not shift every pair', () => {
    const withIcon = [
      node('Wrapper / Card / Icon', 2, { x: 88, y: 70, width: 24, height: 24 }),
      ...design,
    ]
    expect(scoreStructural(design, ROOT, withIcon, ROOT, 2).score).toBe(100)
  })

  // Figma lets siblings share a name, so the path alone is not a key.
  it('siblings sharing a name pair by occurrence, in reading order', () => {
    const twins = [
      node('Wrapper / Col', 1, { x: 64, y: 64, width: 200, height: 100 }),
      node('Wrapper / Col', 1, { x: 64, y: 264, width: 200, height: 100 }),
    ]
    expect(scoreStructural(twins, ROOT, twins, ROOT, 2).score).toBe(100)

    // A shared name must not absorb a real difference between the two.
    const wrong = [
      node('Wrapper / Col', 1, { x: 64, y: 64, width: 900, height: 100 }),
      node('Wrapper / Col', 1, { x: 64, y: 264, width: 200, height: 100 }),
    ]
    expect(scoreStructural(twins, ROOT, wrong, ROOT, 2).score).toBeLessThan(90)
  })

  // An unlabelled component still gets measured; it just gets the old, brittle
  // pairing rather than nothing at all.
  it('falls back to depth and reading order when the render carries no labels', () => {
    const unlabelled = design.map((n, i) => node(`div${i}`, n.depth, n))
    expect(scoreStructural(design, ROOT, unlabelled, ROOT, 2).score).toBe(100)
  })
})

describe('perceptual', () => {
  it('a clean diff is 100', () => {
    expect(scorePerceptual(0, 10000).score).toBe(100)
  })

  // Fonts alone put a perfect component at 3-8% differing pixels, which is
  // exactly why this dimension only carries a quarter.
  it('font noise lands in the nineties, not near zero', () => {
    expect(scorePerceptual(500, 10000).score).toBe(95)
  })
})

describe('combining — Law 6', () => {
  const full = [
    { dimension: 'structural' as const, score: 100, findings: [] },
    { dimension: 'chromatic' as const, score: 100, findings: [] },
    { dimension: 'perceptual' as const, score: 100, findings: [] },
  ]

  it('weights structural at half', () => {
    const dims = [
      { ...full[0]!, score: 0 },
      full[1]!,
      full[2]!,
    ]
    expect(combine(dims, W)).toBe(50)
  })

  // Scoring "unknown" as "wrong" makes the number a lie.
  it('drops an unavailable dimension and reweights the rest', () => {
    const dims = [
      full[0]!,
      { dimension: 'chromatic' as const, score: 0, findings: [], unavailable: 'no probes' },
      full[2]!,
    ]
    expect(combine(dims, W)).toBe(100)
  })

  it('the run takes the worst viewport, not the average', () => {
    const vps: ViewportScore[] = [
      { viewport: 'desktop', width: 1440, total: 99, dimensions: [] },
      { viewport: 'tablet', width: 768, total: 96, dimensions: [] },
      { viewport: 'mobile', width: 375, total: 71, dimensions: [] },
    ]
    const run = combineViewports(vps, 90)
    expect(run.total).toBe(71)
    expect(run.worstViewport).toBe('mobile')
    expect(run.passed).toBe(false)   // averaging would have given 88.7 and still failed,
                                     // but at 375/768/1440 = 99/96/89 it would have passed
  })

  it('passes only when every viewport clears the threshold', () => {
    const vps: ViewportScore[] = [
      { viewport: 'desktop', width: 1440, total: 99, dimensions: [] },
      { viewport: 'mobile', width: 375, total: 90, dimensions: [] },
    ]
    expect(combineViewports(vps, 90).passed).toBe(true)
  })
})

/**
 * Calibration, from running the engine against a component broken on purpose.
 *
 * The card was moved 8px down and narrowed by 20px — visibly wrong — and the
 * run still came out at 90.03% and passed. Worth pinning: the number is only
 * as strict as the weights make it, and this is the shape of what slips
 * through.
 */
describe('calibration — what the threshold actually lets past', () => {
  it('reports every edge that is off, not only the worst one', () => {
    const design = [node('Card / Inner', 1, { x: 40, y: 40, width: 300, height: 120 })]
    const broken = [node('Card / Inner', 1, { x: 40, y: 48, width: 280, height: 120 })]
    const s = scoreStructural(design, ROOT, broken, ROOT, 2)

    // Fixing the width, re-running, and only then learning about the 8px costs
    // a whole refine iteration.
    expect(s.findings.map((f) => f.edge).sort()).toEqual(['top', 'width'])
  })

  it('a visibly displaced element still scores in the eighties', () => {
    const design = [node('Card / Inner', 1, { x: 40, y: 40, width: 300, height: 120 })]
    const broken = [node('Card / Inner', 1, { x: 40, y: 48, width: 280, height: 120 })]
    expect(scoreStructural(design, ROOT, broken, ROOT, 2).score).toBeGreaterThan(80)
  })

  // Dropping a dimension raises the weight of the ones that remain, so a run
  // with no reference image is scored more leniently on structure than one
  // with it. Worth knowing before reading a number as a verdict.
  it('losing the perceptual dimension makes structural carry two thirds', () => {
    const dims = [
      { dimension: 'structural' as const, score: 85, findings: [] },
      { dimension: 'chromatic' as const, score: 100, findings: [] },
      { dimension: 'perceptual' as const, score: 0, findings: [], unavailable: 'no reference' },
    ]
    expect(combine(dims, W)).toBeCloseTo(90, 0)
  })
})
