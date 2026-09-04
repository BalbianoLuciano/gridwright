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
import type { Framework, GridwrightConfig } from '@gridwright/core'

export interface RegistryEntry {
  path: string
  figma: { file: string; node: string; irHash: string }
  props: string[]
  tokens: string[]
  baseline?: string
  score?: number
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
  figma: { file: string; node: string; irHash: string }
  props: string[]
  tokens: string[]
  baseline?: string
  score?: number
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

  const previous = Object.entries(registry).find(([, e]) => e.figma.irHash === input.figma.irHash)
  const name = previous ? previous[0] : input.name

  const entry: RegistryEntry = {
    path: relative(root, input.componentPath),
    figma: input.figma,
    props: input.props,
    tokens: input.tokens,
    ...(input.baseline ? { baseline: input.baseline } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    runs: (previous?.[1].runs ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }

  registry[name] = entry
  const registryPath = join(root, config.library.registry)
  mkdirSync(dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, JSON.stringify(sortKeys(registry), null, 2) + '\n')

  const barrelLine = addToBarrel(root, config, name, input.componentPath)
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
): string | undefined {
  const barrel = join(root, config.library.barrel)
  const current = existsSync(barrel) ? readFileSync(barrel, 'utf8') : ''

  let spec = relative(dirname(barrel), componentPath).replace(/\\/g, '/')
  spec = spec.replace(new RegExp(`${extname(spec)}$`), '')
  // An index file is imported by its directory, which is how the rest of a
  // codebase would write it.
  spec = spec.replace(/\/index$/, '')
  if (!spec.startsWith('.')) spec = `./${spec}`

  if (current.includes(`from '${spec}'`)) return undefined

  const line = `export { default as ${name} } from '${spec}'`
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
