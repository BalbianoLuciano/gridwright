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
import { runVerify } from './commands/verify.js'
import { done, skip, markFailed } from './commands/advance.js'
import { refine } from './commands/refine.js'
import { runResolve, runTokens } from './commands/tokens.js'
import { runEnsure, runRegister } from './commands/library.js'
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

  ${bold('Design system')}
    gw resolve                 sort design values into exact / near / new
    gw tokens [--approve]      write the new ones — ${dim('human gate')}
      --names <json|path>      names for them, in the project's convention
    gw library ensure [--approve]
    gw library register --component <path>

  ${bold('Verification')}
    gw verify --component <path> --figma "<url>"
                               render it and score against the design
      --run <id>               use a design already fetched instead of --figma
      --props <json|path>      props for the render
      --json                   machine-readable score
    gw refine [--focus <dim>]  what to fix next, one dimension at a time

  ${bold('Closing a stage')}
    gw done [<stage>]          mark it finished and move on
      --approve                required on a human gate
      --output <json|path>     hand data to the next stage
    gw skip <stage> --reason   skip it, on the record
    gw fail <stage> --reason   mark it failed; the run stays put

  ${dim('Phase 1 of specs/001-pipeline.md: fetch and distill.')}
  ${dim('Stages from phases 2-5 are reported as not implemented.')}
`

interface Args {
  cmd: string
  sub?: string
  positional: string[]
  flags: Set<string>
  /** Flags that carry a value, e.g. `--component path`. */
  values: Map<string, string>
}

function parse(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) { positional.push(a); continue }

    // Both `--component x` and `--component=x`.
    const eq = a.indexOf('=')
    if (eq !== -1) { values.set(a.slice(2, eq), a.slice(eq + 1)); continue }

    const name = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { values.set(name, next); i++ }
    else flags.add(name)
  }
  return { cmd: positional[0] ?? '', sub: positional[1], positional: positional.slice(1), flags, values }
}

function transitionArgs(args: Args) {
  return {
    stage: args.positional[0],
    run: args.values.get('run'),
    reason: args.values.get('reason'),
    output: args.values.get('output'),
    approve: args.flags.has('approve'),
    json: args.flags.has('json'),
  }
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

    case 'verify':
      return runVerify(root, {
        component: args.values.get('component'),
        figma: args.values.get('figma'),
        run: args.values.get('run'),
        reference: args.values.get('reference'),
        props: args.values.get('props'),
        json: args.flags.has('json'),
      })

    case 'resolve':
      return runResolve(root, { run: args.values.get('run'), json: args.flags.has('json') })

    case 'tokens':
      return runTokens(root, {
        run: args.values.get('run'),
        names: args.values.get('names'),
        approve: args.flags.has('approve'),
        json: args.flags.has('json'),
      })

    case 'library': {
      const libArgs = {
        run: args.values.get('run'),
        component: args.values.get('component'),
        approve: args.flags.has('approve'),
      }
      if (args.sub === 'ensure') return runEnsure(root, libArgs)
      if (args.sub === 'register') return runRegister(root, libArgs)
      return fail(`\`gw library ${args.sub ?? ''}\` does not exist.`, 'Options: ensure, register')
    }

    case 'done':
      return done(root, transitionArgs(args))

    case 'skip':
      return skip(root, transitionArgs(args))

    case 'fail':
      return markFailed(root, transitionArgs(args))

    case 'refine':
      return refine(root, {
        run: args.values.get('run'),
        focus: args.values.get('focus'),
        json: args.flags.has('json'),
      })

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
