#!/usr/bin/env node
/**
 * `gw` — the pipeline engine.
 *
 * Argument parsing is hand-rolled on purpose; see `args.ts`.
 */

import { authLogin, authStatus, authLogout } from './commands/auth.js'
import { parse, type Args } from './args.js'
import { init } from './commands/init.js'
import { build, printNext, status, showIr, resume } from './commands/run.js'
import { runVerify } from './commands/verify.js'
import { done, skip, markFailed } from './commands/advance.js'
import { refine } from './commands/refine.js'
import { runResolve, runTokens } from './commands/tokens.js'
import { runEnsure, runRegister } from './commands/library.js'
import { runGolden } from './commands/golden.js'
import { runReport } from './commands/report.js'
import { runSurvey } from './commands/survey.js'
import { bold, dim, fail, green } from './ui.js'
import { FigmaError } from '@gridwright/figma'

const HELP = `${bold('gw')} — gridwright

  ${bold('Precondition')}
    gw auth login              save the Figma token (${dim('you run this, not the agent')})
    gw auth status             show which credential is in use
    gw auth logout             remove the saved credential

  ${bold('Project')}
    gw init [--force] [--yes]  set up this repo: framework, tokens, library, placements

  ${bold('Run')}
    gw build <figma-url>       open a run and run every automatic stage
      --view                   view mode instead of component mode
    gw continue                carry on from wherever the run is
    gw next [--json]           which stage is up and who runs it
    gw status [--json]         runs and the stage each one is on
    gw ir [<run-id>]           print a run's IR

  ${bold('Design system')}
    gw resolve                 sort design values into exact / near / new
    gw tokens [--approve]      write the new ones — ${dim('human gate')}
      --names <json|path>      names for them, in the project's convention
    gw survey                  what already exists that this could reuse
    gw library ensure [--approve]
    gw library register --component <path>
    gw golden [--approve]      freeze the regression baseline — ${dim('human gate')}
    gw report [--open]         write the dashboard, and open it

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

  ${dim('Phases 1-4 of specs/001-pipeline.md are built: a run goes from a Figma')}
  ${dim('node to a registered component. Only `survey` — and view mode with it —')}
  ${dim('is missing, and it is reported as not implemented rather than skipped.')}
`

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
      // A value flag with nothing after it lands in `flags`, not `values`.
      for (const f of ['library', 'placement']) {
        if (args.flags.has(f)) return fail(`--${f} needs a value.`, 'gw init --library <dir> --placement <kind>=<dir>')
      }
      return init(root, {
        force: args.flags.has('force'),
        yes: args.flags.has('yes'),
        library: args.values.get('library'),
        placements: args.all.get('placement'),
      })

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

    case 'survey':
      return runSurvey(root, { run: args.values.get('run'), json: args.flags.has('json') })

    case 'golden':
      return runGolden(root, {
        run: args.values.get('run'),
        component: args.values.get('component'),
        approve: args.flags.has('approve'),
      })

    case 'report':
      return runReport(root, { run: args.values.get('run'), open: args.flags.has('open') })

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

    case 'continue':
      return resume(root, args.values.get('run'))

    case 'next':
      return printNext(root, null, { json: args.flags.has('json'), run: args.values.get('run') })

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
