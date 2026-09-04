/**
 * `survey` — what already exists that this design could reuse.
 *
 * The stage that decides whether a project accumulates a design system or a
 * pile of near-duplicates. Without it a view reimplements the button, the card
 * and the hero that were already there, and six views later nobody can tell
 * which Card is the real one.
 *
 * Deliberately heuristic, and deliberately honest about it. It proposes
 * candidates with a reason attached; the decision belongs to `plan`, which is a
 * human gate. A survey that silently picked components would be worse than none
 * — a wrong reuse is harder to find than a duplicate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, basename, dirname } from 'node:path'
import type { GridwrightConfig, IR, IRNode, IRRole } from '@gridwright/core'
import { readRegistry, type Registry, type RegistryEntry } from './index.js'

export interface IndexedComponent {
  name: string
  path: string
  props: string[]
  /** Figma node ids mentioned anywhere in the file. Teams that work from a
   *  design routinely write down which node a component came from, and that is
   *  a far better signal than the name they happened to give it. */
  nodes: string[]
  /** Roles the component's markup suggests, in document order. Rough on
   *  purpose — it is a hint for matching, not a parse of the framework. */
  shape: IRRole[]
  /** Present when gridwright itself registered it, which brings the design
   *  hash and makes an exact match possible. */
  registered?: RegistryEntry
}

export type MatchReason = 'same-design' | 'same-node' | 'same-name' | 'similar-name' | 'similar-shape'

export interface Candidate {
  /** The IR node this could cover — empty for the root. */
  target: string
  component: IndexedComponent
  confidence: number
  reason: MatchReason
  /** Said in words, because a number alone is not a reason to reuse something. */
  note: string
}

export interface SurveyResult {
  indexed: IndexedComponent[]
  candidates: Candidate[]
  /** Set when this exact design is already registered: the run is an update,
   *  not a new component. */
  duplicateOf?: string
}

const SOURCE_EXT = new Set(['.tsx', '.jsx', '.vue', '.ts', '.js'])

export function survey(root: string, config: GridwrightConfig, ir: IR): SurveyResult {
  const registry = readRegistry(root, config)
  const indexed = indexComponents(root, config, registry)

  const duplicate = Object.entries(registry).find(([, e]) => e.figma.irHash === ir.hash)
  const candidates: Candidate[] = []

  /**
   * Strongest signal short of the hash: a component that names this very node.
   *
   * Found on a real run. The design was node 1:61528 "Wrapper full", and the
   * project already had a ValuePropositionCard whose own comment said
   * `Design: node 1:61528 "Wrapper full"`. Matching on names alone found
   * nothing and the pipeline was about to rebuild it — the exact failure
   * survey exists to prevent, one layer name away.
   */
  for (const component of indexed) {
    if (component.nodes.includes(ir.source.node)) {
      candidates.push({
        target: '', component, confidence: 0.98, reason: 'same-node',
        note: `${component.name} says it was built from this node (${ir.source.node}). ` +
          `This is almost certainly an update to it, not a new component.`,
      })
    }
  }

  // The root first: is this whole design already a component?
  candidates.push(...matchNode(ir.name, ir.children, indexed, ''))

  // Then each section. A view is a composition, and the reuse worth finding
  // lives one or two levels down rather than at the top.
  for (const child of ir.children) {
    candidates.push(...matchNode(child.name, child.children ?? [], indexed, child.name))
    for (const grandchild of child.children ?? []) {
      candidates.push(...matchNode(grandchild.name, grandchild.children ?? [], indexed, `${child.name} / ${grandchild.name}`))
    }
  }

  const best = dedupe(candidates)
  return {
    indexed,
    candidates: best,
    ...(duplicate ? { duplicateOf: duplicate[0] } : {}),
  }
}

/**
 * Walks the project's component directories.
 *
 * Both the configured library and wherever the project already keeps things:
 * a repo that has been building components by hand for months has far more to
 * reuse than gridwright has registered, and ignoring those is how a parallel
 * second library gets built next to the first.
 */
export function indexComponents(
  root: string,
  config: GridwrightConfig,
  registry: Registry = {},
): IndexedComponent[] {
  const roots = new Set<string>([config.library.dir])
  for (const guess of ['src/components', 'components', 'app/components', 'resources/js/Components']) {
    if (existsSync(join(root, guess))) roots.add(guess)
  }

  const byPath = new Map<string, RegistryEntry & { name: string }>()
  for (const [name, entry] of Object.entries(registry)) byPath.set(entry.path, { ...entry, name })

  const out: IndexedComponent[] = []
  const seen = new Set<string>()

  for (const dir of roots) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const file of walk(abs)) {
      const rel = relative(root, file)
      if (seen.has(rel)) continue
      seen.add(rel)

      const name = componentName(file)
      if (!name) continue
      const source = safeRead(file)
      if (!source) continue

      const registered = byPath.get(rel)
      out.push({
        name,
        path: rel,
        props: registered?.props ?? extractProps(source),
        shape: extractShape(source),
        nodes: extractNodeIds(source),
        ...(registered ? { registered } : {}),
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 6) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.') || entry === '__tests__') continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) yield* walk(full, depth + 1)
    else if (SOURCE_EXT.has(extname(entry))) yield full
  }
}

/** `1:61528`, `1-61528`, `node-id=1-61528` — however a team happens to write it. */
export function extractNodeIds(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/\b(\d{1,6})[:-](\d{2,6})\b/g)) {
    out.add(`${m[1]}:${m[2]}`)
  }
  return [...out]
}

/** `Card/index.tsx` is Card; `Card.tsx` is Card. Barrels and helpers are not
 *  components and would only add noise to every match. */
function componentName(file: string): string | null {
  const base = basename(file, extname(file))
  const name = base === 'index' ? basename(dirname(file)) : base
  if (/^(index|types|utils|helpers|constants|registry)$/i.test(name)) return null
  if (!/^[A-Z]/.test(name)) return null
  return name
}

/** Props by shape, not by type-checking. `defineProps<{a,b}>`, a destructured
 *  React signature, or a plain `props.x` — enough to compare against IR slots. */
export function extractProps(source: string): string[] {
  const props = new Set<string>()

  const vue = source.match(/defineProps<\{([^}]*)\}>/s)
  if (vue) {
    for (const m of vue[1]!.matchAll(/(\w+)\s*[?:]/g)) props.add(m[1]!)
  }

  const destructured = source.match(/function\s+\w+\s*\(\s*\{([^}]*)\}/s)
    ?? source.match(/\(\s*\{([^}]*)\}\s*(?::\s*\w+)?\s*\)\s*=>/s)
  if (destructured) {
    for (const part of destructured[1]!.split(',')) {
      const name = part.trim().split(/[:=]/)[0]!.trim()
      if (/^\w+$/.test(name) && name !== 'children') props.add(name)
    }
  }

  const iface = source.match(/(?:interface|type)\s+\w*Props\w*\s*=?\s*\{([^}]*)\}/s)
  if (iface) {
    for (const m of iface[1]!.matchAll(/(\w+)\s*[?:]/g)) props.add(m[1]!)
  }

  return [...props]
}

/** Roles inferred from the tags present. A hint, not a parse. */
export function extractShape(source: string): IRRole[] {
  const shape: IRRole[] = []
  for (const m of source.matchAll(/<\s*([a-zA-Z][\w.-]*)/g)) {
    const tag = m[1]!.toLowerCase()
    if (/^h[1-6]$/.test(tag)) shape.push('heading')
    else if (tag === 'img' || tag === 'picture') shape.push('image')
    else if (tag === 'svg') shape.push('icon')
    else if (tag === 'button') shape.push('button')
    else if (tag === 'input' || tag === 'textarea' || tag === 'select') shape.push('input')
    else if (tag === 'hr') shape.push('divider')
    else if (tag === 'p' || tag === 'span') shape.push('text')
  }
  return shape
}

function matchNode(
  name: string,
  children: IRNode[],
  indexed: IndexedComponent[],
  target: string,
): Candidate[] {
  const out: Candidate[] = []
  const wanted = normalize(name)
  const shape = shapeOf(children)

  for (const component of indexed) {
    const have = normalize(component.name)

    if (have === wanted) {
      out.push({
        target, component, confidence: 0.9, reason: 'same-name',
        note: `"${name}" and ${component.name} are the same name — almost certainly the same thing.`,
      })
      continue
    }

    if (have.includes(wanted) || wanted.includes(have)) {
      if (Math.min(have.length, wanted.length) >= 4) {
        out.push({
          target, component, confidence: 0.6, reason: 'similar-name',
          note: `"${name}" reads like ${component.name}. Worth opening before writing a second one.`,
        })
        continue
      }
    }

    // Shape is the weakest signal and says so: plenty of unrelated components
    // are a heading over some text.
    const overlap = shapeOverlap(shape, component.shape)
    if (shape.length >= 3 && overlap >= 0.75) {
      out.push({
        target, component, confidence: 0.35 + overlap * 0.2, reason: 'similar-shape',
        note: `same rough structure as ${component.name} (${shape.join(', ')}) — weak signal, worth a look.`,
      })
    }
  }
  return out
}

function shapeOf(nodes: IRNode[]): IRRole[] {
  const out: IRRole[] = []
  const walkNodes = (ns: IRNode[]) => {
    for (const n of ns) {
      if (n.role !== 'container') out.push(n.role)
      if (n.children) walkNodes(n.children)
    }
  }
  walkNodes(nodes)
  return out
}

function shapeOverlap(a: IRRole[], b: IRRole[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const count = (roles: IRRole[]) => {
    const m = new Map<IRRole, number>()
    for (const r of roles) m.set(r, (m.get(r) ?? 0) + 1)
    return m
  }
  const ca = count(a)
  const cb = count(b)
  let shared = 0
  for (const [role, n] of ca) shared += Math.min(n, cb.get(role) ?? 0)
  return shared / Math.max(a.length, b.length)
}

/** One suggestion per component per target, keeping the strongest reason. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  for (const c of candidates) {
    const key = `${c.target}::${c.component.path}`
    const existing = best.get(key)
    if (!existing || c.confidence > existing.confidence) best.set(key, c)
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence)
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
