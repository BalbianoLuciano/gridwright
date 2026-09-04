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

  it('resolves where a named component goes', () => {
    for (const n of ['A', 'B']) asModule(n)
    const c = detectConventions(root)
    const shape = shapeFor(c, 'components/modules')!
    expect(pathFor(shape, 'NewsletterBanner')).toBe('components/modules/NewsletterBanner/index.tsx')
  })
})
