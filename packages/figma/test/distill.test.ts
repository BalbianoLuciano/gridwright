import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { distill, shouldHalt, type FigmaNode } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')) as FigmaNode

const OPTS = { maxAbsoluteNodes: 5, maxDepth: 12 }
const SOURCE = { fileKey: 'D7qfUlKn', nodeId: '3978:35299' }

describe('distill — auto-layout is flex, one to one', () => {
  const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)

  it('translates layoutMode and itemSpacing without inventing anything', () => {
    expect(ir.layout).toMatchObject({ kind: 'flex', dir: 'col', gap: 24 })
  })

  it('translates the alignment of both axes', () => {
    expect(ir.layout.justify).toBe('center')
    expect(ir.layout.align).toBe('center')
  })

  it('reads padding in CSS order', () => {
    expect(ir.layout.padding).toEqual([48, 32, 48, 32])
  })

  // This is the intended consequence: Figma gives no margins between siblings,
  // so gridwright cannot generate them. The rule enforces itself.
  it('produces no notion of margin at all', () => {
    expect(JSON.stringify(ir)).not.toContain('margin')
  })
})

describe('distill — roles and content', () => {
  const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
  const flat = (ns = ir.children): any[] => ns.flatMap((n) => [n, ...flat(n.children ?? [])])

  it('detects the image by its fill', () => {
    expect(flat().find((n) => n.role === 'image')).toMatchObject({ asset: 'hero-background.png' })
  })

  it('computes the reduced aspect ratio', () => {
    expect(flat().find((n) => n.role === 'image')?.ratio).toBe('32/9')
  })

  it('classifies 48px as a level 1 heading and 16px as text', () => {
    expect(flat().find((n) => n.name === 'Title')).toMatchObject({ role: 'heading', level: 1 })
    expect(flat().find((n) => n.name === 'Description')?.role).toBe('text')
  })

  // The design copy becomes the prop default, not hardcoded markup.
  it('keeps the copy as a default value and names the slot', () => {
    const title = flat().find((n) => n.name === 'Title')
    expect(title?.default).toBe('About us')
    expect(title?.slot).toBe('title')
  })

  it('ignores hidden layers', () => {
    expect(flat().some((n) => n.name === 'Frame 427')).toBe(false)
  })
})

describe('distill — wrapper collapsing', () => {
  // "Wrapper" has a single child, no padding, no gap and no background: it
  // contributes nothing and would only add a div. This is the difference
  // between a 120-line IR and a 400-line one.
  it('collapses a single-child container with no styling of its own', () => {
    const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(ir.children.some((n) => n.name === 'Wrapper')).toBe(false)
    expect(ir.children.some((n) => n.name === 'Title')).toBe(true)
  })
})

describe('distill — raw tokens', () => {
  const { ir, rawTokens } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)

  it('converts the Figma color to hex', () => {
    expect(ir.tokens.bg).toBe('#1a1a1a')
  })

  it('groups typography as a tuple, not as loose values', () => {
    // A fontSize without its lineHeight is not a token, it is a value.
    expect(rawTokens.find((t) => t.kind === 'typography')?.value).toBe('Inter/700/48px/56px')
  })

  it('deduplicates repeated values and records where they were used', () => {
    const colors = rawTokens.filter((t) => t.kind === 'color')
    expect(new Set(colors.map((c) => c.value)).size).toBe(colors.length)
    expect(colors[0]!.usedIn.length).toBeGreaterThan(0)
  })
})

describe('distill — halts instead of guessing', () => {
  const { ir } = distill(fixture('no-auto-layout'), SOURCE, OPTS)

  it('flags every container without auto-layout as absolute positioning', () => {
    const abs = ir.warnings.filter((w) => w.code === 'absolute-positioning')
    expect(abs.length).toBeGreaterThan(OPTS.maxAbsoluteNodes)
    expect(abs[0]!.severity).toBe('error')
  })

  it('reports unnamed layers', () => {
    expect(ir.warnings.some((w) => w.code === 'unnamed-layer')).toBe(true)
  })

  // A better prompt will not fix this: it gets fixed in Figma.
  it('shouldHalt stops the run', () => {
    const halt = shouldHalt(ir, OPTS)
    expect(halt.halt).toBe(true)
    expect(halt.reason).toMatch(/does not use auto-layout/)
  })

  it('the frame WITH auto-layout does not halt', () => {
    const { ir: good } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(shouldHalt(good, OPTS).halt).toBe(false)
  })
})

describe('distill — semantic hash', () => {
  it('is stable across runs of the same node', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const b = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    expect(a.hash).toBe(b.hash)
  })

  it('ignores metadata: two fetches at different times hash the same', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const b = distill(fixture('hero-auto-layout'), { ...SOURCE, nodeId: '1:1' }, OPTS).ir
    expect(a.hash).toBe(b.hash)
  })

  it('changes when the structure changes', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const mutated = fixture('hero-auto-layout')
    mutated.itemSpacing = 48
    expect(distill(mutated, SOURCE, OPTS).ir.hash).not.toBe(a.hash)
  })
})

describe('distill — context reduction', () => {
  // The IR's reason to exist (Law 2): fitting in the context window without
  // drowning the model in noise.
  it('the IR weighs much less than the raw tree', () => {
    const raw = JSON.stringify(fixture('hero-auto-layout')).length
    const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(JSON.stringify(ir).length).toBeLessThan(raw)
  })
})

/**
 * Values the distill used to swallow.
 *
 * Found by building a real module against a real Figma: the design had a
 * gradient band and a drop shadow, and neither reached the IR. Nothing failed —
 * they were simply gone, which is worse. The component gets authored without
 * them, `verify` then blames the component for a chromatic difference the IR
 * caused, and `refine` chases a fix that is not there.
 *
 * The fixture mirrors the real one: node 1:61528 "Wrapper full", a
 * #f8f7f7 → #003841 gradient cut at 70%, and a -40/+40 shadow at 5%.
 */
describe('distill — what it used to drop in silence', () => {
  const { ir, rawTokens } = distill(fixture('gradient-and-shadow'), SOURCE, OPTS)
  const flat = (ns = ir.children): any[] => ns.flatMap((n) => [n, ...flat(n.children ?? [])])

  it('reads a linear gradient with its stops and percentages', () => {
    expect(ir.tokens.bg).toBe('linear-gradient(180deg, #f8f7f7 0%, #003841 70%)')
  })

  // The angle comes from gradientHandlePositions; CSS measures from "up" and
  // clockwise, so a top-to-bottom Figma axis is 180deg, not 0.
  it('turns the Figma handles into a CSS angle', () => {
    expect(ir.tokens.bg).toMatch(/^linear-gradient\(180deg,/)
  })

  it('reads the drop shadow, which lives outside fills', () => {
    expect(ir.tokens.shadow).toBe('-40px 40px 80px 0px rgba(0, 0, 0, 0.05)')
  })

  it('reads borders from strokes plus strokeWeight', () => {
    const card = flat().find((n) => n.name === 'Card destacada')
    expect(card?.tokens?.border).toBe('2px solid #008599')
  })

  it('registers gradient, shadow and border as their own token kinds', () => {
    const kinds = new Set(rawTokens.map((t) => t.kind))
    expect(kinds).toContain('gradient')
    expect(kinds).toContain('shadow')
    expect(kinds).toContain('border')
  })

  // The point of the fix is not that everything is supported: it is that
  // nothing disappears quietly.
  it('warns about a paint it cannot express instead of dropping it', () => {
    const w = ir.warnings.find((w) => w.code === 'unsupported-paint')
    expect(w?.message).toMatch(/GRADIENT_ANGULAR/)
  })

  it('warns about an effect it cannot express instead of dropping it', () => {
    const w = ir.warnings.find((w) => w.code === 'unsupported-effect')
    expect(w?.message).toMatch(/LAYER_BLUR/)
  })

  it('a hidden effect is not a warning: it is not in the design', () => {
    const hidden = fixture('gradient-and-shadow')
    hidden.children = []   // "Glow" carries the visible blur; drop it
    hidden.effects = [{ type: 'LAYER_BLUR', visible: false, radius: 4 }]
    const { ir: q } = distill(hidden, SOURCE, OPTS)
    expect(q.warnings.some((w) => w.code === 'unsupported-effect')).toBe(false)
  })

  it('the hash changes when a gradient changes, so a redesign is not missed', () => {
    const before = distill(fixture('gradient-and-shadow'), SOURCE, OPTS).ir.hash
    const changed = fixture('gradient-and-shadow')
    changed.fills![0]!.gradientStops![1]!.position = 0.9
    expect(distill(changed, SOURCE, OPTS).ir.hash).not.toBe(before)
  })
})
