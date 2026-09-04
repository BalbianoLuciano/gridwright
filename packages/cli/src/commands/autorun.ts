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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadConfig, loadState, paths, STAGE_SPECS, type RunState, type Stage,
} from '@gridwright/core'
import { runResolve, runTokens } from './tokens.js'
import { runEnsure } from './library.js'
import { runSurvey } from './survey.js'
import { runReport } from './report.js'
import { dim, info, step, bold, yellow } from '../ui.js'

export interface StopReason {
  stage: Stage
  kind: 'gate' | 'agent' | 'human' | 'needs-input' | 'end'
  message: string
  next: string
}

/**
 * A gate with nothing behind it is not a gate.
 *
 * Law 5 protects writes: nothing that mutates the project happens without a
 * person saying yes. When a run resolves every design value against tokens the
 * project already has, `tokens` writes nothing — and stopping there asks
 * someone to approve an empty diff, which teaches them to approve without
 * looking. That is worse than not asking.
 *
 * Only ever true when there is genuinely nothing to write. Anything uncertain
 * counts as a gate.
 */
function gateIsEmpty(root: string, run: RunState, stage: Stage): boolean {
  if (stage === 'tokens') {
    const path = paths.resolutions(root, run.id)
    if (!existsSync(path)) return false
    try {
      const resolutions = JSON.parse(readFileSync(path, 'utf8')) as Array<{ bucket: string }>
      return resolutions.every((r) => r.bucket !== 'new')
    } catch {
      return false
    }
  }
  if (stage === 'library:ensure') {
    // Only the first time is invasive. After that there is nothing to create.
    const config = loadConfig(root)
    return config ? existsSync(join(root, config.library.dir)) : false
  }
  return false
}

/** Stages this can execute on its own, given the run's own artifacts. */
const AUTOMATIC: Partial<Record<Stage, (root: string, run: RunState) => void>> = {
  resolve: (root, run) => runResolve(root, { run: run.id }),
  // Reached only when the gate is empty; it closes the stage with "nothing to
  // write" rather than writing anything.
  tokens: (root, run) => runTokens(root, { run: run.id }),
  'library:ensure': (root, run) => runEnsure(root, { run: run.id, approve: true }),
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

    // Checked before both of the guards below: a stage with nothing to do is
    // neither a decision to approve nor judgment to apply. `tokens` is the
    // model's work because naming takes judgment — with no names to give, there
    // is nothing to judge.
    const empty = gateIsEmpty(root, run, stage)

    if (spec.gate && !empty) {
      return {
        stage, kind: spec.actor === 'human' ? 'human' : 'gate',
        message: `${stage} needs a person to approve it (Law 5).`,
        next: gateCommand(stage),
      }
    }

    if (spec.actor === 'agent' && !empty) {
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
