import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, validateConfig } from '../src/config.js'

describe('config — Law 9', () => {
  it('the defaults are valid', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  // If the weights do not add up to 1, the score means nothing.
  it('rejects weights that do not add up to 1', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, weights: { structural: 0.5, chromatic: 0.5, perceptual: 0.5 } } }
    expect(validateConfig(c)[0]).toMatch(/add up to 1/)
  })

  it('structural carries half: it is the only dimension without rendering noise', () => {
    expect(DEFAULT_CONFIG.verify.weights.structural).toBe(0.5)
  })

  it('the default threshold is 90', () => {
    expect(DEFAULT_CONFIG.verify.threshold).toBe(90)
  })

  it('rejects an out-of-range threshold', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, threshold: 150 } }
    expect(validateConfig(c).some((e) => /outside 0-100/.test(e))).toBe(true)
  })

  it('the refine cap cannot be zero: that would be a loop that never fixes anything', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, maxRefineIterations: 0 } }
    expect(validateConfig(c).some((e) => /maxRefineIterations/.test(e))).toBe(true)
  })
})
