import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCredentials, saveCredentials, credentialsPath, mask } from '../src/credentials.js'

let dir: string
let prevXdg: string | undefined
let prevToken: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-'))
  prevXdg = process.env.XDG_CONFIG_HOME
  prevToken = process.env.FIGMA_TOKEN
  process.env.XDG_CONFIG_HOME = join(dir, 'config')
  delete process.env.FIGMA_TOKEN
})

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = prevXdg
  if (prevToken === undefined) delete process.env.FIGMA_TOKEN
  else process.env.FIGMA_TOKEN = prevToken
  rmSync(dir, { recursive: true, force: true })
})

describe('credentials — Law 10', () => {
  it('returns null when nothing is configured, not an empty string', () => {
    expect(resolveCredentials(dir)).toBeNull()
  })

  it('the environment variable wins over everything', () => {
    saveCredentials('figd_fromfile')
    writeFileSync(join(dir, '.env'), 'FIGMA_TOKEN="figd_fromdotenv"\n')
    process.env.FIGMA_TOKEN = 'figd_fromenv'
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_fromenv', origin: 'env' })
  })

  it("the project's .env wins over the machine config", () => {
    saveCredentials('figd_fromfile')
    writeFileSync(join(dir, '.env'), "FIGMA_TOKEN='figd_fromdotenv'\n")
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_fromdotenv', origin: 'project-dotenv' })
  })

  it('the normal case: it lives once per machine', () => {
    saveCredentials('figd_fromfile')
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_fromfile', origin: 'user-config' })
  })

  it('reads the .env without polluting process.env', () => {
    writeFileSync(join(dir, '.env'), 'FIGMA_TOKEN=figd_x\n')
    resolveCredentials(dir)
    // Putting it in the environment would leak it into every child process we
    // spawn.
    expect(process.env.FIGMA_TOKEN).toBeUndefined()
  })

  it('saves with 0600 permissions', () => {
    saveCredentials('figd_secret')
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })

  it('corrupt credentials are treated as absent', () => {
    saveCredentials('figd_x')
    writeFileSync(credentialsPath(), 'not json')
    // Better to ask again than to die with a cryptic JSON.parse three stages
    // down the line.
    expect(resolveCredentials(dir)).toBeNull()
  })

  it('masking does not let the token be recovered', () => {
    const token = 'figd_abcdefghijklmnopqrstuvwxyz'
    const masked = mask(token)
    expect(masked).not.toContain('abcdefghij')
    expect(masked).toBe('figd_…wxyz')
    expect(mask('short')).toBe('****')
  })
})
