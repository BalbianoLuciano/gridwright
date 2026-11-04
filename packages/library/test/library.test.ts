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

  // Vite resolves `.vue` only when the specifier spells it out, and a project
  // that imports its components through an alias never writes `./X.vue`, so
  // detection finds nothing and `importExtension` is ''. The barrel then
  // exported './button/Button' and the dev server failed in the consumer.
  describe('single-file components keep their extension in the barrel', () => {
    const sfc = (name: string, file: string) => {
      const dir = join(root, 'src/components/ui', name)
      mkdirSync(dir, { recursive: true })
      const path = join(dir, file)
      writeFileSync(path, '<template><div /></template>\n')
      return path
    }
    const barrelOf = () => readFileSync(join(root, 'src/components/ui/index.ts'), 'utf8')

    it.each(['', '.js'])('.vue with importExtension %j', (importExtension) => {
      config = { ...config, conventions: { ...config.conventions, importExtension } as GridwrightConfig['conventions'] }
      ensureLibrary(root, config)
      registerComponent(root, config, {
        name: 'Button', componentPath: sfc('button', 'Button.vue'), figma, props: [], tokens: [],
      })
      expect(barrelOf()).toContain("export { default as Button } from './button/Button.vue'")
    })

    it('an index.vue is not collapsed to its directory', () => {
      config = { ...config, conventions: { ...config.conventions, importExtension: '' } as GridwrightConfig['conventions'] }
      ensureLibrary(root, config)
      registerComponent(root, config, {
        name: 'Card', componentPath: sfc('card', 'index.vue'), figma, props: [], tokens: [],
      })
      expect(barrelOf()).toContain("from './card/index.vue'")
    })

    it('.svelte keeps its extension too', () => {
      ensureLibrary(root, config)
      registerComponent(root, config, {
        name: 'Tag', componentPath: sfc('tag', 'Tag.svelte'), figma, props: [], tokens: [],
      })
      expect(barrelOf()).toContain("from './tag/Tag.svelte'")
    })

    it('registering the same .vue twice exports it once', () => {
      ensureLibrary(root, config)
      const path = sfc('button', 'Button.vue')
      registerComponent(root, config, { name: 'Button', componentPath: path, figma, props: [], tokens: [] })
      registerComponent(root, config, { name: 'Button', componentPath: path, figma, props: [], tokens: [] })
      expect(barrelOf().match(/Button\.vue/g)).toHaveLength(1)
    })

    /**
     * The upgrade path. Every Vue project that registered a component with the
     * release before this fix has `from './button/Button'` in its barrel. The
     * dedupe compared the whole specifier, so the new `.vue` spelling did not
     * match it and was appended: two `export { default as Button }` lines, which
     * TypeScript and esbuild both reject. The barrel this PR fixes stopped
     * parsing on the first re-register.
     */
    it('corrects the extensionless line an earlier release wrote', () => {
      ensureLibrary(root, config)
      const barrel = join(root, 'src/components/ui/index.ts')
      writeFileSync(barrel, `export { default as Button } from './button/Button'\n`)

      registerComponent(root, config, {
        name: 'Button', componentPath: sfc('button', 'Button.vue'), figma, props: [], tokens: [],
      })

      expect(barrelOf().match(/as Button\b/g)).toHaveLength(1)
      expect(barrelOf()).toContain("from './button/Button.vue'")
    })

    // A barrel the project wrote by hand can export several names from one
    // line. Replacing that line to correct the path would drop the others, so
    // a name already exported is left exactly as it is.
    it('leaves a hand-written line that exports more than this name', () => {
      ensureLibrary(root, config)
      const barrel = join(root, 'src/components/ui/index.ts')
      const hand = `export { Button, ButtonGroup } from './button'\n`
      writeFileSync(barrel, hand)

      registerComponent(root, config, {
        name: 'Button', componentPath: sfc('button', 'Button.vue'), figma, props: [], tokens: [],
      })

      expect(barrelOf()).toBe(hand)
    })
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
