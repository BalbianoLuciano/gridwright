import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { folderComponent, componentName } from '../src/files.js'
import { pathFor } from '../src/conventions.js'

const fresh = () => mkdtempSync(join(tmpdir(), 'gw-files-'))

describe('the file that represents a component folder', () => {
  // A Vue project keeps `button/Button.vue`: kebab folder, PascalCase file.
  // The lookup asked `existsSync('button/button.vue')`, which APFS answers yes
  // to by accident and returns the lowercase path; on Linux it found nothing.
  // The same project then read differently on two machines. The name that comes
  // back must be the one on disk, whatever the filesystem thinks of case.
  // `pathFor` writes `dialog-header/DialogHeader.vue` for a multi-word name, so
  // reading the project back has to recognise that exact layout: the hyphens
  // are part of the folder's spelling, not of the component's.
  it('finds a PascalCase file inside a multi-word kebab-case folder', () => {
    const parent = fresh()
    mkdirSync(join(parent, 'dialog-header'))
    writeFileSync(join(parent, 'dialog-header/DialogHeader.vue'), '<template><div /></template>')

    expect(folderComponent(parent, 'dialog-header')).toBe(join(parent, 'dialog-header', 'DialogHeader.vue'))
  })

  it('returns the real name when the folder and the file differ only in case', () => {
    const parent = fresh()
    mkdirSync(join(parent, 'button'))
    writeFileSync(join(parent, 'button/Button.vue'), '<template><button /></template>')

    expect(folderComponent(parent, 'button')).toBe(join(parent, 'button', 'Button.vue'))
  })

  it('still finds an index file and a file spelled exactly like its folder', () => {
    const parent = fresh()
    mkdirSync(join(parent, 'Intro'))
    writeFileSync(join(parent, 'Intro/index.tsx'), 'export default function Intro() {}')
    mkdirSync(join(parent, 'hero-banner'))
    writeFileSync(join(parent, 'hero-banner/hero-banner.vue'), '<template><div /></template>')

    expect(folderComponent(parent, 'Intro')).toBe(join(parent, 'Intro', 'index.tsx'))
    expect(folderComponent(parent, 'hero-banner')).toBe(join(parent, 'hero-banner', 'hero-banner.vue'))
  })
})

describe('reading the real file name of a component folder', () => {
  // `loose` ignores case *and* hyphens, and `present.find` took whatever
  // `readdirSync` handed it first. A folder holding both spellings therefore
  // still read differently on APFS and ext4 — the determinism this was meant
  // to close. Hyphens stand in for case here because APFS cannot hold
  // `Button.vue` and `button.vue` at once.
  it('prefers the exact name over a loose match', () => {
    const parent = fresh()
    const dir = join(parent, 'hero-banner')
    mkdirSync(dir)
    writeFileSync(join(dir, 'herobanner.vue'), '')
    writeFileSync(join(dir, 'hero-banner.vue'), '')
    expect(folderComponent(parent, 'hero-banner')).toBe(join(dir, 'hero-banner.vue'))
  })

  // `.ts` is allowed under a PascalCase folder, and the loose compare made
  // `Types/types.ts` match `Types/Types.ts` on every filesystem, not only the
  // case-insensitive ones. The docstring here says this is what it prevents.
  it.each(['Types', 'Utils', 'Helpers', 'Constants'])('%s is not a component folder', (folder) => {
    const parent = fresh()
    mkdirSync(join(parent, folder))
    writeFileSync(join(parent, folder, `${folder.toLowerCase()}.ts`), 'export const x = 1\n')
    expect(folderComponent(parent, folder)).toBeNull()
  })
})

/**
 * The invariant the `{name}` placeholder broke. `pathFor` writes the file and
 * `componentName` reads the name back off it — `survey` to index the component,
 * `library:register` to name the registry entry. A kebab folder produced a path
 * whose name came back null, so the component vanished from the index and the
 * entry fell back to the Figma frame name that `library.ts` says never to use.
 */
describe('a name survives being written to a path and read back', () => {
  const layouts = [
    '{Name}.vue', '{name}.vue',
    '{Name}/{Name}.vue', '{name}/{Name}.vue', '{name}/{name}.vue',
    '{Name}/index.vue', '{name}/index.vue',
  ]
  it.each(layouts)('%s', (file) => {
    const shape = { dir: 'src/components/ui', file, export: 'default', alsoExports: [], seenIn: 3 }
    for (const name of ['Button', 'DialogHeader', 'Grid2Col']) {
      expect(componentName(pathFor(shape, name))).toBe(name)
    }
  })

  // A `.ts` in a kebab folder is the barrel, not the component: `button/index.ts`
  // is what shadcn-vue writes beside `Button.vue`. Only a single-file component
  // gets the kebab spelling, which is the rule `isComponentFile` already applies.
  it('does not name a kebab-case .ts', () => {
    expect(componentName('src/components/ui/button/index.ts')).toBeNull()
  })
})
