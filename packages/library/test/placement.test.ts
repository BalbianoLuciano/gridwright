import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectPlacements } from '../src/placement.js'

const fresh = () => mkdtempSync(join(tmpdir(), 'gw-place-'))

describe('where things go when the project has nowhere for them yet', () => {
  // An empty Vite project: everything it compiles is under src/.
  it('proposes directories under src/ when the project keeps its source there', () => {
    const root = fresh()
    mkdirSync(join(root, 'src'))
    const byKind = Object.fromEntries(detectPlacements(root).map((p) => [p.kind, p]))
    expect(byKind.module).toMatchObject({ dir: 'src/components/modules', from: 'absent' })
    expect(byKind.view!.dir).toBe('src/views')
  })

  it('proposes them at the root when there is no src/', () => {
    const root = fresh()
    expect(detectPlacements(root).find((p) => p.kind === 'module')!.dir).toBe('components/modules')
  })
})

describe('finding the directories a project already has', () => {
  // `src/modules/Intro/Intro.tsx`: a folder per module, the file named after
  // it. Only `<Name>/index.*` counted, so the directory looked empty and a
  // second modules directory was proposed beside the real one.
  it('counts a kebab-case folder whose component is named after it', () => {
    const root = fresh()
    mkdirSync(join(root, 'src/modules/hero-banner'), { recursive: true })
    writeFileSync(join(root, 'src/modules/hero-banner/hero-banner.vue'), '<template><div /></template>')

    const module = detectPlacements(root).find((p) => p.kind === 'module')!
    expect(module).toMatchObject({ dir: 'src/modules', from: 'found' })
  })

  it('counts a folder whose component is named after it', () => {
    const root = fresh()
    mkdirSync(join(root, 'src/modules/Intro'), { recursive: true })
    writeFileSync(join(root, 'src/modules/Intro/Intro.tsx'), 'export default function Intro() {}')

    const module = detectPlacements(root).find((p) => p.kind === 'module')!
    expect(module).toMatchObject({ dir: 'src/modules', from: 'found' })
  })
})
