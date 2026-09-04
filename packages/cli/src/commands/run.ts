/**
 * The run stages: `fetch`, `distill`, and the `next` protocol.
 *
 * Law 1: Claude does not decide which stage comes next, it asks `gw next`.
 * That is why `next` has JSON output — it is a protocol between programs, not a
 * message.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadConfig, paths, newRunState, saveState, loadState, listRuns, activeRun,
  advance, markRunning, directive, resolveCredentials, isImplemented,
  STAGE_SPECS, type RunState, type GridwrightConfig, type IR, type CredentialOrigin,
} from '@gridwright/core'
import {
  FigmaClient, FigmaError, parseFigmaUrl, distill, shouldHalt, extractAssets,
  toPascalCase, slugify, type FigmaNode,
} from '@gridwright/figma'
import { ok, fail, info, warn, step, dim, bold, green, yellow, table, missingCredentials } from '../ui.js'
import { autorun, printStop } from './autorun.js'

function requireConfig(root: string): GridwrightConfig {
  const config = loadConfig(root)
  if (!config) {
    fail(
      `This project is not configured.`,
      'Run `gw init` at the root of the repo where the component will live.',
    )
  }
  return config
}

function requireClient(root: string): { client: FigmaClient; origin: CredentialOrigin } {
  const creds = resolveCredentials(root)
  if (!creds) missingCredentials()
  return { client: new FigmaClient({ token: creds.figmaToken }), origin: creds.origin }
}

/**
 * Where the rejected token actually came from decides the remedy, and telling
 * someone to run `gw auth login` when a stale `.env` outranks it sends them in
 * a circle: the project's .env wins over the machine config (Law 10.b), so the
 * new token would never be reached.
 *
 * Found by pointing gridwright at a real project whose committed token had
 * expired.
 */
export function authRemedy(origin: CredentialOrigin, root: string): string {
  switch (origin) {
    case 'project-dotenv':
      return `The token came from ${join(root, '.env')}, and that file takes precedence over ` +
        `the one saved on this machine — running \`gw auth login\` alone will NOT fix it. ` +
        `Update FIGMA_TOKEN in that .env, or remove the line so the machine credential is used.`
    case 'env':
      return 'The token came from the FIGMA_TOKEN environment variable, which outranks every ' +
        'other source. Unset it or update it in the shell that launched this.'
    case 'user-config':
      return 'Run `! gw auth login` in your terminal to replace it.'
  }
}

/** A readable, stable id: the frame name plus a counter. */
function makeRunId(root: string, frameSlug: string): string {
  const existing = new Set(listRuns(root).map((r) => r.id))
  for (let i = 1; i < 1000; i++) {
    const id = `${frameSlug}-${String(i).padStart(2, '0')}`
    if (!existing.has(id)) return id
  }
  return `${frameSlug}-${Date.now()}`
}

export async function build(root: string, url: string, opts: { mode?: 'component' | 'view' } = {}): Promise<void> {
  requireConfig(root)
  const ref = parseFigmaUrl(url)

  // Credentials are checked BEFORE opening the run: there is no point leaving a
  // half-created run behind only for it to die in `fetch` (Law 10,
  // "precondition").
  const { client, origin } = requireClient(root)

  step(`Querying Figma — node ${ref.nodeId}`)
  let doc: FigmaNode
  try {
    doc = (await client.node(ref.fileKey, ref.nodeId)).document
  } catch (e) {
    if (e instanceof FigmaError) {
      const hint = e.status === 401 || e.status === 403
        ? `${e.hint}\n\n${authRemedy(origin, root)}`
        : e.hint
      fail(e.message, hint)
    }
    throw e
  }

  const id = makeRunId(root, slugify(doc.name))
  const state = newRunState({
    id, mode: opts.mode ?? 'component', url,
    fileKey: ref.fileKey, nodeId: ref.nodeId, name: toPascalCase(doc.name),
  })
  mkdirSync(paths.run(root, id), { recursive: true })
  saveState(root, state)
  ok(`Run ${bold(id)} — frame "${doc.name}" → ${state.name}`)

  await runFetch(root, state, doc, client)
  await runDistill(root, state)

  // Then as far as the CLI legitimately can. It stops at a gate, at a stage
  // that is the model's, or at one missing an input — and says which.
  printStop(autorun(root, state))
}

/**
 * Picks a run back up after a gate.
 *
 * The same chaining `build` does, from wherever the run currently sits. Without
 * it, approving a gate leaves you re-running stages by hand one at a time for
 * no reason — the CLI already knows which ones it can do.
 */
export function resume(root: string, id?: string): void {
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('No open run.', 'Start one with `gw build "<figma-url>"`.')
  printStop(autorun(root, run))
}

async function runFetch(root: string, state: RunState, doc: FigmaNode, client: FigmaClient): Promise<void> {
  markRunning(state, 'fetch')
  saveState(root, state)

  writeFileSync(paths.rawTree(root, state.id), JSON.stringify(doc, null, 2) + '\n')

  // Reference image of the whole frame. Fidelity is measured against this
  // (Law 7); it is not one of the component's assets.
  let reference = false
  const urls = await client.imageUrls(state.source.fileKey, [state.source.nodeId], { scale: 2 })
  const refUrl = urls.get(state.source.nodeId)
  if (refUrl) {
    const buf = Buffer.from(await (await fetch(refUrl)).arrayBuffer())
    writeFileSync(paths.reference(root, state.id), buf)
    reference = true
  } else {
    warn('Figma returned no reference image for this node.')
  }

  const manifest = await extractAssets(
    client, doc,
    { fileKey: state.source.fileKey, nodeId: state.source.nodeId },
    paths.runAssets(root, state.id),
    { prefix: slugify(doc.name) },
  )

  step(`${manifest.assets.length} assets${manifest.optimized ? '' : ' (unoptimized: sharp missing)'}`)
  for (const a of manifest.assets) {
    const t = a.trimmed ? dim(` · trimmed ${a.trimmed.from} → ${a.trimmed.to}`) : ''
    console.log(`    ${dim('·')} ${a.file} ${dim(`${a.width}x${a.height}`)}${t}`)
  }

  advance(state, 'fetch', {
    status: 'done',
    output: { assets: manifest.assets.length, reference, optimized: manifest.optimized },
  })
  saveState(root, state)
}

async function runDistill(root: string, state: RunState): Promise<void> {
  const config = requireConfig(root)
  markRunning(state, 'distill')
  saveState(root, state)

  const doc = JSON.parse(readFileSync(paths.rawTree(root, state.id), 'utf8')) as FigmaNode
  const { ir, measurements, rawTokens } = distill(
    doc,
    { fileKey: state.source.fileKey, nodeId: state.source.nodeId },
    config.distill,
  )

  writeFileSync(paths.ir(root, state.id), JSON.stringify(ir, null, 2) + '\n')
  writeFileSync(paths.measurements(root, state.id), JSON.stringify(measurements, null, 2) + '\n')
  // Kept for `resolve`, which runs later and cannot re-derive them without
  // re-fetching the whole tree.
  writeFileSync(paths.rawTokens(root, state.id), JSON.stringify(rawTokens, null, 2) + '\n')

  const rawSize = readFileSync(paths.rawTree(root, state.id), 'utf8').length
  const irSize = JSON.stringify(ir).length
  step(
    `IR: ${countNodes(ir)} nodes, ${rawTokens.length} raw values ` +
      dim(`(${fmtBytes(rawSize)} → ${fmtBytes(irSize)}, ${Math.round((1 - irSize / rawSize) * 100)}% smaller)`),
  )
  console.log(`    ${dim('hash')} ${ir.hash}`)

  printWarnings(ir)

  const halt = shouldHalt(ir, config.distill)
  if (halt.halt) {
    advance(state, 'distill', { status: 'failed', reason: halt.reason! })
    saveState(root, state)
    fail('The IR is not usable.', halt.reason)
  }

  advance(state, 'distill', {
    status: 'done',
    output: {
      nodes: countNodes(ir), warnings: ir.warnings.length, hash: ir.hash,
      rawTokens: rawTokens.length, measured: measurements.nodes.length,
    },
  })
  saveState(root, state)
}

/**
 * Errors and warnings are both shown in full; only `info` is collapsed to a
 * count.
 *
 * A dropped gradient is a `warn`, and collapsing it into "3 informational
 * warnings" hides exactly the thing someone needs to see — the design value
 * that will be missing from their component.
 */
function printWarnings(ir: IR): void {
  if (ir.warnings.length === 0) return
  const loud = ir.warnings.filter((w) => w.severity !== 'info')
  const quiet = ir.warnings.length - loud.length

  for (const w of loud.slice(0, 8)) {
    const mark = w.severity === 'error' ? yellow('!') : dim('!')
    console.log(`    ${mark} ${w.message}${w.path ? dim(` — ${w.path}`) : ''}`)
  }
  if (loud.length > 8) console.log(dim(`    … and ${loud.length - 8} more`))
  if (quiet > 0) console.log(dim(`    ${quiet} informational (unnamed layers, deep nesting)`))
}

/** The protocol. `--json` is what Claude consumes; without the flag it prints
 *  for a human. */
export function printNext(root: string, state: RunState | null, opts: { json: boolean }): void {
  const run = state ?? activeRun(root)
  if (!run) {
    if (opts.json) { console.log(JSON.stringify({ error: 'no-active-run' })); process.exitCode = 1; return }
    info('No open run. Start one with `gw build <figma-url>`.')
    return
  }

  const d = directive(run, root, {
    ir: existsSync(paths.ir(root, run.id)) ? paths.ir(root, run.id) : undefined,
    reference: existsSync(paths.reference(root, run.id)) ? paths.reference(root, run.id) : undefined,
    assets: existsSync(paths.runAssets(root, run.id)) ? paths.runAssets(root, run.id) : undefined,
    survey: existsSync(paths.survey(root, run.id)) ? paths.survey(root, run.id) : undefined,
  }, loadConfig(root)?.conventions)

  if (opts.json) { console.log(JSON.stringify(d, null, 2)); return }

  console.log(bold(`Run ${run.id} — stage ${green(d.stage)}`))
  table([
    ['who', d.actor === 'agent' ? 'Claude' : d.actor === 'human' ? 'you' : 'the CLI'],
    ['what', d.action],
    ...(d.gate ? [['gate', d.gate] as [string, string]] : []),
  ])
  if (d.blocked) {
    console.log()
    warn(d.blocked.reason)
    console.log(dim(`  Phase 1 ends here. Stages from phases 2-5 are not built yet.`))
  }
}

export function status(root: string, opts: { json?: boolean } = {}): void {
  const runs = listRuns(root)
  if (opts.json) { console.log(JSON.stringify(runs, null, 2)); return }
  if (runs.length === 0) { info('No runs yet.'); return }

  for (const r of runs) {
    const done = Object.values(r.stages).filter((s) => s.status === 'done').length
    console.log(`${bold(r.id)} ${dim(`${r.name} · ${r.mode}`)}`)
    console.log(`  ${green(String(done))} stages closed · current: ${yellow(r.stage)} ${dim(STAGE_SPECS[r.stage].summary)}`)
    const failed = Object.entries(r.stages).filter(([, s]) => s.status === 'failed')
    for (const [name, s] of failed) console.log(`  ${dim(`✗ ${name}: ${s.reason ?? ''}`)}`)
  }
}

export function showIr(root: string, id?: string): void {
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('Could not find that run.', 'List them with `gw status`.')
  const p = paths.ir(root, run.id)
  if (!existsSync(p)) fail(`Run ${run.id} has no IR yet.`, 'Run `gw distill`.')
  process.stdout.write(readFileSync(p, 'utf8'))
}

function countNodes(ir: IR): number {
  const walk = (ns: IR['children']): number =>
    ns.reduce((acc, n) => acc + 1 + walk(n.children ?? []), 0)
  return walk(ir.children)
}

function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`
}

export { requireConfig, isImplemented }
