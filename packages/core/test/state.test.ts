import { describe, it, expect } from 'vitest'
import { newRunState, advance, directive, type RunState } from '../src/state.js'
import { STAGES, STAGE_SPECS, isImplemented, firstBlockingStage } from '../src/stages.js'

const make = (): RunState => newRunState({
  id: 'hero-about-us-01', mode: 'component',
  url: 'https://figma.com/design/X?node-id=1-2',
  fileKey: 'X', nodeId: '1:2', name: 'HeroAboutUs',
})

describe('state machine — Law 1', () => {
  it('a run starts at fetch, not at init', () => {
    // `init` belongs to the project, not to the run.
    expect(make().stage).toBe('fetch')
  })

  it('advances in the order the spec defines', () => {
    const s = make()
    advance(s, 'fetch', { status: 'done' })
    expect(s.stage).toBe('distill')
    advance(s, 'distill', { status: 'done' })
    expect(s.stage).toBe('resolve')
  })

  // This is the whole point of the law: the order is not argued for, it is
  // enforced.
  it('refuses to close a stage that is not the current one', () => {
    const s = make()
    expect(() => advance(s, 'author', { status: 'done' })).toThrow(/cannot close/)
    expect(s.stage).toBe('fetch')
  })

  it('a failed stage does not move the pointer, so it can be retried', () => {
    const s = make()
    advance(s, 'fetch', { status: 'failed', reason: 'Figma returned 404' })
    expect(s.stage).toBe('fetch')
    expect(s.stages.fetch.reason).toBe('Figma returned 404')
  })

  it('skipping demands a reason: a stage that did not run has to say why', () => {
    const s = make()
    advance(s, 'fetch', { status: 'done' })
    advance(s, 'distill', { status: 'done' })
    advance(s, 'resolve', { status: 'done' })
    expect(() => advance(s, 'tokens', { status: 'skipped' })).toThrow()
  })

  it('the mandatory ones cannot be skipped even with a reason', () => {
    const s = make()
    for (const st of ['fetch', 'distill', 'resolve'] as const) advance(s, st, { status: 'done' })
    expect(s.stage).toBe('tokens')
    expect(() => advance(s, 'tokens', { status: 'skipped', reason: 'no new tokens' }))
      .toThrow(/mandatory/)
  })

  it('the three mandatory stages are the ones that build the system', () => {
    const mandatory = STAGES.filter((s) => STAGE_SPECS[s].mandatory)
    expect(mandatory).toEqual(['tokens', 'library:ensure', 'library:register'])
  })

  it('the human gates are plan, tokens and golden', () => {
    const gates = STAGES.filter((s) => STAGE_SPECS[s].gate)
    expect(gates).toContain('plan')
    expect(gates).toContain('tokens')
    expect(gates).toContain('golden')
  })
})

describe('protocol — what Claude gets back from `gw next`', () => {
  it('states the stage, who runs it and whether there is a gate', () => {
    const d = directive(make(), '/repo')
    expect(d).toMatchObject({ run: 'hero-about-us-01', stage: 'fetch', actor: 'code' })
    expect(d.gate).toBeNull()
  })

  it('flags the gate on the stages that have one', () => {
    const s = make()
    for (const st of ['fetch', 'distill', 'resolve'] as const) advance(s, st, { status: 'done' })
    expect(directive(s, '/repo').gate).toMatch(/human approval/)
  })

  // Not pretending a stage ran is part of the contract.
  it('says explicitly when the stage is not built yet', () => {
    const s = make()
    for (const st of ['fetch', 'distill'] as const) advance(s, st, { status: 'done' })
    const d = directive(s, '/repo')
    expect(d.blocked?.phase).toBe(4)
  })

  it('knows which stages are built and which are not', () => {
    for (const s of ['fetch', 'distill', 'verify', 'author', 'refine'] as const) {
      expect(isImplemented(s)).toBe(true)
    }
    for (const s of ['resolve', 'tokens', 'library:ensure', 'survey'] as const) {
      expect(isImplemented(s)).toBe(false)
    }
  })

  /**
   * Built is not the same as reachable, and the difference is the whole reason
   * `gw verify` and `gw refine` also work standalone.
   *
   * `author` and `verify` are done, but a run cannot get to either: `resolve`
   * comes first and belongs to phase 4, and the two stages behind it are
   * mandatory so they cannot be skipped past. Phase 4 is what opens the
   * pipeline end to end.
   */
  it('a run still stops at resolve, three stages before author', () => {
    expect(firstBlockingStage()).toBe('resolve')

    const s = make()
    advance(s, 'fetch', { status: 'done' })
    advance(s, 'distill', { status: 'done' })
    expect(directive(s, '/repo').blocked).toBeTruthy()
    expect(STAGES.indexOf('resolve')).toBeLessThan(STAGES.indexOf('author'))
  })
})
