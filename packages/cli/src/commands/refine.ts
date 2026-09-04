/**
 * `gw refine` — the corrective half of the loop.
 *
 * Not "try again". It hands back what failed and where, because
 * `[heading] top: expected 148, got 156` converges in two passes and `71%`
 * never converges at all.
 *
 * The iteration cap is the other half of that. A loop that cannot say when to
 * stop will happily spend a whole budget circling a difference it cannot fix —
 * usually one that is not the component's fault in the first place.
 */

import {
  activeRun, loadState, loadConfig, saveState, inconsistency,
  type RunScore, type RunState, type Dimension, type DimensionScore,
} from '@gridwright/core'
import { ok, fail, info, warn, dim, bold, green, yellow, red } from '../ui.js'

export interface RefineArgs {
  run?: string
  focus?: string
  json?: boolean
}

const DIMENSIONS: Dimension[] = ['structural', 'chromatic', 'perceptual']

export function refine(root: string, args: RefineArgs): void {
  const config = loadConfig(root)
  if (!config) fail('This project is not configured.', 'Run `gw init` first.')

  const run = args.run ? loadState(root, args.run) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')

  const score = lastScore(run)
  if (!score) {
    fail(
      `Run ${run.id} has no verification to refine against.`,
      'Run `gw verify` first — refining without a measurement is just editing.',
    )
  }

  const iteration = (Number(run.stages.refine.output?.iterations) || 0) + 1
  const cap = config.verify.maxRefineIterations

  if (iteration > cap) {
    console.log(`${red('✗')} Refine cap reached — ${cap} iterations, still ${score.total}%.`)
    console.log()
    console.log(dim('  Stopping is the right outcome here. Past this point the difference is'))
    console.log(dim('  usually not the component: a design that cannot be reached with the'))
    console.log(dim('  tokens the project has, or a frame measured against the wrong breakpoint.'))
    console.log(dim(`\n  The screenshots are in .gridwright/verify — worst viewport is ${score.worstViewport}.`))
    process.exitCode = 1
    return
  }

  // Before handing out any work: do the dimensions agree that there is work?
  //
  // refine attributed every gap to the component, always. A run measured
  // perceptual 95.67% and structural 48.93% on the same render — the pixels
  // saying it matches and the boxes saying it does not — and nothing consumed
  // the contradiction. An obedient agent sent to close that gap reshapes the
  // DOM until the number moves, which here meant reproducing five nested Figma
  // instance wrappers around an svg. Better score, worse component, no
  // objection from anywhere.
  const worst = score.viewports.find((v) => v.viewport === score.worstViewport) ?? score.viewports[0]
  const contradiction = worst ? inconsistency(worst) : null
  if (contradiction && !args.focus) {
    console.log(`${yellow('!')} The measurements disagree with each other.`)
    console.log()
    console.log(dim(`  ${contradiction}`))
    console.log()
    console.log('Not spending an iteration on this. What to check instead:')
    console.log(dim('  · does the component label its nodes with data-gw?'))
    console.log(dim('  · is the design frame a different width than the viewport being graded?'))
    console.log(dim(`  · look at .gridwright/verify/${worst!.viewport}.png before changing anything`))
    console.log()
    console.log(dim('  Override with --focus=structural if you are sure the layout is wrong.'))
    process.exitCode = 1
    return
  }

  const focus = pickFocus(score, args.focus)
  if (!focus) {
    ok(`Nothing to refine — ${score.total}% on ${score.worstViewport}, threshold ${score.threshold}.`)
    return
  }

  if (args.json) {
    console.log(JSON.stringify({
      run: run.id, iteration, cap,
      viewport: focus.viewport, dimension: focus.dimension.dimension,
      score: focus.dimension.score, findings: focus.dimension.findings,
    }, null, 2))
  } else {
    printFocus(run, score, focus, iteration, cap)
  }

  run.stages.refine.output = { ...run.stages.refine.output, iterations: iteration }
  saveState(root, run)
}

interface Focus { viewport: string; width: number; dimension: DimensionScore }

/**
 * Picks the worst measurable dimension on the worst viewport.
 *
 * One dimension at a time on purpose. Handing over every failing number at once
 * invites shotgun edits that fix one thing and break another, and then nobody
 * can tell which change moved the score.
 */
function pickFocus(score: RunScore, requested?: string): Focus | null {
  const worst = score.viewports.find((v) => v.viewport === score.worstViewport) ?? score.viewports[0]
  if (!worst) return null

  const usable = worst.dimensions.filter((d) => !d.unavailable)
  if (requested) {
    if (!DIMENSIONS.includes(requested as Dimension)) {
      fail(`No such dimension: ${requested}`, `Expected one of: ${DIMENSIONS.join(', ')}`)
    }
    const found = usable.find((d) => d.dimension === requested)
    if (!found) fail(`"${requested}" was not measured on ${worst.viewport}.`)
    return { viewport: worst.viewport, width: worst.width, dimension: found }
  }

  const failing = usable
    .filter((d) => d.score < score.threshold)
    .sort((a, b) => a.score - b.score)[0]
  return failing ? { viewport: worst.viewport, width: worst.width, dimension: failing } : null
}

function printFocus(run: RunState, score: RunScore, focus: Focus, iteration: number, cap: number): void {
  const d = focus.dimension
  console.log(`${bold(run.id)} ${dim(`· iteration ${iteration} of ${cap}`)}`)
  console.log()
  const coverage = d.coverage !== undefined ? dim(`  (${Math.round(d.coverage * 100)}% of the design matched)`) : ''
  console.log(`${yellow(d.dimension)} ${d.score}% — failing on ${focus.viewport} (${focus.width}px)${coverage}`)

  if (d.findings.length === 0) {
    console.log(dim('  No individual findings: the difference is spread across the whole render'))
    console.log(dim('  rather than sitting in one element.'))
  }

  // Grouped by element: four deltas on one node is one fix, not four.
  const byPath = new Map<string, typeof d.findings>()
  for (const f of d.findings) {
    const list = byPath.get(f.path) ?? []
    list.push(f)
    byPath.set(f.path, list)
  }
  for (const [path, findings] of byPath) {
    const parts = findings.map((f) =>
      f.edge === 'missing' ? 'missing from the render'
        : f.edge === 'colour' ? `ΔE ${f.delta}`
        : `${f.edge} ${f.delta > 0 ? '+' : ''}${f.delta}px`,
    )
    console.log(`  • ${path} — ${parts.join(', ')}`)
  }

  console.log()
  for (const other of score.viewports.find((v) => v.viewport === focus.viewport)!.dimensions) {
    if (other.dimension === d.dimension) continue
    const state = other.unavailable ? dim('not measured') : `${other.score}%`
    console.log(dim(`  ${other.dimension}: ${state}`))
  }

  console.log()
  info('Fix only this dimension, then run `gw verify` again.')
  console.log(dim('  Changing several at once makes it impossible to tell which edit moved the score.'))
}

/** The score `verify` recorded on the run, if it ran as a stage. */
function lastScore(run: RunState): RunScore | null {
  const raw = run.stages.verify.output?.score
  return raw ? (raw as unknown as RunScore) : null
}
