import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectConventions, shapeFor, pathFor } from '../src/conventions.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gw-conv-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const file = (rel: string, body: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

/**
 * `init` learned the directory and stopped, which is half of what `author`
 * needs. santillanafrancais keeps `components/ui/Button.tsx` with a default
 * export and `components/modules/HeroBanner/index.tsx` with a named
 * `Component` plus a `fields` and a `meta` its CMS refuses to load without.
 *
 * Writing the wrong shape produces a file that compiles, renders in the
 * harness, scores well and does not work in the product — and nothing
 * downstream catches it, because every check here is about fidelity to the
 * design.
 */
describe('learning how a project writes components', () => {
  const asModule = (name: string) => file(`components/modules/${name}/index.tsx`,
    `export function Component({ fieldValues }) { return null }\n` +
    `export const fields = []\nexport const meta = {}\n`)
  const asUi = (name: string) => file(`components/ui/${name}.tsx`,
    `export default function ${name}() { return null }\n`)

  it('tells two shapes in the same project apart', () => {
    for (const n of ['HeroBanner', 'Title', 'NewsGrid']) asModule(n)
    for (const n of ['Button', 'Heading', 'Media']) asUi(n)

    const c = detectConventions(root)
    const modules = c.shapes.find((s) => s.dir === 'components/modules')!
    const ui = c.shapes.find((s) => s.dir === 'components/ui')!

    expect(modules).toMatchObject({ file: '{Name}/index.tsx', export: 'named:Component' })
    expect(ui).toMatchObject({ file: '{Name}.tsx', export: 'default' })
  })

  // A module missing its `fields` is not a module, however good the markup is.
  it('picks up the other exports every file of a kind carries', () => {
    for (const n of ['A', 'B', 'C']) asModule(n)
    const shape = detectConventions(root).shapes[0]!
    expect(shape.alsoExports).toEqual(['fields', 'meta'])
  })

  it('ignores an export only one file happens to have', () => {
    for (const n of ['A', 'B', 'C']) asModule(n)
    file('components/modules/D/index.tsx',
      'export function Component() { return null }\nexport const oneOff = 1\n')
    expect(detectConventions(root).shapes[0]!.alsoExports).not.toContain('oneOff')
  })

  it('ranks by how many files back it up, since one example is a guess', () => {
    for (const n of ['A', 'B', 'C', 'D']) asModule(n)
    asUi('Button')
    expect(detectConventions(root).shapes[0]!.dir).toBe('components/modules')
  })

  it('points at a real file to read before writing', () => {
    asModule('HeroBanner')
    expect(detectConventions(root).shapes[0]!.example).toContain('HeroBanner')
  })

  // A frontend nested under src/theme/ keeps its conventions where the repo
  // keeps its docs, not beside the components.
  it('finds convention docs above the project, up to the repo root', () => {
    mkdirSync(join(root, '.git'), { recursive: true })
    file('docs/02-convenciones.md', '# rules')
    file('docs/patrones/12-modulos.md', '# modules')
    const nested = join(root, 'src/theme/site')
    mkdirSync(join(nested, 'components/ui'), { recursive: true })
    writeFileSync(join(nested, 'components/ui/Button.tsx'), 'export default function Button() {}')

    const docs = detectConventions(nested).docs
    expect(docs.some((d) => d.endsWith('02-convenciones.md'))).toBe(true)
    expect(docs.some((d) => d.endsWith('12-modulos.md'))).toBe(true)
  })

  it('does not climb past the repo into someone else’s docs', () => {
    mkdirSync(join(root, 'repo/.git'), { recursive: true })
    file('docs/outside.md', '# not ours')
    file('repo/components/ui/Button.tsx', 'export default function Button() {}')
    expect(detectConventions(join(root, 'repo')).docs.some((d) => d.includes('outside'))).toBe(false)
  })

  // Found on a Vite + React project that keeps a folder per module with the
  // component named after it, next to its demo: `src/modules/Intro/Intro.tsx`.
  // `init` wrote no shapes at all, so `author` had no example and `verify` had
  // no export shape to mount with.
  it('reads the shape of a folder-per-module directory it only knows as a placement', () => {
    for (const n of ['Intro', 'Hero']) {
      file(`src/modules/${n}/${n}.tsx`, `export default function ${n}() { return null }\n`)
      file(`src/modules/${n}/demo.tsx`, `export default {}\n`)
    }

    const c = detectConventions(root)
    const shape = c.shapes.find((s) => s.dir === 'src/modules')!
    expect(shape).toMatchObject({ file: '{Name}/{Name}.tsx', export: 'default', seenIn: 2 })
    expect(pathFor(shape, 'ProofCards')).toBe('src/modules/ProofCards/ProofCards.tsx')
  })

  // The same convention in the spelling Vue and Nuxt use. Only PascalCase
  // folders counted, so a `src/modules` of `hero-banner/hero-banner.vue` was
  // still invisible after the folder-per-module fix.
  it('reads a folder-per-module directory spelled in kebab-case', () => {
    for (const n of ['hero-banner', 'pricing-table']) {
      file(`src/modules/${n}/${n}.vue`, '<template><div /></template>\n')
    }

    const shape = detectConventions(root).shapes.find((s) => s.dir === 'src/modules')!
    expect(shape).toMatchObject({ file: '{name}/{name}.vue', seenIn: 2 })
    // `{Name}/{Name}.vue` here wrote `ProofCards/ProofCards.vue` beside the
    // `hero-banner/hero-banner.vue` the project actually has.
    expect(pathFor(shape, 'ProofCards')).toBe('src/modules/proof-cards/proof-cards.vue')
  })

  // `patterns/dialog/Dialog.vue`, `components/button/Button.vue`: a kebab-case
  // folder around a PascalCase file. The layout came back as `{Name}/{Name}.vue`,
  // which with `Name=Button` resolves to `Button/Button.vue`: a folder that
  // does not exist next to the ones that do, in a project that is case-sensitive
  // everywhere but on the laptop it was written on.
  it('reads a kebab-case folder around a PascalCase file as its own layout', () => {
    for (const n of ['Dialog', 'Button']) {
      file(`src/modules/${n.toLowerCase()}/${n}.vue`, '<template><div /></template>\n')
    }

    const shape = detectConventions(root).shapes.find((s) => s.dir === 'src/modules')!
    expect(shape).toMatchObject({ file: '{name}/{Name}.vue', seenIn: 2 })
    expect(pathFor(shape, 'DialogHeader')).toBe('src/modules/dialog-header/DialogHeader.vue')
  })

  it('keeps `{Name}` for a folder and a file that agree', () => {
    file('src/modules/Intro/Intro.vue', '<template><div /></template>\n')
    file('src/modules/Hero/Hero.vue', '<template><div /></template>\n')

    const shape = detectConventions(root).shapes.find((s) => s.dir === 'src/modules')!
    expect(shape.file).toBe('{Name}/{Name}.vue')
  })

  it('writes the kebab-case folder in front of an index file', () => {
    for (const n of ['hero-banner', 'pricing-table']) file(`src/modules/${n}/index.vue`, '<template><div /></template>\n')

    const shape = detectConventions(root).shapes.find((s) => s.dir === 'src/modules')!
    expect(shape.file).toBe('{name}/index.vue')
    expect(pathFor(shape, 'ProofCards')).toBe('src/modules/proof-cards/index.vue')
  })

  // Configs written before `{name}` existed carry only `{Name}`.
  it('fills in a `{Name}` template from an existing config the way it always did', () => {
    const shape = { dir: 'src/modules', file: '{Name}/{Name}.tsx', export: 'default', alsoExports: [], seenIn: 1 }
    expect(pathFor(shape, 'ProofCards')).toBe('src/modules/ProofCards/ProofCards.tsx')
  })

  it('derives the kebab-case spelling from a PascalCase name', () => {
    const shape = { dir: 'src/modules', file: '{name}/{Name}.vue', export: 'default', alsoExports: [], seenIn: 1 }
    expect(pathFor(shape, 'Dialog')).toBe('src/modules/dialog/Dialog.vue')
    expect(pathFor(shape, 'DialogHeader')).toBe('src/modules/dialog-header/DialogHeader.vue')
    expect(pathFor(shape, 'HTMLView')).toBe('src/modules/html-view/HTMLView.vue')
  })

  // A folder called `utils` with an `index.ts` in it is not a component, and
  // the kebab spelling is what lets that in.
  it('does not take a helper folder for a component', () => {
    file('src/modules/utils/index.ts', 'export const cn = () => null\n')
    file('src/modules/Intro/Intro.tsx', 'export default function Intro() { return null }\n')

    const shape = detectConventions(root).shapes.find((s) => s.dir === 'src/modules')!
    expect(shape.seenIn).toBe(1)
  })

  // `init` lets the person pick a runner-up or type a path. The shapes used to
  // be read from what detection guessed, so the config carried a shape for the
  // directory that was turned down and none for the one being written to.
  it('reads the shapes of the directories it is given, not the ones it guessed', () => {
    file('templates/layouts/Base/Base.tsx', 'export default function Base() { return null }\n')
    file('templates/partials/Header/index.tsx', 'export function Component() { return null }\n')

    const chosen = detectConventions(root, [{ kind: 'layout', dir: 'templates/partials', from: 'asked' }])
    const shape = chosen.shapes.find((s) => s.dir === 'templates/partials')!
    expect(shape).toMatchObject({ file: '{Name}/index.tsx', export: 'named:Component' })
  })

  it('resolves where a named component goes', () => {
    for (const n of ['A', 'B']) asModule(n)
    const c = detectConventions(root)
    const shape = shapeFor(c, 'components/modules')!
    expect(pathFor(shape, 'NewsletterBanner')).toBe('components/modules/NewsletterBanner/index.tsx')
  })
})

/**
 * `layoutOf` learned `{name}` for the folder and stopped there. The file's own
 * spelling is a separate question, and so is a flat directory's: a Nuxt project
 * of `hero-banner.vue` was labelled `{Name}.vue` and got `ProofCards.vue`
 * written beside it — the same bug the placeholder was added to fix.
 */
describe('both halves of a layout are spelled as the project spells them', () => {
  const sfc = (rel: string) => file(rel, '<template><div /></template>\n')
  const shapeOf = () => detectConventions(root).shapes.find((s) => s.dir === 'components/ui')!

  it.each([
    ['flat kebab-case files', ['hero-banner.vue', 'pricing-table.vue', 'nav-bar.vue'], '{name}.vue'],
    ['flat PascalCase files', ['HeroBanner.vue', 'PricingTable.vue', 'NavBar.vue'], '{Name}.vue'],
    ['kebab folder, PascalCase file', ['hero-banner/HeroBanner.vue', 'pricing-table/PricingTable.vue', 'nav-bar/NavBar.vue'], '{name}/{Name}.vue'],
    ['PascalCase folder, kebab file', ['HeroBanner/hero-banner.vue', 'PricingTable/pricing-table.vue', 'NavBar/nav-bar.vue'], '{Name}/{name}.vue'],
    ['kebab folder and file', ['hero-banner/hero-banner.vue', 'pricing-table/pricing-table.vue', 'nav-bar/nav-bar.vue'], '{name}/{name}.vue'],
    ['kebab folder with an index', ['hero-banner/index.vue', 'pricing-table/index.vue', 'nav-bar/index.vue'], '{name}/index.vue'],
  ])('%s', (_what, files, expected) => {
    for (const f of files as string[]) sfc(`components/ui/${f}`)
    expect(shapeOf().file).toBe(expected)
  })

  // Two layouts, one occurrence each. `commonest` kept the first entry of a Map
  // filled in `readdirSync` order, so the shape a project got depended on its
  // filesystem. A tie is now broken by the name.
  it('breaks a tie by name rather than by directory order', () => {
    sfc('components/ui/AlphaCard/AlphaCard.vue')
    sfc('components/ui/zebra-tag/zebra-tag.vue')
    expect(shapeOf().file).toBe('{Name}/{Name}.vue')
  })

  // `Grid2Col` is not `grid2-col`: a digit run is its own word, which is the
  // spelling lodash and the kebab helpers in the ecosystem produce.
  it.each([
    ['DialogHeader', 'dialog-header'],
    ['Grid2Col', 'grid-2-col'],
    ['NavBar', 'nav-bar'],
  ])('writes %s into a kebab folder as %s', (name, folder) => {
    const shape = { dir: 'components/ui', file: '{name}/{Name}.vue', export: 'default', alsoExports: [], seenIn: 3 }
    expect(pathFor(shape, name)).toBe(`components/ui/${folder}/${name}.vue`)
  })
})
