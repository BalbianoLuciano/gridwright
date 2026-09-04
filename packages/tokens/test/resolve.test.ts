import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTailwindConfig } from '../src/read.js'
import { resolveTokens, summarize, overBudget, toPx } from '../src/resolve.js'
import type { RawToken } from '@gridwright/core'

const here = dirname(fileURLToPath(import.meta.url))
const system = readTailwindConfig(join(here, 'fixtures', 'tailwind.config.js'), 'tailwind.config.js')
const OPTS = { colorToleranceDeltaE: 1, spacingTolerancePx: 2 }

const raw = (kind: RawToken['kind'], value: string): RawToken => ({ kind, value, usedIn: ['Frame'] })
const resolve1 = (t: RawToken) => resolveTokens([t], system.tokens, OPTS)[0]!

describe('the three buckets — Law 4', () => {
  it('an exact colour is exact', () => {
    const r = resolve1(raw('color', '#008599'))
    expect(r.bucket).toBe('exact')
    expect(r.match?.name).toBe('colors.primary.500')
  })

  /**
   * The bucket the whole exercise is for. #1a1a1b is not a new colour, it is
   * #1a1a1a picked by eye. String equality would create a second neutral-900
   * and start the rot that ends with nobody knowing which one to use.
   */
  it('a colour half a ΔE away uses the system value, and says so', () => {
    const r = resolve1(raw('color', '#1a1a1b'))
    expect(r.bucket).toBe('near')
    expect(r.match?.name).toBe('colors.neutral.900')
    expect(r.note).toMatch(/Using the system's/)
  })

  it('a genuinely different colour is new', () => {
    const r = resolve1(raw('color', '#ff5a3c'))
    expect(r.bucket).toBe('new')
    expect(r.note).toMatch(/different colour/)
  })

  // A design that says 14 against a 4/8/16 scale is a design slip, not a
  // request for a new token. Absorbing it would make the oddity permanent.
  it('an off-scale length snaps to the scale and reports the drift', () => {
    const r = resolve1(raw('spacing', '14px'))
    expect(r.bucket).toBe('near')
    expect(r.match?.name).toBe('spacing.4')
    expect(r.note).toMatch(/design slip/)
  })

  it('a length nowhere near the scale is new', () => {
    expect(resolve1(raw('spacing', '100px')).bucket).toBe('new')
  })

  it('matches a radius across units: 16px is the 1rem token', () => {
    expect(toPx('1rem')).toBe(16)
    expect(resolve1(raw('radius', '16px')).bucket).toBe('exact')
  })

  // Two pixels of line-height is a different type token, not the same one
  // drawn imprecisely — "near" has no meaning for a tuple.
  it('typography compares as written, with no near bucket', () => {
    expect(resolve1(raw('typography', 'Inter/700/48px/56px')).bucket).toBe('new')
  })

  it('never matches against a value it could not evaluate', () => {
    // colors.accent is computed; nothing should ever resolve onto it.
    const all = resolveTokens(
      [raw('color', '#ff5a3c'), raw('color', '#008599')],
      system.tokens, OPTS,
    )
    expect(all.every((r) => r.match?.name !== 'colors.accent')).toBe(true)
  })
})

describe('budget — when a design has left the system', () => {
  it('counts the buckets', () => {
    const rs = resolveTokens(
      [raw('color', '#008599'), raw('color', '#1a1a1b'), raw('color', '#ff5a3c')],
      system.tokens, OPTS,
    )
    expect(summarize(rs)).toEqual({ exact: 1, near: 1, new: 1 })
  })

  // A run wanting fifteen new tokens is not extending the system.
  it('flags a run that wants more new tokens than the budget allows', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      raw('color', `#${(i * 111111 + 200000).toString(16).padStart(6, '0')}`))
    expect(overBudget(resolveTokens(many, system.tokens, OPTS), 3)).toBe(true)
  })
})
