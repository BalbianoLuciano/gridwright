#!/usr/bin/env node
/**
 * `gw` — the pipeline engine.
 *
 * Argument parsing is hand-rolled on purpose: it is forty lines, and every
 * dependency in a binary that handles a token is supply-chain surface that has
 * to be justified.
 */

import { authLogin, authStatus, authLogout } from './commands/auth.js'
import { init } from './commands/init.js'
import { build, printNext, status, showIr } from './commands/run.js'
import { bold, dim, fail, green } from './ui.js'
import { FigmaError } from '@gridwright/figma'

const HELP = `${bold('gw')} — gridwright

  ${bold('Precondition')}
    gw auth login              save the Figma token (${dim('you run this, not the agent')})
    gw auth status             show which credential is in use
    gw auth logout             remove the saved credential

  ${bold('Project')}
    gw init [--force]          configure this repo

  ${bold('Run')}
    gw build <figma-url>       open a run and execute as far as it goes
      --view                   view mode instead of component mode
    gw next [--json]           which stage is up and who runs it
    gw status [--json]         runs and the stage each one is on
    gw ir [<run-id>]           print a run's IR

  ${dim('Phase 1 of specs/001-pipeline.md: fetch and distill.')}
  ${dim('Stages from phases 2-5 are reported as not implemented.')}
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
      return fail(`\`gw auth ${args.sub}\` does not exist.`, 'Options: login, status, logout')

    case 'init':
      return init(root, { force: args.flags.has('force') })

    case 'build': {
      const url = args.positional[0]
      if (!url) {
        return fail(
          'Missing the Figma URL.',
          'gw build "https://www.figma.com/design/<KEY>/<name>?node-id=3978-35299"\n' +
            'In Figma: select the frame and use "Copy link to selection".',
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
      return fail(`\`gw ${args.cmd}\` does not exist.`, `Try ${green('gw help')}.`)
  }
}

main().catch((e: unknown) => {
  if (e instanceof FigmaError) fail(e.message, e.hint)
  fail(e instanceof Error ? e.message : String(e))
})
