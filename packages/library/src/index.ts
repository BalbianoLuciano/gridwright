/**
 * The component library — the part that makes a run add to the system rather
 * than just produce a file.
 *
 * Two stages, deliberately apart. `ensure` runs before anything is written, so
 * there is somewhere to put the result. `register` runs after `golden`, so only
 * approved components are ever listed: a registry that includes rejected work
 * is worse than none, because `survey` reads it and would offer them for reuse.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, extname } from 'node:path'
import { paths, type Framework, type GridwrightConfig } from '@gridwright/core'

export * from './placement.js'
// The one reader of a component's name off its path; the CLI needs it too.
export { componentName } from './files.js'
export * from './fonts.js'

export interface RegistryEntry {
  path: string
  /** A module or a whole view. The library is browsed by this before anything
   *  else — "what do we have" is two questions, not one. */
  mode?: 'component' | 'view'
  /** Where it was filed: module, layout, primitive, overlay. Decided once, when
   *  it was built, so the library groups a header with the layout parts rather
   *  than guessing again from the name. */
  kind?: string
  figma: { file: string; node: string; irHash: string; identity?: string }
  props: string[]
  tokens: string[]
  baseline?: string
  score?: number
  /** Per-viewport totals, so the library can show the shape of a result and
   *  not only its headline — and can still show one after the run's own
   *  artifacts have been cleaned up. */
  viewports?: Array<{ name: string; width: number; total: number }>
  runs: number
  updatedAt: string
}

export type Registry = Record<string, RegistryEntry>

export interface EnsureResult {
  created: string[]
  /** True the first time, when the library did not exist. That is the one run
   *  a person is asked to approve — creating structure in someone's repo is
   *  invasive exactly once. */
  bootstrapped: boolean
}

export function ensureLibrary(root: string, config: GridwrightConfig): EnsureResult {
  const dir = join(root, config.library.dir)
  const barrel = join(root, config.library.barrel)
  const registry = join(root, config.library.registry)
  const created: string[] = []
  const bootstrapped = !existsSync(dir)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    created.push(config.library.dir)
  }
  if (!existsSync(barrel)) {
    mkdirSync(dirname(barrel), { recursive: true })
    writeFileSync(barrel, barrelHeader(config.framework))
    created.push(config.library.barrel)
  }
  if (!existsSync(registry)) {
    mkdirSync(dirname(registry), { recursive: true })
    writeFileSync(registry, '{}\n')
    created.push(config.library.registry)
  }
  return { created, bootstrapped }
}

function barrelHeader(framework: Framework): string {
  return `// Component library — exports maintained by gridwright.
// Hand-written entries are kept; gridwright only adds what it registers.
${framework === 'vue3' ? '' : ''}`
}

export function readRegistry(root: string, config: GridwrightConfig): Registry {
  const path = join(root, config.library.registry)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Registry
  } catch {
    // A corrupt registry is not worth failing a run over, but it must not be
    // silently replaced either — `register` will report it as a fresh one.
    return {}
  }
}

export interface RegisterInput {
  name: string
  componentPath: string
  /** How the component exports itself: `default`, or `named:Component`. A
   *  barrel that re-exports a default from a file that has none breaks the
   *  build of every consumer, and it does it at import time. */
  exportShape?: string
  figma: { file: string; node: string; irHash: string; identity?: string }
  props: string[]
  tokens: string[]
  baseline?: string
  score?: number
  mode?: 'component' | 'view'
  kind?: string
  viewports?: Array<{ name: string; width: number; total: number }>
}

export interface RegisterResult {
  entry: RegistryEntry
  /** Set when the same design was registered before — same irHash, so this is
   *  the same component drawn again rather than a new one. */
  updatedExisting?: string
  barrelLine?: string
}

/**
 * Adds the component to the registry and the barrel.
 *
 * The irHash is what gives idempotency: the same Figma node registered twice is
 * recognised as an update, not a second component. Without it you end up with
 * HeroAboutUs, HeroAboutUs2 and HeroAboutUsNew two months in, and no way to
 * tell which one anything uses.
 */
export function registerComponent(
  root: string,
  config: GridwrightConfig,
  input: RegisterInput,
): RegisterResult {
  const registry = readRegistry(root, config)

  // The same design — or the same main component, which is sturdier: an
  // instance's overrides change its IR hash, so two uses of `overlay-form` with
  // different copy hashed differently and registered twice.
  const previous = Object.entries(registry).find(([, e]) =>
    e.figma.irHash === input.figma.irHash
    || (!!input.figma.identity && e.figma.identity === input.figma.identity))
  const name = previous ? previous[0] : input.name

  const entry: RegistryEntry = {
    path: relative(root, input.componentPath),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    figma: input.figma,
    props: input.props,
    tokens: input.tokens,
    ...(input.baseline ? { baseline: input.baseline } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.viewports?.length ? { viewports: input.viewports } : {}),
    runs: (previous?.[1].runs ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }

  registry[name] = entry
  const registryPath = join(root, config.library.registry)
  mkdirSync(dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, JSON.stringify(sortKeys(registry), null, 2) + '\n')

  // A view is registered but never exported. The barrel exists so someone can
  // write `import { Button } from '@/components/ui'`; a view is a leaf — it
  // composes, and nothing composes it. That holds well beyond one framework: a
  // page is a route in Next, in Nuxt, in Astro, and in a CMS it is not even a
  // JavaScript module. Barrelling it produced a line that either nobody used
  // or nobody could resolve.
  //
  // It still gets a registry entry and its baselines, which is what makes it
  // show up in the library beside everything else.
  const barrelLine = input.mode === 'view'
    ? undefined
    : addToBarrel(root, config, name, input.componentPath, input.exportShape)
  return {
    entry,
    ...(previous && previous[0] !== input.name ? { updatedExisting: previous[0] } : {}),
    ...(barrelLine ? { barrelLine } : {}),
  }
}

/** Appends an export, and only if it is not already there. The barrel may hold
 *  hand-written lines; those are never touched. */
function addToBarrel(
  root: string,
  config: GridwrightConfig,
  name: string,
  componentPath: string,
  exportShape?: string,
): string | undefined {
  const barrel = join(root, config.library.barrel)
  const current = existsSync(barrel) ? readFileSync(barrel, 'utf8') : ''

  const ext = config.conventions?.importExtension ?? ''

  let spec = relative(dirname(barrel), componentPath).replace(/\\/g, '/')
  spec = spec.replace(new RegExp(`${extname(spec)}$`), '')
  // An index file is imported by its directory — but only where a bare
  // specifier compiles. Under `moduleResolution: node16` a directory is not
  // resolvable and the extension is mandatory, so the path stays complete.
  if (ext === '') spec = spec.replace(/\/index$/, '')
  if (!spec.startsWith('.')) spec = `./${spec}`
  spec += ext

  if (current.includes(`from '${spec}'`)) return undefined

  // Re-export what the file actually exports. A barrel pulling a default out of
  // a module that exports a named `Component` fails at import time, in the
  // consumer, with an error that names neither file.
  const named = exportShape?.startsWith('named:') ? exportShape.slice('named:'.length) : null
  const line = named
    ? `export { ${named} as ${name} } from '${spec}'`
    : `export { default as ${name} } from '${spec}'`
  writeFileSync(barrel, `${current.trimEnd()}\n${line}\n`)
  return line
}

function sortKeys(registry: Registry): Registry {
  return Object.fromEntries(Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)))
}

/** What `survey` will read in phase 5. Here already so the registry is written
 *  in the shape that stage needs, rather than being reshaped later. */
export function findByHash(registry: Registry, irHash: string): [string, RegistryEntry] | null {
  return Object.entries(registry).find(([, e]) => e.figma.irHash === irHash) ?? null
}

/** A section already in the library, by its main component. What makes the
 *  second view that uses the same footer reuse it instead of rebuilding it. */
export function findByIdentity(registry: Registry, identity: string): [string, RegistryEntry] | null {
  return Object.entries(registry).find(([, e]) => e.figma.identity === identity) ?? null
}

// --- views --------------------------------------------------------------------

/**
 * A view, recorded outside the library.
 *
 * A view is a leaf — it composes, and nothing composes it — so it has no place
 * in the barrel, and keeping it in the registry made "what can I reuse" and
 * "what have we built" the same list. It still has goldens, and the dashboard
 * still shows it; this is what it reads.
 */
export interface ViewRecord {
  path: string
  figma: { file: string; node: string; irHash: string }
  /** The library sections it is composed of, by registry name. */
  sections: string[]
  score?: number
  viewports?: Array<{ name: string; width: number; total: number }>
  runs: number
  updatedAt: string
}

export type ViewsManifest = Record<string, ViewRecord>

export function readViews(root: string): ViewsManifest {
  const file = paths.views(root)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ViewsManifest
  } catch {
    return {}
  }
}

export function recordView(
  root: string,
  name: string,
  record: Omit<ViewRecord, 'runs' | 'updatedAt'>,
): ViewRecord {
  const views = readViews(root)
  const previous = views[name]
  const entry: ViewRecord = {
    ...record,
    runs: (previous?.runs ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  views[name] = entry
  const file = paths.views(root)
  mkdirSync(dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(views).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
  return entry
}
export * from './survey.js'
export * from './conventions.js'
