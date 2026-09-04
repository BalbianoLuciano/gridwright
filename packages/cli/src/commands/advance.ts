/**
 * Closing a stage — the other half of the protocol.
 *
 * `gw next` says what to do; these say it was done. Without them the loop never
 * closes and the state machine is decorative: an agent would read a directive,
 * do the work, and have no way to record it, so the next `gw next` would hand
 * back the same stage forever.
 *
 * The transitions themselves live in core and enforce the order. This is only
 * the door.
 */

import { existsSync, readFileSync } from 'node:fs'
import {
  activeRun, advance, loadState, saveState, STAGE_SPECS,
  type RunState, type Stage,
} from '@gridwright/core'
import { ok, fail, info, warn, dim, bold, green, yellow } from '../ui.js'

export interface TransitionArgs {
  stage?: string
  run?: string
  reason?: string
  output?: string
  approve?: boolean
  json?: boolean
}

function requireRun(root: string, id?: string): RunState {
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')
  return run
}

/** Only the stage the run is actually on can be closed; naming another is
 *  usually a sign of having lost the thread, so it says which one is current. */
function targetStage(run: RunState, given?: string): Stage {
  if (!given) return run.stage
  if (!(given in STAGE_SPECS)) fail(`No such stage: ${given}`)
  const stage = given as Stage
  if (stage !== run.stage) {
    fail(
      `Run ${run.id} is on "${run.stage}", not "${stage}".`,
      'Stages close in order (Law 1). Run `gw next` to see what is actually up.',
    )
  }
  return stage
}

export function done(root: string, args: TransitionArgs): void {
  const run = requireRun(root, args.run)
  const stage = targetStage(run, args.stage)
  const spec = STAGE_SPECS[stage]

  // Law 5: a gated stage needs a person to say yes. The flag exists so the
  // approval is an explicit act rather than a side effect of finishing work —
  // an agent that reaches this without one is told to stop and ask.
  if (spec.gate && !args.approve) {
    console.log(`${yellow('!')} ${bold(stage)} is a human gate.`)
    console.log(dim('  Nothing is written until a person approves. Show them what is on the table,'))
    console.log(dim('  and re-run with --approve once they have said yes.\n'))
    console.log(dim(`  gw done ${stage} --approve`))
    process.exitCode = 1
    return
  }

  advance(run, stage, { status: 'done', output: parseOutput(args.output) })
  saveState(root, run)
  ok(`${stage} closed${spec.gate ? ' (approved)' : ''} — now on ${green(run.stage)}`)
  if (args.json) console.log(JSON.stringify({ run: run.id, stage: run.stage }))
}

export function skip(root: string, args: TransitionArgs): void {
  const run = requireRun(root, args.run)
  const stage = targetStage(run, args.stage)

  if (!args.reason) {
    fail(
      `Skipping "${stage}" needs a reason.`,
      'gw skip --reason "no new tokens: every value already resolved"\n\n' +
        'A stage that did not run has to say why. It stays in the history either way.',
    )
  }

  try {
    advance(run, stage, { status: 'skipped', reason: args.reason })
  } catch (e) {
    // The mandatory three refuse outright — they are what makes a run add to
    // the design system rather than just produce a file.
    fail(e instanceof Error ? e.message : String(e))
  }
  saveState(root, run)
  warn(`${stage} skipped — ${args.reason}`)
  info(`Now on ${green(run.stage)}`)
}

export function markFailed(root: string, args: TransitionArgs): void {
  const run = requireRun(root, args.run)
  const stage = targetStage(run, args.stage)
  if (!args.reason) fail(`Marking "${stage}" failed needs a reason.`)

  advance(run, stage, { status: 'failed', reason: args.reason })
  saveState(root, run)
  // The pointer does not move: a failed stage is retried, not stepped over.
  console.log(`${yellow('✗')} ${stage} failed — ${args.reason}`)
  info(`Still on ${yellow(run.stage)}. Fix it and close it again.`)
}

/** Stage output, for whatever comes next: the plan, the files written, a score. */
function parseOutput(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  const text = existsSync(raw) ? readFileSync(raw, 'utf8') : raw
  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    fail('--output is neither valid JSON nor a path to a JSON file.')
  }
}
