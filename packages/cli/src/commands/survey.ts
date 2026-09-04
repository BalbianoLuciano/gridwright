/**
 * `gw survey` — stage 6.
 *
 * Proposes, never picks. The output feeds `plan`, which is a human gate: a
 * wrong reuse is harder to find later than a duplicate, so nothing here decides
 * anything on its own.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeRun, advance, loadConfig, loadState, paths, saveState,
  type IR, type RunState,
} from '@gridwright/core'
import { survey, type Candidate } from '@gridwright/library'
import { ok, fail, info, warn, step, dim, bold, green, yellow } from '../ui.js'

export interface SurveyArgs { run?: string; json?: boolean }

export function runSurvey(root: string, args: SurveyArgs): void {
  const config = loadConfig(root)
  if (!config) fail('This project is not configured.', 'Run `gw init` first.')
  const run = args.run ? loadState(root, args.run) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')

  const irPath = paths.ir(root, run.id)
  if (!existsSync(irPath)) fail(`Run ${run.id} has no IR.`, 'Re-run `gw build` for that node.')
  const ir = JSON.parse(readFileSync(irPath, 'utf8')) as IR

  const result = survey(root, config, ir)
  writeFileSync(paths.survey(root, run.id), JSON.stringify(result, null, 2) + '\n')

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    report(run, result.indexed.length, result.candidates, result.duplicateOf)
  }

  advance(run, 'survey', {
    status: 'done',
    output: { indexed: result.indexed.length, candidates: result.candidates.length,
              ...(result.duplicateOf ? { duplicateOf: result.duplicateOf } : {}) },
  })
  saveState(root, run)
  info(`Now on ${green(run.stage)}`)
}

function report(run: RunState, indexed: number, candidates: Candidate[], duplicateOf?: string): void {
  step(`${indexed} components indexed`)

  // The strongest possible finding: this design is already built.
  if (duplicateOf) {
    console.log()
    warn(`This design is already registered as ${bold(duplicateOf)} — same IR hash.`)
    console.log(dim('  The run will update it rather than add a second component.'))
  }

  if (candidates.length === 0) {
    console.log(dim('  Nothing similar found. Building this from scratch is the right call.'))
    return
  }

  console.log()
  console.log(bold('  Worth reading before writing anything new'))

  const strong = candidates.filter((c) => c.confidence >= 0.6)
  const weak = candidates.filter((c) => c.confidence < 0.6)

  for (const c of strong.slice(0, 8)) {
    const where = c.target ? dim(` for "${c.target}"`) : ''
    console.log(`    ${yellow('→')} ${bold(c.component.name)}${where}`)
    console.log(`      ${dim(c.component.path)}`)
    console.log(`      ${c.note}`)
    if (c.component.props.length) {
      console.log(dim(`      props: ${c.component.props.join(', ')}`))
    }
  }

  if (weak.length > 0) {
    console.log()
    console.log(dim(`  ${weak.length} weaker match${weak.length === 1 ? '' : 'es'} on structure alone: ` +
      weak.slice(0, 6).map((c) => c.component.name).join(', ')))
  }

  console.log()
  console.log(dim('  These are suggestions, not decisions. `plan` is where a person chooses.'))
}
