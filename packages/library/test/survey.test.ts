import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type GridwrightConfig, type IR } from '@gridwright/core'
import { survey, indexComponents, extractProps, extractShape, ensureLibrary, registerComponent } from '../src/index.js'

let root: string
let config: GridwrightConfig

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gw-sur-'))
  config = {
    ...DEFAULT_CONFIG,
    library: { dir: 'src/components/ui', barrel: 'src/components/ui/index.ts', registry: 'src/components/ui/registry.json' },
  }
  ensureLibrary(root, config)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, body: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
  return p
}

const ir = (name: string, children: IR['children'] = []): IR => ({
  name, source: { file: 'F', node: '1:1', frameName: name, fetchedAt: '' },
  layout: { kind: 'flex' }, tokens: {}, children, warnings: [], hash: 'h1',
})

describe('indexing what a project already has', () => {
  it('finds components outside the gridwright library too', () => {
    // A repo that has been building by hand for months has far more to reuse
    // than gridwright registered; ignoring it grows a second library beside
    // the first.
    write('src/components/HeroBanner/index.tsx', 'export default function HeroBanner({ title, image }) { return <h1>{title}</h1> }')
    const found = indexComponents(root, config)
    expect(found.map((c) => c.name)).toContain('HeroBanner')
  })

  it('skips barrels, helpers and lowercase files', () => {
    write('src/components/index.ts', 'export * from "./x"')
    write('src/components/utils.ts', 'export const x = 1')
    write('src/components/helpers/format.ts', 'export const f = 1')
    expect(indexComponents(root, config)).toHaveLength(0)
  })

  it('reads props from a React signature and a Vue defineProps', () => {
    expect(extractProps('function Card({ title, description, onClick }) {}'))
      .toEqual(expect.arrayContaining(['title', 'description']))
    expect(extractProps('defineProps<{ title: string; image?: string }>()'))
      .toEqual(expect.arrayContaining(['title', 'image']))
  })

  it('reads a rough shape from the markup', () => {
    expect(extractShape('<div><h2>t</h2><p>b</p><button>go</button></div>'))
      .toEqual(['heading', 'text', 'button'])
  })
})

describe('survey — proposing, never picking', () => {
  beforeEach(() => {
    write('src/components/ui/HeroBanner/index.tsx', 'export default function HeroBanner({ title }) { return <h1>{title}</h1> }')
    write('src/components/ui/ValuePropositionCard/index.tsx',
      'export default function ValuePropositionCard({ title, body }) { return <div><h2>{title}</h2><p>{body}</p></div> }')
  })

  it('matches a name even when Figma spaced it out', () => {
    const r = survey(root, config, ir('Page', [
      { role: 'container', name: 'Value Proposition Card', children: [] },
    ]))
    const hit = r.candidates.find((c) => c.component.name === 'ValuePropositionCard')
    expect(hit?.reason).toBe('same-name')
    expect(hit!.confidence).toBeGreaterThan(0.8)
  })

  it('does not invent a match for something genuinely new', () => {
    const r = survey(root, config, ir('Page', [
      { role: 'container', name: 'Zephyr Widget', children: [] },
    ]))
    expect(r.candidates.filter((c) => c.confidence >= 0.6)).toHaveLength(0)
  })

  // Every candidate carries a sentence, because a number is not a reason to
  // reuse something and `plan` is where a person decides.
  it('every candidate says why, in words', () => {
    const r = survey(root, config, ir('Page', [
      { role: 'container', name: 'HeroBanner', children: [] },
    ]))
    expect(r.candidates.length).toBeGreaterThan(0)
    for (const c of r.candidates) expect(c.note.length).toBeGreaterThan(20)
  })

  it('ranks a shape match below a name match', () => {
    const r = survey(root, config, ir('Page', [
      { role: 'container', name: 'HeroBanner', children: [] },
      { role: 'container', name: 'Unrelated', children: [
        { role: 'heading', name: 'h' }, { role: 'text', name: 't' }, { role: 'text', name: 'u' },
      ]},
    ]))
    const byName = r.candidates.find((c) => c.reason === 'same-name')
    const byShape = r.candidates.find((c) => c.reason === 'similar-shape')
    if (byShape) expect(byName!.confidence).toBeGreaterThan(byShape.confidence)
  })

  /** The strongest finding there is: this design is already built. */
  it('recognises a design it has already registered', () => {
    const path = write('src/components/ui/Card/index.tsx', 'export default function Card() { return null }')
    registerComponent(root, config, {
      name: 'Card', componentPath: path,
      figma: { file: 'F', node: '1:1', irHash: 'h1' }, props: [], tokens: [],
    })
    expect(survey(root, config, ir('Card')).duplicateOf).toBe('Card')
  })

  it('one suggestion per component per target, not one per signal', () => {
    const r = survey(root, config, ir('Page', [
      { role: 'container', name: 'HeroBanner', children: [{ role: 'heading', name: 'x' }] },
    ]))
    const keys = r.candidates.map((c) => `${c.target}::${c.component.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
