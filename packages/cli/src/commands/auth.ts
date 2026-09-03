/**
 * Law 10 — The secret does not pass through the model.
 *
 * We validate on save, not on use: saving an invalid token and finding out
 * three stages later is the worst possible UX. Fail at second zero.
 */

import {
  resolveCredentials, saveCredentials, clearCredentials, credentialsPath, mask,
} from '@gridwright/core'
import { FigmaClient, FigmaError } from '@gridwright/figma'
import { ok, fail, info, dim, promptSecret, bold, table } from '../ui.js'

export async function authLogin(): Promise<void> {
  console.log(bold('Figma token'))
  console.log(dim('  figma.com/developers/api#access-tokens · read scope\n'))

  const token = await promptSecret(`${dim('token:')} `)
  if (!token) fail('Nothing entered.')
  if (!token.startsWith('figd_')) {
    // Not fatal (Figma could change the prefix) but it almost always means
    // something else got pasted: the URL, the file key, an email address.
    info(dim('The token does not start with `figd_`. Continuing, but double-check it is the right one.'))
  }

  const client = new FigmaClient({ token })
  let me
  try {
    me = await client.me()
  } catch (e) {
    if (e instanceof FigmaError) fail(e.message, e.hint)
    throw e
  }

  const path = saveCredentials(token)
  ok(`Token valid — ${me.email ?? me.handle ?? me.id}`)
  console.log(dim(`  Saved to ${path} (mode 0600)`))
}

export function authStatus(cwd: string): void {
  const creds = resolveCredentials(cwd)
  if (!creds) {
    console.log('No credentials.')
    console.log(dim(`  Run \`gw auth login\` — it is saved to ${credentialsPath()}`))
    process.exitCode = 1
    return
  }
  const origin = {
    'env': 'FIGMA_TOKEN environment variable',
    'project-dotenv': "the project's .env",
    'user-config': credentialsPath(),
  }[creds.origin]

  ok('Credentials found')
  table([
    ['token', mask(creds.figmaToken)],
    ['origin', origin],
  ])
  if (creds.origin !== 'user-config') {
    console.log(dim('\n  Note: this source takes precedence over the token saved on this machine.'))
  }
}

export function authLogout(): void {
  const removed = clearCredentials()
  if (removed) ok(`Credentials removed from ${credentialsPath()}`)
  else info('There were no saved credentials.')
}
