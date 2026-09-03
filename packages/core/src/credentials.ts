/**
 * Law 10 — The secret does not pass through the model.
 *
 * The pipeline runs inside a Claude Code session. If the Figma token shows up
 * in a message it ends up in the transcript, in the context, in the logs and
 * eventually in persistent memory. A secret that went through the LLM has to be
 * treated as compromised.
 *
 * Everything in this module follows from that:
 *  - it is read from hidden stdin, never from an argument (arguments land in
 *    the shell history and in the process list)
 *  - it lives once per machine, not once per project, because `gw` is a global
 *    binary and pasting it N times multiplies the odds of committing it by N
 *  - it is masked in any output
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, rmSync } from 'node:fs'

export interface Credentials {
  figmaToken: string
  /** Where it came from. Reported so there are no surprises about which token
   *  is in use when several sources are possible. */
  origin: 'env' | 'project-dotenv' | 'user-config'
}

export function configDir(): string {
  // XDG when defined; otherwise the platform default.
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, 'gridwright') : join(homedir(), '.config', 'gridwright')
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials.json')
}

/** Masks for logs and error messages. Never print a whole token. */
export function mask(token: string): string {
  if (token.length <= 10) return '****'
  return `${token.slice(0, 5)}…${token.slice(-4)}`
}

/** Reads FIGMA_TOKEN from the project's .env without pulling in dotenv and
 *  without polluting process.env — which is what would leak into every child
 *  process we spawn. */
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
    // An unreadable .env is not fatal: fall through to the next source.
  }
  return null
}

/**
 * Resolution order, first match wins. The normal case is the last one: the
 * token lives once per machine.
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
      // Corrupt credentials are treated as absent: better to ask again than to
      // die with a cryptic JSON.parse three stages down the line.
    }
  }
  return null
}

export function saveCredentials(token: string): string {
  const dir = configDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = credentialsPath()
  writeFileSync(path, JSON.stringify({ figmaToken: token }, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync only applies the mode when it creates the file; if it already
  // existed with loose permissions we have to force it.
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

/** Minimum scopes. Gridwright only reads: if the token carries write
 *  permissions they are unnecessary and worth flagging. */
export const REQUIRED_SCOPES = ['file_content:read', 'file_dev_resources:read'] as const
