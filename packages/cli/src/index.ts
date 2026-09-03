#!/usr/bin/env node
/**
 * `gw` — el motor del pipeline.
 *
 * Parseo de argumentos a mano y a propósito: son cuarenta líneas, y cada
 * dependencia de un binario que maneja un token es superficie de supply chain
 * que hay que justificar.
 */

import { authLogin, authStatus, authLogout } from './commands/auth.js'
import { init } from './commands/init.js'
import { build, printNext, status, showIr } from './commands/run.js'
import { bold, dim, fail, green } from './ui.js'
import { FigmaError } from '@gridwright/figma'

const HELP = `${bold('gw')} — gridwright

  ${bold('Precondición')}
    gw auth login              guardar el token de Figma (${dim('correlo vos, no el agente')})
    gw auth status             ver qué credencial se está usando
    gw auth logout             borrar la credencial guardada

  ${bold('Proyecto')}
    gw init [--force]          configurar este repo

  ${bold('Corrida')}
    gw build <url-figma>       abrir una corrida y ejecutar hasta donde llegue
      --view                   modo vista en lugar de componente
    gw next [--json]           qué etapa toca y quién la ejecuta
    gw status [--json]         corridas y en qué etapa está cada una
    gw ir [<run-id>]           imprimir el IR de una corrida

  ${dim('Fase 1 de specs/001-pipeline.md: fetch y distill.')}
  ${dim('Las etapas de fases 2-5 se reportan como no implementadas.')}
`

interface Args {
  cmd: string
  sub?: string
  positional: string[]
  flags: Set<string>
}

function parse(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Set<string>()
  for (const a of argv) {
    if (a.startsWith('--')) flags.add(a.slice(2))
    else positional.push(a)
  }
  return { cmd: positional[0] ?? '', sub: positional[1], positional: positional.slice(1), flags }
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2))
  const root = process.cwd()

  if (!args.cmd || args.flags.has('help') || args.cmd === 'help') {
    console.log(HELP)
    return
  }

  switch (args.cmd) {
    case 'auth':
      if (args.sub === 'login') return authLogin()
      if (args.sub === 'status' || !args.sub) return authStatus(root)
      if (args.sub === 'logout') return authLogout()
      return fail(`\`gw auth ${args.sub}\` no existe.`, 'Opciones: login, status, logout')

    case 'init':
      return init(root, { force: args.flags.has('force') })

    case 'build': {
      const url = args.positional[0]
      if (!url) {
        return fail(
          'Falta la URL de Figma.',
          'gw build "https://www.figma.com/design/<KEY>/<nombre>?node-id=3978-35299"\n' +
            'En Figma: seleccioná el frame y usá "Copy link to selection".',
        )
      }
      return build(root, url, { mode: args.flags.has('view') ? 'view' : 'component' })
    }

    case 'next':
      return printNext(root, null, { json: args.flags.has('json') })

    case 'status':
      return status(root, { json: args.flags.has('json') })

    case 'ir':
      return showIr(root, args.positional[0])

    case 'version':
      console.log('0.1.0')
      return

    default:
      return fail(`\`gw ${args.cmd}\` no existe.`, `Probá ${green('gw help')}.`)
  }
}

main().catch((e: unknown) => {
  if (e instanceof FigmaError) fail(e.message, e.hint)
  fail(e instanceof Error ? e.message : String(e))
})
