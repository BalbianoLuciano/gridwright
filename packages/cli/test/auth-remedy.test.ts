import { describe, it, expect } from 'vitest'
import { authRemedy } from '../src/commands/run.js'

/**
 * Found by pointing gridwright at a real project: prolicht had an expired
 * FIGMA_TOKEN committed in its .env, and the error told the user to run
 * `gw auth login` — which saves to the machine config, which that same .env
 * outranks. Following the advice would have left them exactly where they
 * started.
 */
describe('auth remedy depends on where the token came from', () => {
  it('a stale project .env says to fix THAT file, not to log in again', () => {
    const hint = authRemedy('project-dotenv', '/repo')
    expect(hint).toContain('/repo/.env')
    expect(hint).toMatch(/will NOT fix it/)
  })

  it('an environment variable says to unset it, since nothing outranks it', () => {
    expect(authRemedy('env', '/repo')).toMatch(/environment variable/)
  })

  // Only in this case is `gw auth login` the actual fix — and it is the person
  // who runs it, never the agent (Law 10.a).
  it('the machine credential is the only case where logging in again helps', () => {
    expect(authRemedy('user-config', '/repo')).toContain('! gw auth login')
  })

  it('never tells you to log in when a higher-precedence source is the problem', () => {
    for (const origin of ['project-dotenv', 'env'] as const) {
      expect(authRemedy(origin, '/repo')).not.toMatch(/^Run `! gw auth login`/)
    }
  })
})
