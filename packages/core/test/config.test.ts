import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, validateConfig } from '../src/config.js'

describe('config — Ley 9', () => {
  it('los defaults son válidos', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  // Si los pesos no suman 1, el score no significa nada.
  it('rechaza pesos que no suman 1', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, weights: { structural: 0.5, chromatic: 0.5, perceptual: 0.5 } } }
    expect(validateConfig(c)[0]).toMatch(/tiene que sumar 1/)
  })

  it('la estructural pesa la mitad: es la única sin ruido de rendering', () => {
    expect(DEFAULT_CONFIG.verify.weights.structural).toBe(0.5)
  })

  it('el umbral por defecto es 90', () => {
    expect(DEFAULT_CONFIG.verify.threshold).toBe(90)
  })

  it('rechaza un umbral fuera de rango', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, threshold: 150 } }
    expect(validateConfig(c).some((e) => /fuera de 0-100/.test(e))).toBe(true)
  })

  it('el tope de refine no puede ser cero: sería un loop que nunca corrige', () => {
    const c = { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify, maxRefineIterations: 0 } }
    expect(validateConfig(c).some((e) => /maxRefineIterations/.test(e))).toBe(true)
  })
})
