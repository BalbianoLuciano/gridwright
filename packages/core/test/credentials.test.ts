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

describe('credenciales — Ley 10', () => {
  it('sin nada configurado devuelve null, no un string vacío', () => {
    expect(resolveCredentials(dir)).toBeNull()
  })

  it('la variable de entorno gana sobre todo', () => {
    saveCredentials('figd_delarchivo')
    writeFileSync(join(dir, '.env'), 'FIGMA_TOKEN="figd_deldotenv"\n')
    process.env.FIGMA_TOKEN = 'figd_delentorno'
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_delentorno', origin: 'env' })
  })

  it('el .env del proyecto gana sobre el config de la máquina', () => {
    saveCredentials('figd_delarchivo')
    writeFileSync(join(dir, '.env'), "FIGMA_TOKEN='figd_deldotenv'\n")
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_deldotenv', origin: 'project-dotenv' })
  })

  it('el caso normal: vive una vez en la máquina', () => {
    saveCredentials('figd_delarchivo')
    expect(resolveCredentials(dir)).toEqual({ figmaToken: 'figd_delarchivo', origin: 'user-config' })
  })

  it('lee el .env sin contaminar process.env', () => {
    writeFileSync(join(dir, '.env'), 'FIGMA_TOKEN=figd_x\n')
    resolveCredentials(dir)
    // Si lo metiéramos en el entorno se filtraría a todo subproceso que lancemos.
    expect(process.env.FIGMA_TOKEN).toBeUndefined()
  })

  it('guarda con permisos 0600', () => {
    saveCredentials('figd_secreto')
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })

  it('unas credenciales corruptas se tratan como ausentes', () => {
    saveCredentials('figd_x')
    writeFileSync(credentialsPath(), 'no soy json')
    // Mejor pedirlas de nuevo que morir con un JSON.parse críptico tres etapas
    // más adelante.
    expect(resolveCredentials(dir)).toBeNull()
  })

  it('el enmascarado no deja recuperar el token', () => {
    const token = 'figd_abcdefghijklmnopqrstuvwxyz'
    const masked = mask(token)
    expect(masked).not.toContain('abcdefghij')
    expect(masked).toBe('figd_…wxyz')
    expect(mask('corto')).toBe('****')
  })
})
