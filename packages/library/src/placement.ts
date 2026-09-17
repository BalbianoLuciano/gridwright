/**
 * Where a thing goes, and what kind of thing it is.
 *
 * `conventions` learned where a project's directories are and how the files in
 * them are shaped. It never learned what any of them *mean*, so everything
 * landed in whichever directory had the most files in it — a header, a modal
 * and a whole view all filed as page modules, and a `baselines/` folder that
 * grows to a thousand loose images.
 *
 * A header is not a module. A modal is not a module. Putting them in one
 * directory is not a tidiness problem, it is the thing that makes a component
 * library stop being browsable at about forty entries.
 *
 * The vocabulary here is deliberately not one project's. `modules`, `blocks`,
 * `sections`, `partials`, `layouts`, `views`, `pages`, `templates`, `atoms`,
 * `primitives`, `overlays` — every ecosystem picks a few of these and no two
 * pick the same few. gridwright recognises the whole vocabulary and asks about
 * whatever it cannot find, rather than assuming the shape of the repo it was
 * written against.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { folderComponent } from './files.js'

/**
 * What kind of thing a design node becomes.
 *
 * Not a rendering strategy: an island is a module that happens to hydrate, and
 * a project that splits them still puts a header in `layouts` whether it is
 * interactive or not. Kinds answer "what is this", never "how does it run".
 */
export type PlacementKind = 'module' | 'view' | 'layout' | 'primitive' | 'overlay'

export const PLACEMENT_KINDS: PlacementKind[] = ['module', 'view', 'layout', 'primitive', 'overlay']

export interface Placement {
  kind: PlacementKind
  /** Where it goes, relative to the project root. */
  dir: string
  /** How it was decided, so `gw init` can show its work and a person can
   *  correct it. `found` was inferred from the repo, `asked` was answered by
   *  the person, `absent` means nothing exists yet and nothing was chosen. */
  from: 'found' | 'asked' | 'absent'
  /**
   * Other directories in the project that this kind's vocabulary also matched.
   *
   * Shown at setup, because the runner-up is often the right answer and the
   * tool cannot tell. A project with both `templates/layouts` and
   * `templates/partials` keeps its page shell in one and its header and footer
   * in the other, and which is which is a question only the person can settle.
   */
  alternatives?: string[]
}

export const KIND_LABEL: Record<PlacementKind, string> = {
  module: 'Page modules — composable blocks a view is built from',
  view: 'Views — a whole page or screen',
  layout: 'Layout parts — header, footer, nav, sidebar',
  primitive: 'Primitives — button, heading, badge, the atoms others reuse',
  overlay: 'Overlays — modal, dialog, drawer, popover, toast',
}

/**
 * Directory names each kind goes by, most conventional first.
 *
 * Order matters twice: it is the search order when detecting, and the default
 * offered when nothing is found. Entries are matched as path segments, so
 * `components/modules` and `src/blocks` both hit `modules` and `blocks`.
 */
const VOCABULARY: Record<PlacementKind, string[]> = {
  module: ['modules', 'blocks', 'sections', 'widgets'],
  view: ['views', 'pages', 'templates', 'screens', 'routes'],
  layout: ['layouts', 'layout', 'partials', 'chrome', 'shell'],
  primitive: ['ui', 'primitives', 'atoms', 'elements', 'common'],
  overlay: ['overlays', 'modals', 'dialogs', 'popovers', 'sheets'],
}

/** Where a kind is proposed when the project has nowhere for it yet. */
const FALLBACK: Record<PlacementKind, string> = {
  module: 'components/modules',
  view: 'views',
  layout: 'components/layout',
  primitive: 'components/ui',
  overlay: 'components/overlays',
}

/**
 * What counts as a source file for the purpose of "does anything live here".
 *
 * Every templating language a frontend might use, because the directory
 * vocabulary is shared across all of them and the file extension is not.
 */
const SOURCE_FILE =
  /\.(tsx|jsx|ts|js|mjs|cjs|vue|svelte|astro|html|htm|php|twig|liquid|erb|hbs|njk|pug|md|mdx)$/i

/** Directories that are never a placement, whatever they are called. */
const IGNORED = new Set(['node_modules', 'dist', 'build', 'out', '.next', 'coverage', '__tests__', '__snapshots__'])

/**
 * Every directory in the project that a kind's vocabulary recognises.
 *
 * Searched three levels deep, which covers `components/modules`,
 * `src/components/ui` and `resources/js/Components/blocks` without walking a
 * whole repository.
 */
export function detectPlacements(root: string): Placement[] {
  const dirs = walk(root, '', 0, 3)
  const out: Placement[] = []
  // A proposal goes beside the rest of the source. A Vite project keeps all of
  // it under `src/`, and proposing `components/modules` there put the first
  // module outside the tree the build compiles — every section of a view asked
  // for a directory the project would not have looked in.
  const base = existsSync(join(root, 'src')) ? 'src/' : ''

  for (const kind of PLACEMENT_KINDS) {
    const matches = allMatches(root, dirs, VOCABULARY[kind])
    const [best, ...rest] = matches
    out.push(best
      ? { kind, dir: best, from: 'found', ...(rest.length ? { alternatives: rest } : {}) }
      : { kind, dir: base + FALLBACK[kind], from: 'absent' })
  }
  return out
}

/**
 * The most populated directory whose last segment is in the vocabulary.
 *
 * Population breaks the tie because a project part-way through a rename has
 * both `components/modules` and `blocks`, and the one with the files in it is
 * the one it actually uses.
 */
function allMatches(root: string, dirs: string[], vocabulary: string[]): string[] {
  const hits: Array<{ dir: string; rank: number; files: number }> = []

  for (const dir of dirs) {
    const last = dir.split('/').pop() ?? ''
    const rank = vocabulary.indexOf(last)
    if (rank < 0) continue
    const files = countFiles(root, dir)
    if (files === 0) continue
    hits.push({ dir, rank, files })
  }

  // Vocabulary order first, then population: a project part-way through a
  // rename has both `components/modules` and `blocks`, and the one with the
  // files in it is the one it actually uses.
  hits.sort((a, b) => a.rank - b.rank || b.files - a.files)
  return hits.map((h) => h.dir)
}

function walk(root: string, rel: string, depth: number, max: number): string[] {
  if (depth > max) return []
  const abs = rel ? join(root, rel) : root
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return []
  }

  const out: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.') || IGNORED.has(entry)) continue
    const child = rel ? `${rel}/${entry}` : entry
    try {
      if (!statSync(join(root, child)).isDirectory()) continue
    } catch {
      continue
    }
    out.push(child)
    out.push(...walk(root, child, depth + 1, max))
  }
  return out
}

/**
 * Source files, one level deep plus the folder-per-component spellings that
 * `files.ts` defines.
 *
 * Deliberately not "component-looking". The first cut required PascalCase and
 * a React extension, and missed a project whose `templates/pages`,
 * `templates/layouts` and `templates/partials` hold `home.hubl.html`,
 * `base.hubl.html` and `header.hubl.html` — the exact vocabulary, in the exact
 * shape, invisible because the files were lowercase HTML. A directory called
 * `pages` with pages in it is the pages directory whatever the templating
 * language is.
 */
function countFiles(root: string, dir: string): number {
  let entries: string[]
  try {
    entries = readdirSync(join(root, dir))
  } catch {
    return 0
  }

  let n = 0
  for (const entry of entries) {
    if (entry.startsWith('.') || IGNORED.has(entry)) continue
    const abs = join(root, dir, entry)
    try {
      const stat = statSync(abs)
      if (stat.isFile()) {
        if (SOURCE_FILE.test(entry)) n++
      } else if (stat.isDirectory() && folderComponent(join(root, dir), entry)) {
        // `<Name>/<Name>.*` as well as `<Name>/index.*`, in both spellings.
        // With only the first, a `src/modules` full of `Intro/Intro.tsx`
        // counted as empty and a second modules directory was proposed beside
        // the real one; `hero-banner/hero-banner.vue` is the same convention.
        n++
      }
    } catch {
      continue
    }
  }
  return n
}

/**
 * What kind of thing this design is, from what the designer called it.
 *
 * The name is the only signal available before anything is built, and it is a
 * good one: nobody names a modal "Section" or a footer "Card". Where it is
 * wrong, `plan` is a person's step and overrides it — which is the right place
 * for a judgment call, and the reason this is allowed to be a heuristic.
 */
export function inferKind(name: string, mode: 'component' | 'view' = 'component'): PlacementKind {
  if (mode === 'view') return 'view'
  const n = name.toLowerCase()

  if (/\b(modal|dialog|drawer|popover|popup|sheet|toast|snackbar|lightbox|overlay)\b/.test(n)) return 'overlay'
  if (/\b(header|footer|nav|navbar|navigation|sidebar|topbar|menu|breadcrumb)\b/.test(n)) return 'layout'
  if (/\b(page|view|screen|template|landing)\b/.test(n)) return 'view'
  if (/\b(button|btn|badge|chip|tag|input|field|icon|avatar|label|tooltip|spinner|divider)\b/.test(n)) return 'primitive'

  return 'module'
}

export function placementFor(placements: Placement[], kind: PlacementKind): Placement | null {
  return placements.find((p) => p.kind === kind) ?? null
}
