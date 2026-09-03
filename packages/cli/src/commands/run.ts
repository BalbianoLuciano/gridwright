/**
 * Las etapas de la corrida: `fetch`, `distill`, y el protocolo `next`.
 *
 * Ley 1: Claude no decide qué etapa viene, se la pregunta a `gw next`. Por eso
 * `next` tiene salida JSON: es un protocolo entre programas, no un mensaje.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  loadConfig, paths, newRunState, saveState, loadState, listRuns, activeRun,
  advance, markRunning, directive, resolveCredentials, isImplemented,
  STAGE_SPECS, type RunState, type GridwrightConfig, type IR,
} from '@gridwright/core'
import {
  FigmaClient, FigmaError, parseFigmaUrl, distill, shouldHalt, extractAssets,
  toPascalCase, slugify, type FigmaNode,
} from '@gridwright/figma'
import { ok, fail, info, warn, step, dim, bold, green, yellow, table, missingCredentials } from '../ui.js'

function requireConfig(root: string): GridwrightConfig {
  const config = loadConfig(root)
  if (!config) {
    fail(
      `Este proyecto no está configurado.`,
      'Corré `gw init` en la raíz del repo donde va a vivir el componente.',
    )
  }
  return config
}

function requireClient(root: string): FigmaClient {
  const creds = resolveCredentials(root)
  if (!creds) missingCredentials()
  return new FigmaClient({ token: creds.figmaToken })
}

/** Un id legible y estable: el nombre del frame más un contador. */
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

  // La credencial se chequea ANTES de abrir el run: no tiene sentido dejar una
  // corrida a medio crear para que muera en `fetch` (Ley 10, "precondición").
  const client = requireClient(root)

  step(`Consultando Figma — nodo ${ref.nodeId}`)
  let doc: FigmaNode
  try {
    doc = (await client.node(ref.fileKey, ref.nodeId)).document
  } catch (e) {
    if (e instanceof FigmaError) fail(e.message, e.hint)
    throw e
  }

  const id = makeRunId(root, slugify(doc.name))
  const state = newRunState({
    id, mode: opts.mode ?? 'component', url,
    fileKey: ref.fileKey, nodeId: ref.nodeId, name: toPascalCase(doc.name),
  })
  mkdirSync(paths.run(root, id), { recursive: true })
  saveState(root, state)
  ok(`Corrida ${bold(id)} — frame "${doc.name}" → ${state.name}`)

  await runFetch(root, state, doc, client)
  await runDistill(root, state)

  console.log()
  printNext(root, state, { json: false })
}

async function runFetch(root: string, state: RunState, doc: FigmaNode, client: FigmaClient): Promise<void> {
  markRunning(state, 'fetch')
  saveState(root, state)

  writeFileSync(paths.rawTree(root, state.id), JSON.stringify(doc, null, 2) + '\n')

  // Imagen de referencia del frame completo. Es contra esto que después se mide
  // la fidelidad (Ley 7): no es un asset del componente.
  let reference = false
  const urls = await client.imageUrls(state.source.fileKey, [state.source.nodeId], { scale: 2 })
  const refUrl = urls.get(state.source.nodeId)
  if (refUrl) {
    const buf = Buffer.from(await (await fetch(refUrl)).arrayBuffer())
    writeFileSync(paths.reference(root, state.id), buf)
    reference = true
  } else {
    warn('Figma no devolvió imagen de referencia para este nodo.')
  }

  const manifest = await extractAssets(
    client, doc,
    { fileKey: state.source.fileKey, nodeId: state.source.nodeId },
    paths.runAssets(root, state.id),
    { prefix: slugify(doc.name) },
  )

  step(`${manifest.assets.length} assets${manifest.optimized ? '' : ' (sin optimizar: falta sharp)'}`)
  for (const a of manifest.assets) {
    const t = a.trimmed ? dim(` · recortado ${a.trimmed.from} → ${a.trimmed.to}`) : ''
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
  const { ir, rawTokens } = distill(
    doc,
    { fileKey: state.source.fileKey, nodeId: state.source.nodeId },
    config.distill,
  )

  writeFileSync(paths.ir(root, state.id), JSON.stringify(ir, null, 2) + '\n')

  const rawSize = readFileSync(paths.rawTree(root, state.id), 'utf8').length
  const irSize = JSON.stringify(ir).length
  step(
    `IR: ${countNodes(ir)} nodos, ${rawTokens.length} valores crudos ` +
      dim(`(${fmtBytes(rawSize)} → ${fmtBytes(irSize)}, ${Math.round((1 - irSize / rawSize) * 100)}% menos)`),
  )
  console.log(`    ${dim('hash')} ${ir.hash}`)

  printWarnings(ir)

  const halt = shouldHalt(ir, config.distill)
  if (halt.halt) {
    advance(state, 'distill', { status: 'failed', reason: halt.reason! })
    saveState(root, state)
    fail('El IR no es utilizable.', halt.reason)
  }

  advance(state, 'distill', {
    status: 'done',
    output: { nodes: countNodes(ir), warnings: ir.warnings.length, hash: ir.hash, rawTokens: rawTokens.length },
  })
  saveState(root, state)
}

function printWarnings(ir: IR): void {
  if (ir.warnings.length === 0) return
  const errors = ir.warnings.filter((w) => w.severity === 'error')
  const rest = ir.warnings.length - errors.length
  for (const w of errors.slice(0, 5)) {
    console.log(`    ${yellow('!')} ${w.message}${w.path ? dim(` — ${w.path}`) : ''}`)
  }
  if (errors.length > 5) console.log(dim(`    … y ${errors.length - 5} más de severidad alta`))
  if (rest > 0) console.log(dim(`    ${rest} advertencias informativas`))
}

/** El protocolo. `--json` es lo que consume Claude; sin flag, sale legible. */
export function printNext(root: string, state: RunState | null, opts: { json: boolean }): void {
  const run = state ?? activeRun(root)
  if (!run) {
    if (opts.json) { console.log(JSON.stringify({ error: 'no-active-run' })); process.exitCode = 1; return }
    info('No hay ninguna corrida abierta. Empezá con `gw build <url-de-figma>`.')
    return
  }

  const d = directive(run, root, {
    ir: existsSync(paths.ir(root, run.id)) ? paths.ir(root, run.id) : undefined,
    reference: existsSync(paths.reference(root, run.id)) ? paths.reference(root, run.id) : undefined,
    assets: existsSync(paths.runAssets(root, run.id)) ? paths.runAssets(root, run.id) : undefined,
  })

  if (opts.json) { console.log(JSON.stringify(d, null, 2)); return }

  console.log(bold(`Corrida ${run.id} — etapa ${green(d.stage)}`))
  table([
    ['quién', d.actor === 'agent' ? 'Claude' : d.actor === 'human' ? 'vos' : 'el CLI'],
    ['qué', d.action],
    ...(d.gate ? [['gate', d.gate] as [string, string]] : []),
  ])
  if (d.blocked) {
    console.log()
    warn(d.blocked.reason)
    console.log(dim(`  Hasta acá llega la fase ${1}. Las etapas de fases 2-5 todavía no están construidas.`))
  }
}

export function status(root: string, opts: { json?: boolean } = {}): void {
  const runs = listRuns(root)
  if (opts.json) { console.log(JSON.stringify(runs, null, 2)); return }
  if (runs.length === 0) { info('Sin corridas todavía.'); return }

  for (const r of runs) {
    const done = Object.values(r.stages).filter((s) => s.status === 'done').length
    console.log(`${bold(r.id)} ${dim(`${r.name} · ${r.mode}`)}`)
    console.log(`  ${green(String(done))} etapas cerradas · actual: ${yellow(r.stage)} ${dim(STAGE_SPECS[r.stage].summary)}`)
    const failed = Object.entries(r.stages).filter(([, s]) => s.status === 'failed')
    for (const [name, s] of failed) console.log(`  ${dim(`✗ ${name}: ${s.reason ?? ''}`)}`)
  }
}

export function showIr(root: string, id?: string): void {
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) fail('No encontré esa corrida.', 'Listalas con `gw status`.')
  const p = paths.ir(root, run.id)
  if (!existsSync(p)) fail(`La corrida ${run.id} todavía no tiene IR.`, 'Corré `gw distill`.')
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
