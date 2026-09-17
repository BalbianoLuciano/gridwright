/**
 * How this project writes a component — not just where it puts it.
 *
 * `init` learned the directory and stopped there, which is half of what
 * `author` needs. A real project has more than one shape and they are not
 * interchangeable: santillanafrancais keeps `components/ui/Button.tsx` with a
 * default export, and `components/modules/HeroBanner/index.tsx` with a named
 * `Component` plus a `fields` and a `meta` its CMS refuses to load without.
 *
 * Writing the wrong one produces a file that compiles, renders in the harness,
 * scores well, and does not work in the product. Nothing downstream catches
 * that, because every check gridwright has is about fidelity to the design.
 *
 * Inferred from the components already there rather than configured, for the
 * same reason `resolve` reads the token file: the answer is in the repo, and a
 * convention someone has to restate in a config is one that goes stale.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { detectPlacements, type Placement } from './placement.js'
import { folderComponent } from './files.js'

export interface ComponentShape {
  /** Where this kind of component lives, relative to the project root. */
  dir: string
  /** `{Name}.tsx` or `{Name}/index.tsx` — how the file is laid out. */
  file: string
  /** `default`, or `named:Component` when the project exports by name. */
  export: string
  /** Other exports every file of this kind carries. A CMS module without its
   *  `fields` is not a module, however good the markup is. */
  alsoExports: string[]
  /** How many files this was inferred from. One example is a guess. */
  seenIn: number
  /** The closest existing file, for `author` to read before writing. */
  example?: string
}

export interface Conventions {
  /** Every distinct shape found, most populated first. */
  shapes: ComponentShape[]
  /**
   * The responsive prefixes this project actually has.
   *
   * Tailwind's defaults are sm/md/lg/xl, and a project that renames them keeps
   * none of those. santillanafrancais uses tablet/laptop/desktop/wide, so
   * `md:flex-row` is not a smaller breakpoint — it is a class that does not
   * exist, silently, with no error anywhere. A component written with it lays
   * out as though it had no responsive rules at all.
   */
  breakpoints: Array<{ name: string; width: string }>
  /**
   * The extension this project puts on a relative import, or '' for none.
   *
   * Not a style question. Under `moduleResolution: node16` a bare
   * `from '../modules/NewsletterBanner'` is a compile error, and the barrel
   * gridwright generated broke the typecheck of the repo it was written into —
   * a file the tool added, failing the build, on a project whose every other
   * import already showed the answer.
   *
   * Inferred by looking, like everything else here.
   */
  importExtension: string
  /** Where each kind of thing goes. See `placement.ts`. */
  placements: Placement[]
  /** Docs the project keeps about its own conventions. `author` should read
   *  these before writing: they carry the rules no amount of file-shape
   *  inference will find. */
  docs: string[]
}

const CANDIDATE_DIRS = [
  'components/modules', 'components/islands', 'components/ui', 'components',
  'src/components/ui', 'src/components', 'app/components', 'resources/js/Components',
]

const DOC_CANDIDATES = [
  'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md',
  'docs/conventions.md', 'docs/02-convenciones.md', 'docs/patrones',
  'docs/patterns', '.cursorrules',
]

/**
 * How this project writes components, and where it puts them.
 *
 * `placements` is taken rather than detected when the person has already been
 * asked. `init` lets them pick a runner-up or type a path, and the shapes used
 * to be read from what detection guessed instead: choosing `templates/partials`
 * over `templates/layouts` left the config with a shape for the directory that
 * was turned down, and none for the one being written to — so `verify` found no
 * match, omitted the export shape, and the harness mounted `default` in a
 * project whose components export a name.
 */
export function detectConventions(root: string, settled?: Placement[]): Conventions {
  const shapes: ComponentShape[] = []
  const placements = settled ?? detectPlacements(root)

  // The fixed list alone missed a Vite project that keeps its modules in
  // `src/modules`: placement detection found the directory, and the shape of
  // the files in it was never read, so `author` was handed no example at all.
  // Views stay out: a `pages` directory is usually the fullest one in the
  // project, and the most populated shape is the fallback for everything else.
  const dirs = new Set(CANDIDATE_DIRS)
  for (const p of placements) if (p.from !== 'absent' && p.kind !== 'view') dirs.add(p.dir)

  for (const dir of dirs) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    const shape = inferShape(root, dir)
    // A directory whose files disagree with each other teaches nothing.
    if (shape && shape.seenIn >= 1) shapes.push(shape)
  }

  const sorted = shapes.sort((a, b) => b.seenIn - a.seenIn)
  return {
    shapes: sorted,
    breakpoints: findBreakpoints(root),
    importExtension: detectImportExtension(root, sorted),
    placements,
    docs: findDocs(root),
  }
}

/**
 * What the project's own relative imports look like.
 *
 * Counts them rather than reading tsconfig: `moduleResolution` is routinely
 * inherited from an extended base three directories up, and the files
 * themselves cannot be wrong about what compiles.
 */
function detectImportExtension(root: string, shapes: ComponentShape[]): string {
  const counts = new Map<string, number>()
  let total = 0

  for (const shape of shapes.slice(0, 3)) {
    for (const file of componentFiles(join(root, shape.dir)).slice(0, 40)) {
      const source = safeRead(file)
      if (!source) continue
      for (const m of source.matchAll(/from\s+'(\.[^']*)'/g)) {
        total++
        const ext = m[1]!.match(/\.[a-z]+$/)?.[0] ?? ''
        counts.set(ext, (counts.get(ext) ?? 0) + 1)
      }
    }
  }

  if (total === 0) return ''
  const bare = counts.get('') ?? 0
  // A minority writing one is someone's habit; a majority is the rule.
  if (bare * 2 >= total) return ''
  let best = ''
  let most = 0
  for (const [ext, n] of counts) {
    if (ext && n > most) { best = ext; most = n }
  }
  // Source extensions are what TypeScript rejects in an ESM import specifier;
  // '.js' is what it wants even when the file on disk is '.tsx'.
  return best === '.ts' || best === '.tsx' ? '.js' : best
}

/** Read from the Tailwind config's `screens`. Empty means the defaults apply. */
function findBreakpoints(root: string): Array<{ name: string; width: string }> {
  for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']) {
    const abs = join(root, name)
    if (!existsSync(abs)) continue
    const src = safeRead(abs)
    if (!src) continue

    const block = src.match(/screens\s*:\s*\{([\s\S]*?)\n\s*\}/)
    if (!block) return []
    const out: Array<{ name: string; width: string }> = []
    for (const m of block[1]!.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g)) {
      out.push({ name: m[1]!, width: m[2]! })
    }
    return out
  }
  return []
}

function inferShape(root: string, dir: string): ComponentShape | null {
  const abs = join(root, dir)
  const files = componentFiles(abs)
  if (files.length === 0) return null

  const layouts = new Map<string, number>()
  const exports = new Map<string, number>()
  const extras = new Map<string, number>()

  for (const file of files) {
    const source = safeRead(file)
    if (!source) continue

    layouts.set(...bump(layouts, layoutOf(abs, file)))

    const named = source.match(/^export\s+(?:async\s+)?function\s+(\w+)/m)
    // A single-file component is a default export by construction: `<script
    // setup>` writes no export line at all, so a directory of `.vue` files
    // came back `unknown` and taught nothing — the whole directory had no
    // shape, which is the same hole as a directory that was never read.
    const isDefault = /^export\s+default\s/m.test(source) || /\.(vue|svelte)$/.test(file)
    exports.set(...bump(exports, isDefault ? 'default' : named ? `named:${named[1]}` : 'unknown'))

    // Anything else the file exports at the top level. A shape is not only its
    // component: a CMS module carries contracts alongside it.
    for (const m of source.matchAll(/^export\s+const\s+(\w+)/gm)) {
      extras.set(...bump(extras, m[1]!))
    }
  }

  const file = commonest(layouts)
  const exp = commonest(exports)
  if (!file || !exp || exp === 'unknown') return null

  // Only what shows up in most of them. One file's helper is not a convention.
  const threshold = Math.max(2, Math.ceil(files.length * 0.6))
  const alsoExports = [...extras.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([name]) => name)
    .sort()

  return {
    dir,
    file,
    export: exp,
    alsoExports,
    seenIn: files.length,
    ...(files[0] ? { example: relativeTo(root, files[0]) } : {}),
  }
}

/**
 * How a component's file sits in its directory: `{Name}.tsx`,
 * `{Name}/index.tsx`, or `{Name}/{Name}.tsx`.
 *
 * The third was missing. A folder per module holding `Intro/Intro.tsx` beside
 * its demo is as common as the `index` spelling, and not knowing it made the
 * whole directory look empty.
 */
function layoutOf(dir: string, file: string): string {
  const ext = extname(file)
  if (dirname(file) === dir) return `{Name}${ext}`
  return basename(file) === `index${ext}` ? `{Name}/index${ext}` : `{Name}/{Name}${ext}`
}

/** One level deep plus the folder-per-component spellings from `files.ts`.
 *  Components nested deeper than that are someone's private helpers, not the
 *  shape of the directory. */
function componentFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === '__tests__') continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }

    if (stat.isFile() && isComponentFile(entry)) {
      out.push(full)
    } else if (stat.isDirectory()) {
      const inner = folderComponent(dir, entry)
      if (inner) out.push(inner)
    }
  }
  return out
}

function isComponentFile(name: string): boolean {
  const ext = extname(name)
  if (!/\.(tsx|jsx|vue|svelte)$/.test(name)) return false
  const base = basename(name, ext)
  // Barrels and helpers are not components and would skew every count.
  if (/^(index|types|utils|helpers|constants)$/i.test(base)) return false
  // PascalCase, or kebab-case for a single-file component: `hero-banner.vue`
  // is how Vue and Nuxt spell it. A lowercase `.tsx` is a helper or a demo,
  // never a component, so that one stays PascalCase-only.
  return /^[A-Z]/.test(base) || (/^\.(vue|svelte)$/.test(ext) && /^[a-z][a-z0-9-]*$/.test(base))
}

/**
 * Looks in the project and then upward to the repo root.
 *
 * A frontend nested under `src/theme/` keeps its conventions where the repo
 * keeps its docs, not beside the components. Stopping at the project directory
 * found nothing in exactly the projects most likely to have written their
 * conventions down.
 */
function findDocs(root: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  let dir = resolve(root)
  for (let up = 0; up < 6; up++) {
    for (const rel of DOC_CANDIDATES) {
      const abs = join(dir, rel)
      if (!existsSync(abs)) continue
      try {
        if (statSync(abs).isDirectory()) {
          for (const f of readdirSync(abs)) {
            if (!f.endsWith('.md')) continue
            const found = relativeTo(root, join(abs, f))
            if (!seen.has(found)) { seen.add(found); out.push(found) }
          }
        } else {
          const found = relativeTo(root, abs)
          if (!seen.has(found)) { seen.add(found); out.push(found) }
        }
      } catch {
        continue
      }
    }
    // Past the repo boundary the docs belong to something else.
    if (existsSync(join(dir, '.git'))) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

/** The shape that matches a directory, so `author` writes the right one when a
 *  project has several. */
export function shapeFor(conventions: Conventions, dir: string): ComponentShape | null {
  return conventions.shapes.find((s) => s.dir === dir)
    ?? conventions.shapes.find((s) => dir.startsWith(s.dir))
    ?? conventions.shapes[0]
    ?? null
}

/** Where a component of this shape goes, and under what name. */
export function pathFor(shape: ComponentShape, name: string): string {
  // Every occurrence: `{Name}/{Name}.tsx` names the folder and the file.
  return join(shape.dir, shape.file.replaceAll('{Name}', name))
}

function bump(map: Map<string, number>, key: string): [string, number] {
  return [key, (map.get(key) ?? 0) + 1]
}

function commonest(map: Map<string, number>): string | null {
  let best: [string, number] | null = null
  for (const entry of map) if (!best || entry[1] > best[1]) best = entry
  return best?.[0] ?? null
}

/** Relative to the project when it is inside it, otherwise relative to the
 *  repo — `../../docs/conventions.md` is still a path someone can open. */
function relativeTo(root: string, file: string): string {
  return relative(resolve(root), file)
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
