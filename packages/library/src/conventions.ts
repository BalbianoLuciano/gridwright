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

export function detectConventions(root: string): Conventions {
  const shapes: ComponentShape[] = []

  for (const dir of CANDIDATE_DIRS) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    const shape = inferShape(root, dir)
    // A directory whose files disagree with each other teaches nothing.
    if (shape && shape.seenIn >= 1) shapes.push(shape)
  }

  return {
    shapes: shapes.sort((a, b) => b.seenIn - a.seenIn),
    docs: findDocs(root),
  }
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

    layouts.set(...bump(layouts, basename(file) === `index${extname(file)}`
      ? `{Name}/index${extname(file)}`
      : `{Name}${extname(file)}`))

    const named = source.match(/^export\s+(?:async\s+)?function\s+(\w+)/m)
    const isDefault = /^export\s+default\s/m.test(source)
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

/** One level deep plus `<Name>/index.*`. Components nested deeper than that
 *  are someone's private helpers, not the shape of the directory. */
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
    } else if (stat.isDirectory() && /^[A-Z]/.test(entry)) {
      for (const inner of ['index.tsx', 'index.jsx', 'index.vue', 'index.ts']) {
        if (existsSync(join(full, inner))) {
          out.push(join(full, inner))
          break
        }
      }
    }
  }
  return out
}

function isComponentFile(name: string): boolean {
  if (!/\.(tsx|jsx|vue)$/.test(name)) return false
  const base = basename(name, extname(name))
  // Barrels and helpers are not components and would skew every count.
  return /^[A-Z]/.test(base) && !/^(index|types|utils|helpers|constants)$/i.test(base)
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
  return join(shape.dir, shape.file.replace('{Name}', name))
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
