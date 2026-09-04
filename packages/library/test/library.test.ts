import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type GridwrightConfig } from '@gridwright/core'
import { ensureLibrary, registerComponent, readRegistry, findByHash } from '../src/index.js'

let root: string
let config: GridwrightConfig

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gw-lib-'))
  config = {
    ...DEFAULT_CONFIG,
    library: { dir: 'src/components/ui', barrel: 'src/components/ui/index.ts', registry: 'src/components/ui/registry.json' },
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const component = (name: string) => {
  const dir = join(root, 'src/components/ui', name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'index.tsx')
  writeFileSync(path, 'export default function C() { return null }\n')
  return path
}

describe('library:ensure — the bare minimum', () => {
  it('creates the folder, the barrel and the registry', () => {
    const r = ensureLibrary(root, config)
    expect(r.created).toHaveLength(3)
    expect(existsSync(join(root, 'src/components/ui/index.ts'))).toBe(true)
    expect(readRegistry(root, config)).toEqual({})
  })

  // Creating structure in someone's repo is invasive exactly once, and that is
  // the run a person is asked to approve.
  it('reports the first time apart from every other', () => {
    expect(ensureLibrary(root, config).bootstrapped).toBe(true)
    expect(ensureLibrary(root, config).bootstrapped).toBe(false)
  })

  it('running twice creates nothing new', () => {
    ensureLibrary(root, config)
    expect(ensureLibrary(root, config).created).toHaveLength(0)
  })

  it('leaves an existing barrel alone', () => {
    mkdirSync(join(root, 'src/components/ui'), { recursive: true })
    writeFileSync(join(root, 'src/components/ui/index.ts'), "export * from './Button'\n")
    ensureLibrary(root, config)
    expect(readFileSync(join(root, 'src/components/ui/index.ts'), 'utf8')).toContain('./Button')
  })
})

describe('library:register', () => {
  const figma = { file: 'rOTwYF2J', node: '1:61528', irHash: 'a3f2c1d4e5b6' }

  it('records the component and exports it', () => {
    ensureLibrary(root, config)
    const path = component('ValuePropositionCard')
    const r = registerComponent(root, config, {
      name: 'ValuePropositionCard', componentPath: path, figma,
      props: ['title', 'description'], tokens: ['colors.primary.500'], score: 94,
    })

    expect(r.entry.path).toBe('src/components/ui/ValuePropositionCard/index.tsx')
    expect(r.entry.runs).toBe(1)
    const barrel = readFileSync(join(root, 'src/components/ui/index.ts'), 'utf8')
    expect(barrel).toContain("export { default as ValuePropositionCard } from './ValuePropositionCard'")
  })

  /**
   * The reason the hash is in there at all. Without it you end up with
   * HeroAboutUs, HeroAboutUs2 and HeroAboutUsNew two months in, and no way to
   * tell which one anything actually uses.
   */
  it('the same design registered twice is an update, not a second component', () => {
    ensureLibrary(root, config)
    const path = component('Card')
    registerComponent(root, config, { name: 'Card', componentPath: path, figma, props: [], tokens: [] })
    const second = registerComponent(root, config, {
      name: 'CardNew', componentPath: path, figma, props: [], tokens: [],
    })

    expect(second.updatedExisting).toBe('Card')
    expect(second.entry.runs).toBe(2)
    expect(Object.keys(readRegistry(root, config))).toEqual(['Card'])
  })

  it('a different design is a different component', () => {
    ensureLibrary(root, config)
    registerComponent(root, config, {
      name: 'Card', componentPath: component('Card'), figma, props: [], tokens: [],
    })
    registerComponent(root, config, {
      name: 'Banner', componentPath: component('Banner'),
      figma: { ...figma, irHash: 'ffffffffffff' }, props: [], tokens: [],
    })
    expect(Object.keys(readRegistry(root, config)).sort()).toEqual(['Banner', 'Card'])
  })

  it('does not export the same component twice', () => {
    ensureLibrary(root, config)
    const path = component('Card')
    registerComponent(root, config, { name: 'Card', componentPath: path, figma, props: [], tokens: [] })
    registerComponent(root, config, { name: 'Card', componentPath: path, figma, props: [], tokens: [] })
    const barrel = readFileSync(join(root, 'src/components/ui/index.ts'), 'utf8')
    expect(barrel.match(/from '\.\/Card'/g)).toHaveLength(1)
  })

  // This is what survey reads in phase 5, so the shape has to be right now.
  it('is searchable by design hash', () => {
    ensureLibrary(root, config)
    registerComponent(root, config, {
      name: 'Card', componentPath: component('Card'), figma, props: [], tokens: [],
    })
    expect(findByHash(readRegistry(root, config), 'a3f2c1d4e5b6')?.[0]).toBe('Card')
    expect(findByHash(readRegistry(root, config), 'nope')).toBeNull()
  })
})
