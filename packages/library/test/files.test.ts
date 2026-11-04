import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { folderComponent } from '../src/files.js'

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
