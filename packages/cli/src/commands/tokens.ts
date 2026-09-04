/**
 * `gw resolve` and `gw tokens` — stages 3 and 4.
 *
 * Together they are Law 4: values are classified before anything is written,
 * and written before the component is authored. The other order produces
 * `bg-[#1a1a1a]` and a refactor.
 *
 * The write is the gate in Law 5. A badly generated component is rewritten in
 * ten minutes; a contaminated token system is inherited forever, so this is the
 * one place where the friction is worth it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  activeRun, advance, loadConfig, loadState, paths, saveState,
  type RawToken, type RunState, type GridwrightConfig,
} from '@gridwright/core'
import {
  readTokenSystem, resolveTokens, summarize, overBudget, previewTokens, writeTokens,
  type Resolution, type TokenWrite,
} from '@gridwright/tokens'
import { ok, fail, info, warn, step, dim, bold, green, yellow, table } from '../ui.js'

export interface TokensArgs {
  run?: string
  approve?: boolean
  names?: string
  json?: boolean
}

function context(root: string, id?: string): { run: RunState; config: GridwrightConfig } {
  const config = loadConfig(root)
  if (!config) fail('This project is not configured.', 'Run `gw init` first.')
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')
  return { run, config }
}

export function runResolve(root: string, args: TokensArgs): void {
  const { run, config } = context(root, args.run)

  const rawPath = paths.rawTokens(root, run.id)
  if (!existsSync(rawPath)) {
    fail(
      `Run ${run.id} has no distilled values.`,
      'Re-run `gw build` for that node — resolve reads what distill collected.',
    )
  }
  const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as RawToken[]

  const system = readTokenSystem(root, config.tokens.target, config.tokens.file)
  if (system.target === 'none') {
    warn('No token system found — every value will be proposed as new.')
    info(dim('  Point `tokens.file` in gridwright.config.json at where your tokens live.'))
  }

  const resolutions = resolveTokens(raw, system.tokens, {
    colorToleranceDeltaE: config.tokens.colorToleranceDeltaE,
  })
  const counts = summarize(resolutions)

  writeFileSync(paths.resolutions(root, run.id), JSON.stringify(resolutions, null, 2) + '\n')

  step(`${raw.length} design values against ${system.tokens.length} project tokens`)
  table([
    ['exact', `${counts.exact} ${dim('— already in the system')}`],
    ['near', `${counts.near} ${dim("— using the system's value, drift reported")}`],
    ['new', `${counts.new} ${dim('— need a name and a decision')}`],
  ])

  // The bucket that saves the design system: state the substitutions out loud,
  // because the pipeline is choosing the system's value over the design's.
  const near = resolutions.filter((r) => r.bucket === 'near')
  if (near.length > 0) {
    console.log()
    console.log(bold('  Drift absorbed'))
    for (const r of near.slice(0, 8)) console.log(`    ${dim('·')} ${r.note}`)
  }

  if (overBudget(resolutions, config.tokens.maxNewPerRun)) {
    console.log()
    warn(`${counts.new} new tokens is over the budget of ${config.tokens.maxNewPerRun}.`)
    console.log(dim('  A run that wants this many is usually a design that left the system,'))
    console.log(dim('  not one extending it. Worth looking at the list before approving.'))
  }

  advance(run, 'resolve', { status: 'done', output: counts as unknown as Record<string, unknown> })
  saveState(root, run)
  console.log()
  info(`Now on ${green(run.stage)} — run \`gw tokens\` to see what would be written.`)
}

export function runTokens(root: string, args: TokensArgs): void {
  const { run, config } = context(root, args.run)

  const path = paths.resolutions(root, run.id)
  if (!existsSync(path)) fail(`Run ${run.id} has not been resolved.`, 'Run `gw resolve` first.')
  const resolutions = JSON.parse(readFileSync(path, 'utf8')) as Resolution[]

  const pending = resolutions.filter((r) => r.bucket === 'new')
  const system = readTokenSystem(root, config.tokens.target, config.tokens.file)

  if (pending.length === 0) {
    // Mandatory stages still run when there is nothing to do. Closing it with
    // a result is not the same as skipping it.
    advance(run, 'tokens', { status: 'done', output: { written: 0 } })
    saveState(root, run)
    ok('No new tokens — every value resolved against the system.')
    info(`Now on ${green(run.stage)}`)
    return
  }

  const named = applyNames(pending, args.names)
  const missing = named.filter((n) => !n.name)
  if (missing.length > 0) {
    console.log(bold(`${missing.length} new tokens need names.`))
    console.log(dim('  Naming follows the project\'s own convention, which is why it is not automatic.\n'))
    for (const m of missing) {
      console.log(`  ${yellow('?')} ${m.resolution.raw.kind.padEnd(10)} ${m.resolution.raw.value}`)
      console.log(dim(`      used in ${m.resolution.raw.usedIn[0]}`))
    }
    console.log()
    console.log(dim('  Existing sections: ' + (system.sections.join(', ') || 'none')))
    console.log(dim('  Pass them with --names \'{"#ff5a3c":"colors.brand.500"}\''))
    process.exitCode = 1
    return
  }

  const writes: TokenWrite[] = named.map((n) => ({
    name: stripSection(n.name!),
    value: n.resolution.raw.value,
    section: sectionOf(n.name!, n.resolution),
  }))

  const diff = previewTokens(root, system, writes)

  if (!args.approve) {
    console.log(bold(`${writes.length} tokens would be written to ${system.file}`))
    console.log()
    console.log(diff || dim('  (no change)'))
    console.log()
    warn('This is a human gate (Law 5). Nothing has been written.')
    console.log(dim('  A bad component is rewritten in ten minutes; a contaminated token system'))
    console.log(dim('  is inherited forever. Show this to whoever owns the design system.\n'))
    console.log(dim('  Approve with: gw tokens --approve'))
    process.exitCode = 1
    return
  }

  const result = writeTokens(root, system, writes)
  ok(`${result.written.length} tokens written to ${result.file}`)
  for (const w of result.written) console.log(`    ${dim('·')} ${w.section}.${w.name} = ${w.value}`)

  advance(run, 'tokens', {
    status: 'done',
    output: { written: result.written.length, file: result.file },
  })
  saveState(root, run)
  info(`Now on ${green(run.stage)}`)
}

interface Named { resolution: Resolution; name?: string }

/** Names come from the agent or the person, never from here: they have to
 *  follow the project's own convention, and only something that has read the
 *  project knows what that is. */
function applyNames(pending: Resolution[], raw?: string): Named[] {
  let map: Record<string, string> = {}
  if (raw) {
    const text = existsSync(raw) ? readFileSync(raw, 'utf8') : raw
    try {
      map = JSON.parse(text) as Record<string, string>
    } catch {
      fail('--names is neither valid JSON nor a path to a JSON file.')
    }
  }
  return pending.map((r) => ({
    resolution: r,
    ...(map[r.raw.value] ? { name: map[r.raw.value] } : {}),
  }))
}

function sectionOf(name: string, r: Resolution): string {
  if (name.includes('.')) return name.split('.')[0]!
  switch (r.raw.kind) {
    case 'color': case 'gradient': return 'colors'
    case 'spacing': return 'spacing'
    case 'radius': return 'borderRadius'
    case 'shadow': return 'boxShadow'
    case 'border': return 'borderWidth'
    case 'typography': return 'fontSize'
    default: return 'extend'
  }
}

function stripSection(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts.slice(1).join('.') : name
}
