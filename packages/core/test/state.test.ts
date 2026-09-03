import { describe, it, expect } from 'vitest'
import { newRunState, advance, directive, type RunState } from '../src/state.js'
import { STAGES, STAGE_SPECS, isImplemented } from '../src/stages.js'

const make = (): RunState => newRunState({
  id: 'hero-about-us-01', mode: 'component',
  url: 'https://figma.com/design/X?node-id=1-2',
  fileKey: 'X', nodeId: '1:2', name: 'HeroAboutUs',
})

describe('máquina de estados — Ley 1', () => {
  it('una corrida arranca en fetch, no en init', () => {
    // `init` es del proyecto, no de la corrida.
    expect(make().stage).toBe('fetch')
  })

  it('avanza en el orden de la spec', () => {
    const s = make()
    advance(s, 'fetch', { status: 'done' })
    expect(s.stage).toBe('distill')
    advance(s, 'distill', { status: 'done' })
    expect(s.stage).toBe('resolve')
  })

  // Es el punto entero de la ley: el orden no se persuade, se impone.
  it('no deja cerrar una etapa que no es la actual', () => {
    const s = make()
    expect(() => advance(s, 'author', { status: 'done' })).toThrow(/no se puede cerrar/)
    expect(s.stage).toBe('fetch')
  })

  it('una etapa fallida no mueve el puntero, para poder reintentar', () => {
    const s = make()
    advance(s, 'fetch', { status: 'failed', reason: 'Figma devolvió 404' })
    expect(s.stage).toBe('fetch')
    expect(s.stages.fetch.reason).toBe('Figma devolvió 404')
  })

  it('saltear exige un motivo: una etapa que no corrió tiene que decir por qué', () => {
    const s = make()
    advance(s, 'fetch', { status: 'done' })
    advance(s, 'distill', { status: 'done' })
    advance(s, 'resolve', { status: 'done' })
    expect(() => advance(s, 'tokens', { status: 'skipped' })).toThrow()
  })

  it('las obligatorias no se saltean ni con motivo', () => {
    const s = make()
    for (const st of ['fetch', 'distill', 'resolve'] as const) advance(s, st, { status: 'done' })
    expect(s.stage).toBe('tokens')
    expect(() => advance(s, 'tokens', { status: 'skipped', reason: 'no hay tokens nuevos' }))
      .toThrow(/obligatoria/)
  })

  it('las tres obligatorias son las que construyen el sistema', () => {
    const mandatory = STAGES.filter((s) => STAGE_SPECS[s].mandatory)
    expect(mandatory).toEqual(['tokens', 'library:ensure', 'library:register'])
  })

  it('los gates humanos son plan, tokens, golden — más init y library:ensure', () => {
    const gates = STAGES.filter((s) => STAGE_SPECS[s].gate)
    expect(gates).toContain('plan')
    expect(gates).toContain('tokens')
    expect(gates).toContain('golden')
  })
})

describe('protocolo — lo que Claude recibe de `gw next`', () => {
  it('dice etapa, quién la ejecuta y si hay gate', () => {
    const d = directive(make(), '/repo')
    expect(d).toMatchObject({ run: 'hero-about-us-01', stage: 'fetch', actor: 'code' })
    expect(d.gate).toBeNull()
  })

  it('marca gate en las etapas que lo tienen', () => {
    const s = make()
    for (const st of ['fetch', 'distill', 'resolve'] as const) advance(s, st, { status: 'done' })
    expect(directive(s, '/repo').gate).toMatch(/aprobación humana/)
  })

  // No fingir que una etapa corrió es parte del contrato.
  it('avisa explícitamente cuando la etapa todavía no está construida', () => {
    const s = make()
    for (const st of ['fetch', 'distill'] as const) advance(s, st, { status: 'done' })
    const d = directive(s, '/repo')
    expect(d.blocked?.phase).toBe(4)
  })

  it('fetch y distill sí están construidas en la fase 1', () => {
    expect(isImplemented('fetch')).toBe(true)
    expect(isImplemented('distill')).toBe(true)
    expect(isImplemented('author')).toBe(false)
  })
})
