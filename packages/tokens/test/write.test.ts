import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTailwindConfig } from '../src/read.js'
import { writeTokens, previewTokens } from '../src/write.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'tailwind.config.js')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-tok-'))
  copyFileSync(FIXTURE, join(dir, 'tailwind.config.js'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const system = () => readTailwindConfig(join(dir, 'tailwind.config.js'), 'tailwind.config.js')
const read = () => readFileSync(join(dir, 'tailwind.config.js'), 'utf8')

/**
 * Through an AST, never a regex. This edits a file the whole team shares and
 * the build depends on; a regex that works on the config in front of you and
 * not on the one with a trailing comment breaks everyone's build, and the diff
 * will not say why.
 */
describe('writing tokens into a real config', () => {
  it('adds a colour under theme.extend', () => {
    writeTokens(dir, system(), [{ name: 'brand.500', value: '#ff5a3c', section: 'colors' }])
    const after = readTailwindConfig(join(dir, 'tailwind.config.js'), 'x')
    expect(after.tokens.find((t) => t.name === 'colors.brand.500')?.value).toBe('#ff5a3c')
  })

  // Writing to theme.colors directly replaces Tailwind's whole palette, and a
  // component three files away loses gray-500 with no hint why.
  it('writes under extend, never over the base scale', () => {
    writeTokens(dir, system(), [{ name: 'brand.500', value: '#ff5a3c', section: 'colors' }])
    const src = read()
    const extendAt = src.indexOf('extend')
    expect(extendAt).toBeGreaterThan(-1)
    expect(src.indexOf('brand')).toBeGreaterThan(extendAt)
  })

  it('leaves the imports, the plugins and the helper alone', () => {
    writeTokens(dir, system(), [{ name: 'brand.500', value: '#ff5a3c', section: 'colors' }])
    const src = read()
    expect(src).toContain("import typography from '@tailwindcss/typography'")
    expect(src).toContain('const withOpacity')
    expect(src).toContain('plugins:')
  })

  it('keeps every token that was already there', () => {
    const before = system().tokens.length
    writeTokens(dir, system(), [{ name: 'brand.500', value: '#ff5a3c', section: 'colors' }])
    expect(readTailwindConfig(join(dir, 'tailwind.config.js'), 'x').tokens.length).toBe(before + 1)
  })

  it('creates a section that does not exist yet', () => {
    writeTokens(dir, system(), [{ name: 'card', value: '0 2px 8px rgba(0,0,0,0.1)', section: 'boxShadow' }])
    expect(read()).toContain('boxShadow')
  })

  it('the config still parses afterwards', () => {
    writeTokens(dir, system(), [
      { name: 'brand.500', value: '#ff5a3c', section: 'colors' },
      { name: '18', value: '72px', section: 'spacing' },
    ])
    // Reading it back through the AST is the check: a broken file yields nothing.
    const after = readTailwindConfig(join(dir, 'tailwind.config.js'), 'x')
    expect(after.tokens.find((t) => t.name === 'spacing.18')?.value).toBe('72px')
    expect(after.tokens.find((t) => t.name === 'colors.primary.900')?.value).toBe('#003841')
  })

  // The gate has to show what will change before anyone approves it.
  it('previews without touching the file', () => {
    const before = read()
    const diff = previewTokens(dir, system(), [{ name: 'brand.500', value: '#ff5a3c', section: 'colors' }])
    expect(read()).toBe(before)
    expect(diff).toContain('#ff5a3c')
    expect(diff).toContain('+++ tailwind.config.js')
  })

  it('writing nothing changes nothing', () => {
    const before = read()
    const result = writeTokens(dir, system(), [])
    expect(read()).toBe(before)
    expect(result.written).toHaveLength(0)
  })
})
