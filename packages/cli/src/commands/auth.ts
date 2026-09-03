/**
 * Ley 10 — El secreto no pasa por el modelo.
 *
 * Validamos al guardar, no al usar: guardar un token inválido y descubrirlo
 * tres etapas después es la peor UX posible. Se falla en el segundo cero.
 */

import {
  resolveCredentials, saveCredentials, clearCredentials, credentialsPath, mask,
} from '@gridwright/core'
import { FigmaClient, FigmaError } from '@gridwright/figma'
import { ok, fail, info, dim, promptSecret, bold, table } from '../ui.js'

export async function authLogin(): Promise<void> {
  console.log(bold('Token de Figma'))
  console.log(dim('  figma.com/developers/api#access-tokens · scope de lectura\n'))

  const token = await promptSecret(`${dim('token:')} `)
  if (!token) fail('No ingresaste nada.')
  if (!token.startsWith('figd_')) {
    // No es fatal (Figma podría cambiar el prefijo) pero casi siempre significa
    // que se pegó otra cosa: la URL, el file key, el email.
    info(dim('El token no empieza con `figd_`. Sigo igual, pero revisá que sea el correcto.'))
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
  ok(`Token válido — ${me.email ?? me.handle ?? me.id}`)
  console.log(dim(`  Guardado en ${path} (modo 0600)`))
}

export function authStatus(cwd: string): void {
  const creds = resolveCredentials(cwd)
  if (!creds) {
    console.log('Sin credenciales.')
    console.log(dim(`  Corré \`gw auth login\` — se guarda en ${credentialsPath()}`))
    process.exitCode = 1
    return
  }
  const origen = {
    'env': 'variable de entorno FIGMA_TOKEN',
    'project-dotenv': '.env del proyecto',
    'user-config': credentialsPath(),
  }[creds.origin]

  ok('Credenciales encontradas')
  table([
    ['token', mask(creds.figmaToken)],
    ['origen', origen],
  ])
  if (creds.origin !== 'user-config') {
    console.log(dim('\n  Ojo: este origen tiene prioridad sobre el token guardado en la máquina.'))
  }
}

export function authLogout(): void {
  const removed = clearCredentials()
  if (removed) ok(`Credenciales borradas de ${credentialsPath()}`)
  else info('No había credenciales guardadas.')
}
