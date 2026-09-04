/**
 * Running as far as the CLI legitimately can.
 *
 * `gw build` used to chain exactly two stages because, when it was written,
 * exactly two existed. Stages were added around it and it never caught up, so
 * the help promised "as far as it goes" while the code stopped at `distill`.
 * This is the part that makes the promise true.
 *
 * It does not run everything, and that is not a gap to close later:
 *
 *   - a human gate stops it (Law 5) — nothing that mutates the project gets
 *     written because a loop happened to reach it
 *   - an `agent` stage stops it (Law 3) — writing a component that reads like
 *     the rest of the repo is not something a program does
 *   - a stage missing an input it cannot derive stops it, and says which one
 *
 * The point is that it stops for a stated reason rather than at an arbitrary
 * line in a function.
 */

import { existsSync } from 'node:fs'
import {
  loadState, paths, STAGE_SPECS, type RunState, type Stage,
} from '@gridwright/core'
import { runResolve } from './tokens.js'
import { runSurvey } from './survey.js'
import { runReport } from './report.js'
import { dim, info, step, bold, yellow } from '../ui.js'

export interface StopReason {
  stage: Stage
  kind: 'gate' | 'agent' | 'human' | 'needs-input' | 'end'
  message: string
  next: string
}

/** Stages this can execute on its own, given the run's own artifacts. */
const AUTOMATIC: Partial<Record<Stage, (root: string, run: RunState) => void>> = {
  resolve: (root, run) => runResolve(root, { run: run.id }),
  survey: (root, run) => runSurvey(root, { run: run.id }),
  report: (root, run) => runReport(root, { run: run.id }),
}

/**
 * What a stage needs before it can run at all.
 *
 * Separate from whether it is automatic: `verify` is code, but it cannot run
 * before something has been written for it to render. Reporting that as
 * "waiting for the component" beats failing inside Playwright.
 */
function missingInput(root: string, run: RunState, stage: Stage): string | null {
  switch (stage) {
    case 'resolve':
      return existsSync(paths.rawTokens(root, run.id)) ? null : 'the distilled values (re-run `gw build`)'
    case 'survey':
      return existsSync(paths.ir(root, run.id)) ? null : 'the IR (re-run `gw build`)'
    case 'harness':
    case 'verify':
      return 'the component path — nothing has been written yet'
    case 'library:register':
      return 'the component path (`gw library register --component <path>`)'
    default:
      return null
  }
}

export function autorun(root: string, run: RunState): StopReason {
  for (;;) {
    const stage = run.stage
    const spec = STAGE_SPECS[stage]

    if (spec.gate) {
      return {
        stage, kind: spec.actor === 'human' ? 'human' : 'gate',
        message: `${stage} needs a person to approve it (Law 5).`,
        next: gateCommand(stage),
      }
    }

    if (spec.actor === 'agent') {
      return {
        stage, kind: 'agent',
        message: `${stage} is the model's work, not the CLI's (Law 3): ${spec.summary.toLowerCase()}.`,
        next: agentHint(stage),
      }
    }

    const missing = missingInput(root, run, stage)
    if (missing) {
      return {
        stage, kind: 'needs-input',
        message: `${stage} is waiting on ${missing}.`,
        next: stageCommand(stage),
      }
    }

    const fn = AUTOMATIC[stage]
    if (!fn) {
      return {
        stage, kind: 'needs-input',
        message: `${stage} has no automatic runner yet.`,
        next: stageCommand(stage),
      }
    }

    console.log()
    step(`${bold(stage)}`)
    const before = run.stage
    fn(root, run)
    // The command advanced the run on disk; the in-memory copy has to follow or
    // this loops forever on a stage that already closed.
    const reloaded = reload(root, run)
    if (!reloaded || reloaded.stage === before) {
      return { stage, kind: 'needs-input', message: `${stage} did not advance.`, next: stageCommand(stage) }
    }
    Object.assign(run, reloaded)

    if (run.stage === 'report' && run.stages.report.status === 'done') {
      return { stage: 'report', kind: 'end', message: 'The run is complete.', next: 'gw report' }
    }
  }
}

export function printStop(stop: StopReason): void {
  console.log()
  if (stop.kind === 'end') {
    info(stop.message)
    return
  }
  const mark = stop.kind === 'agent' ? dim('·') : yellow('!')
  console.log(`${mark} Stopped at ${bold(stop.stage)} — ${stop.message}`)
  console.log(dim(`  ${stop.next}`))
}

function gateCommand(stage: Stage): string {
  switch (stage) {
    case 'tokens': return 'Review with `gw tokens`, then `gw tokens --approve`.'
    case 'library:ensure': return 'Review with `gw library ensure`, then add --approve.'
    case 'plan': return 'The model proposes the plan; a person approves it with `gw done plan --approve`.'
    case 'golden': return 'Review with `gw golden`, then `gw golden --approve`.'
    default: return `gw done ${stage} --approve`
  }
}

function agentHint(stage: Stage): string {
  switch (stage) {
    case 'plan': return 'Read the IR and the survey, propose files and props, then `gw done plan --approve`.'
    case 'author': return 'Write the component from the IR, then `gw done`.'
    case 'refine': return 'Run `gw refine` for what to fix, then `gw verify` again.'
    default: return 'gw next'
  }
}

function stageCommand(stage: Stage): string {
  switch (stage) {
    case 'verify': return 'gw verify --component <path>'
    case 'library:register': return 'gw library register --component <path>'
    default: return 'gw next'
  }
}

function reload(root: string, run: RunState): RunState | null {
  return loadState(root, run.id)
}
