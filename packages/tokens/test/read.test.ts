import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTailwindConfig } from '../src/read.js'

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG = join(here, 'fixtures', 'tailwind.config.js')

/**
 * Parsed from source rather than imported. A real config pulls in plugins, and
 * importing it from gridwright resolves those against the wrong node_modules —
 * it would throw before reading a single token.
 */
describe('reading an existing token system', () => {
  const system = readTailwindConfig(CONFIG, 'tailwind.config.js')
  const byName = (n: string) => system.tokens.find((t) => t.name === n)

  it('reads nested colours by their dotted path', () => {
    expect(byName('colors.primary.500')?.value).toBe('#008599')
    expect(byName('colors.neutral.900')?.value).toBe('#1a1a1a')
  })

  it('classifies each token by the section it lives in', () => {
    expect(byName('colors.primary.500')?.kind).toBe('color')
    expect(byName('spacing.8')?.kind).toBe('spacing')
    expect(byName('borderRadius.card')?.kind).toBe('radius')
  })

  // The honest outcome for a value we cannot evaluate: recorded as existing,
  // marked as not comparable, never silently ignored.
  it('records a computed value as existing but not comparable', () => {
    const accent = byName('colors.accent')
    expect(accent).toBeTruthy()
    expect(accent!.comparable).toBe(false)
  })

  it('takes the size out of a fontSize tuple', () => {
    expect(byName('fontSize.display')?.value).toBe('48px')
  })

  it('reports the sections, so new tokens land where their kind already lives', () => {
    expect(system.sections).toEqual(expect.arrayContaining(['colors', 'spacing', 'borderRadius']))
  })

  it('does not mistake `content` for a token section', () => {
    expect(system.tokens.some((t) => t.name.startsWith('content'))).toBe(false)
  })
})
