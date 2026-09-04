/**
 * `gw library` — stages 5 and 13, the two that make a run add to the system.
 *
 * Neither can be skipped. A run that builds a component and does not register
 * it leaves the project with one more file and no more system, which is the
 * definition of a failed run here.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import {
  activeRun, advance, loadConfig, loadState, paths, saveState,
  type IR, type RunState, type GridwrightConfig,
} from '@gridwright/core'
import { ensureLibrary, registerComponent, readRegistry, findByHash } from '@gridwright/library'
import { ok, fail, info, warn, dim, bold, green, yellow } from '../ui.js'

export interface LibraryArgs {
  run?: string
  component?: string
  approve?: boolean
  json?: boolean
}

function context(root: string, id?: string): { run: RunState; config: GridwrightConfig } {
  const config = loadConfig(root)
  if (!config) fail('This project is not configured.', 'Run `gw init` first.')
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')
  return { run, config }
}

export function runEnsure(root: string, args: LibraryArgs): void {
  const { run, config } = context(root, args.run)
  const exists = existsSync(join(root, config.library.dir))

  // Creating structure in someone else's repo is invasive exactly once, so
  // that once is a gate. Afterwards it never asks again.
  if (!exists && !args.approve) {
    console.log(bold('The component library does not exist yet.'))
    console.log(dim('  gridwright would create, and nothing else:\n'))
    console.log(`    ${config.library.dir}/`)
    console.log(`    ${config.library.barrel}`)
    console.log(`    ${config.library.registry}`)
    console.log()
    warn('This is the one time it asks (Law 5).')
    console.log(dim('  Approve with: gw library ensure --approve'))
    process.exitCode = 1
    return
  }

  const result = ensureLibrary(root, config)
  if (result.created.length > 0) {
    ok(`Library ready — created ${result.created.length} ${result.created.length === 1 ? 'entry' : 'entries'}`)
    for (const c of result.created) console.log(`    ${dim('·')} ${c}`)
  } else {
    ok(`Library already in place at ${config.library.dir}`)
  }

  advance(run, 'library:ensure', { status: 'done', output: { created: result.created } })
  saveState(root, run)
  info(`Now on ${green(run.stage)}`)
}

export function runRegister(root: string, args: LibraryArgs): void {
  const { run, config } = context(root, args.run)

  if (!args.component) {
    fail(
      'Which component? Pass --component.',
      'gw library register --component src/components/ui/HeroBanner/index.tsx',
    )
  }
  const componentPath = isAbsolute(args.component) ? args.component : resolvePath(root, args.component)
  if (!existsSync(componentPath)) fail(`No such component: ${componentPath}`)

  const irPath = paths.ir(root, run.id)
  if (!existsSync(irPath)) fail(`Run ${run.id} has no IR.`, 'Re-run `gw build` for that node.')
  const ir = JSON.parse(readFileSync(irPath, 'utf8')) as IR

  const before = findByHash(readRegistry(root, config), ir.hash)
  const score = (run.stages.verify.output?.score as { total?: number } | undefined)?.total

  const result = registerComponent(root, config, {
    name: run.name,
    componentPath,
    figma: { file: ir.source.file, node: ir.source.node, irHash: ir.hash },
    props: propsOf(ir),
    tokens: Object.values(ir.tokens),
    ...(score !== undefined ? { score } : {}),
  })

  if (before) {
    // Same design hash: this is the same component drawn again, not a new one.
    console.log(`${yellow('↻')} Updated ${bold(before[0])} — run ${result.entry.runs} of this design`)
  } else {
    ok(`Registered ${bold(run.name)}`)
  }
  if (result.barrelLine) console.log(`    ${dim(result.barrelLine)}`)

  advance(run, 'library:register', {
    status: 'done',
    output: { name: before?.[0] ?? run.name, runs: result.entry.runs },
  })
  saveState(root, run)
  info(`Now on ${green(run.stage)}`)
}

/** Slots become props; the Figma copy is their default value. */
function propsOf(ir: IR): string[] {
  const out = new Set<string>()
  const walk = (nodes: IR['children']) => {
    for (const n of nodes) {
      if (n.slot) out.add(n.slot)
      if (n.children) walk(n.children)
    }
  }
  walk(ir.children)
  for (const v of Object.keys(ir.variants ?? {})) out.add(v)
  return [...out]
}
