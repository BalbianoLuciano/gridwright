/**
 * Ley 10 — El secreto no pasa por el modelo.
 *
 * El pipeline corre dentro de una sesión de Claude Code. Si el token de Figma
 * aparece en un mensaje, queda en el transcript, en el contexto, en los logs y
 * eventualmente en la memoria persistente. Un secreto que atravesó el LLM hay
 * que considerarlo comprometido.
 *
 * De ahí sale todo lo de este módulo:
 *  - se lee de stdin oculto, nunca de un argumento (queda en el historial del
 *    shell y en la lista de procesos)
 *  - vive una vez en la máquina, no una vez por proyecto, porque `gw` es un
 *    binario global y pegarlo N veces multiplica por N las chances de
 *    commitearlo
 *  - se enmascara en cualquier salida
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, rmSync } from 'node:fs'

export interface Credentials {
  figmaToken: string
  /** De dónde salió. Se reporta para que no haya sorpresas sobre qué token se
   *  está usando cuando hay varios orígenes posibles. */
  origin: 'env' | 'project-dotenv' | 'user-config'
}

export function configDir(): string {
  // XDG si está definido; si no, el default de la plataforma.
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, 'gridwright') : join(homedir(), '.config', 'gridwright')
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials.json')
}

/** Enmascara para logs y mensajes de error. Nunca imprimir un token entero. */
export function mask(token: string): string {
  if (token.length <= 10) return '****'
  return `${token.slice(0, 5)}…${token.slice(-4)}`
}

/** Lee FIGMA_TOKEN del .env del proyecto sin arrastrar dotenv como dependencia
 *  ni contaminar process.env (que es lo que después se filtra a los subprocesos). */
function readProjectDotenv(cwd: string): string | null {
  const path = join(cwd, '.env')
  if (!existsSync(path)) return null
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*FIGMA_TOKEN\s*=\s*(.*)\s*$/)
      if (!m) continue
      const raw = (m[1] ?? '').trim()
      const value = raw.replace(/^["']|["']$/g, '')
      if (value) return value
    }
  } catch {
    // un .env ilegible no es fatal: seguimos con el siguiente origen
  }
  return null
}

/**
 * Orden de resolución, primero que gane. El caso normal es el último:
 * el token vive una vez en la máquina.
 */
export function resolveCredentials(cwd: string = process.cwd()): Credentials | null {
  const fromEnv = process.env.FIGMA_TOKEN?.trim()
  if (fromEnv) return { figmaToken: fromEnv, origin: 'env' }

  const fromDotenv = readProjectDotenv(cwd)
  if (fromDotenv) return { figmaToken: fromDotenv, origin: 'project-dotenv' }

  const path = credentialsPath()
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { figmaToken?: string }
      if (parsed.figmaToken) return { figmaToken: parsed.figmaToken, origin: 'user-config' }
    } catch {
      // credenciales corruptas se tratan como ausentes: mejor pedirlas de nuevo
      // que fallar con un JSON.parse críptico tres etapas más adelante
    }
  }
  return null
}

export function saveCredentials(token: string): string {
  const dir = configDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = credentialsPath()
  writeFileSync(path, JSON.stringify({ figmaToken: token }, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync sólo aplica el modo si crea el archivo; si ya existía con
  // permisos laxos hay que forzarlo.
  chmodSync(path, 0o600)
  chmodSync(dirname(path), 0o700)
  return path
}

export function clearCredentials(): boolean {
  const path = credentialsPath()
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** Scopes mínimos. Gridwright sólo lee: si el token trae permisos de escritura,
 *  sobran y conviene avisarlo. */
export const REQUIRED_SCOPES = ['file_content:read', 'file_dev_resources:read'] as const
