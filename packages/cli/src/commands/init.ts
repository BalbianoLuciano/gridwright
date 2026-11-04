/**
 * `gw init` — configuration for the consuming project. Once per repo.
 *
 * It detects what it can instead of asking: the framework comes from
 * package.json, and the token destination is searched for rather than assumed.
 * A project can run Tailwind 4 AND still have a tailwind.config.js with
 * theme.extend; asking "which Tailwind version do you use" would give the wrong
 * answer.
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, resolve, isAbsolute } from 'node:path'
import {
  DEFAULT_CONFIG, writeConfig, configPath, loadConfig, validateConfig,
  gitignoreBlock, paths, type GridwrightConfig, type Framework,
} from '@gridwright/core'
import { detectConventions, KIND_LABEL, PLACEMENT_KINDS, type Placement, type PlacementKind } from '@gridwright/library'
import { ok, info, warn, fail, dim, table, bold, green, confirm, promptLine } from '../ui.js'

export interface InitOptions {
  force?: boolean
  yes?: boolean
  /** `--library <dir>`: the library directory, instead of the detected one. */
  library?: string
  /** `--placement <kind>=<dir>`, one entry per occurrence of the flag. */
  placements?: string[]
}

/**
 * Turns `--placement kind=dir` values into placements the person has answered.
 *
 * Marked `asked`, the same as a choice made at the prompt, so the shapes of the
 * directories they name are read again. Throws rather than exiting so a bad
 * flag is reported by the one handler in `index.ts`, before anything is written.
 */
export function parsePlacementFlags(raw: string[]): Placement[] {
  const out: Placement[] = []
  for (const entry of raw) {
    const eq = entry.indexOf('=')
    const kind = eq === -1 ? entry : entry.slice(0, eq)
    const dir = eq === -1 ? '' : normalizeDir(entry.slice(eq + 1), '--placement')
    if (!kind || !dir) {
      throw new Error(`--placement needs <kind>=<dir>, got "${entry}". Example: --placement view=resources/js/views`)
    }
    if (!(PLACEMENT_KINDS as string[]).includes(kind)) {
      throw new Error(`unknown placement kind "${kind}" in --placement. Kinds: ${PLACEMENT_KINDS.join(', ')}`)
    }
    // Two answers for one kind cannot both hold, and keeping the last would be
    // the same silent loss the repeatable parser exists to avoid.
    if (out.some((p) => p.kind === kind)) {
      throw new Error(`--placement was given twice for "${kind}"; a kind goes in one directory`)
    }
    out.push({ kind: kind as PlacementKind, dir, from: 'asked' })
  }
  return out
}

/**
 * Same cleanup the prompt applies to a typed path: relative to the root, no
 * leading `./` and no trailing slash — and a refusal for what it cannot clean.
 *
 * It was `.replace(/^\.?\//, '')`, which strips the leading slash off an
 * absolute path rather than refusing it: `--library "$(pwd)/src/ui"` wrote
 * `Users/me/app/src/ui` into the config, a relative path that is not there,
 * and `init` still printed `Wrote …`. Nothing validates these — `validateConfig`
 * checks the verify weights and the viewports — so the first sign was `author`
 * failing with a directory nobody had typed. A pasted absolute path is the
 * likeliest way to get this flag wrong, and `detectLibraryDir` only ever
 * returns directories that exist, so the flag was weaker than what it replaces.
 */
function normalizeDir(dir: string, flag: string): string {
  const given = dir.trim()
  if (isAbsolute(given) || /^[A-Za-z]:[\\/]/.test(given)) {
    throw new Error(`${flag} takes a path relative to the project root, got "${given}"`)
  }
  const clean = given.replace(/^\.?\//, '').replace(/\/+$/, '')
  if (clean.split('/').includes('..')) {
    throw new Error(`${flag} cannot leave the project root, got "${given}"`)
  }
  return clean
}

export async function init(root: string, opts: InitOptions = {}): Promise<void> {
  // Before anything is read or written: a typo in a flag should cost nothing.
  const given = parsePlacementFlags(opts.placements ?? [])
  const libraryFlag = opts.library === undefined ? undefined : normalizeDir(opts.library, '--library')
  if (libraryFlag === '') throw new Error('--library needs a directory, e.g. --library src/components/ui')

  if (existsSync(configPath(root)) && !opts.force) {
    const existing = loadConfig(root)
    warn(`${configPath(root)} already exists`)
    if (existing) showConfig(existing)
    console.log(dim('\n  Use `gw init --force` to regenerate it.'))
    return
  }

  const config: GridwrightConfig = { ...DEFAULT_CONFIG, framework: detectFramework(root) }

  const tokenFile = detectTokenTarget(root)
  if (tokenFile) {
    config.tokens = { ...config.tokens, target: tokenFile.target, file: tokenFile.file }
  }

  // The detection is a fixed list and the first hit wins, so in a monorepo it
  // picks the portal's directory over the module's. The flag is the way to say
  // which one is right without rewriting the config by hand.
  const lib = libraryFlag ?? detectLibraryDir(root)
  if (lib) {
    config.library = { dir: lib, barrel: join(lib, 'index.ts'), registry: join(lib, 'registry.json') }
  }
  if (libraryFlag && !existsSync(join(root, libraryFlag))) {
    warn(`--library ${libraryFlag} does not exist — no shape can be read from it`)
  }

  // Where a component goes is half the question; how it is written is the
  // other half, and the answer is in the components already there.
  //
  // The library directory goes in by name. `detectConventions` reads a fixed
  // list plus the placement directories, and `--library` sets no placement — so
  // a library the fixed list does not know, which is the only reason to pass
  // the flag, had no shape read from it at all. `verify` then matched the
  // component against the portal's shape and `library:register` omitted the
  // export shape: the harness mounting `default` in a project that exports a
  // name, which is the failure the comment in `conventions.ts` is about.
  const alsoRead = lib ? [lib] : []
  const conventions = detectConventions(root, undefined, alsoRead)

  // The one thing gridwright is allowed to ask about. Everything else here is
  // inferred, because a question whose answer is in the repo is a question that
  // goes stale. A project's directory vocabulary is not in the repo in any
  // reliable way: `modules`, `blocks`, `sections`, `partials`, `layouts` — every
  // ecosystem picks a few and no two pick the same few, and guessing silently
  // is how a header ends up filed as a page module.
  conventions.placements = await setupPlacements(root, conventions.placements, opts.yes ?? false, given)

  // Read the shapes again from the directories that are actually going into
  // the config. A person who picks `templates/partials` over the detected
  // `templates/layouts` was leaving the config with a shape for the directory
  // they turned down and none for the one they chose — and a missing shape is
  // how the harness ends up mounting `default` in a project that exports a name.
  if (conventions.placements.some((p) => p.from === 'asked')) {
    const settled = detectConventions(root, conventions.placements, alsoRead)
    conventions.shapes = settled.shapes
    conventions.importExtension = settled.importExtension
  }

  if (conventions.shapes.length > 0 || conventions.docs.length > 0 || conventions.placements.length > 0) {
    config.conventions = conventions
  }

  const errors = validateConfig(config)
  if (errors.length) fail('The generated config is invalid:', errors.join('\n'))

  const path = writeConfig(root, config)
  mkdirSync(paths.baselines(root), { recursive: true })
  ensureGitignore(root)

  ok(`Wrote ${path}`)
  showConfig(config)
  console.log(dim('\n  Review it before the first run: all of this is data, not code (Law 9).'))
}

/**
 * Confirms where each kind of thing goes, and asks about what was not found.
 *
 * Shown as a list rather than asked one blind question at a time: the answers
 * are related — someone who puts modules in `blocks/` rarely puts views in
 * `views/` — and seeing the set is what makes the odd one out obvious.
 *
 * A directory that does not exist yet is fine and is not created here. It is
 * an intention, and `author` makes it when there is finally something to put
 * in it.
 */
async function setupPlacements(
  root: string,
  proposed: Placement[],
  acceptAll: boolean,
  given: Placement[] = [],
): Promise<Placement[]> {
  // What was passed on the command line is already answered: it replaces the
  // detection for that kind, and is not asked about again.
  const detected = proposed.map((p) => given.find((g) => g.kind === p.kind) ?? p)
  const found = detected.filter((p) => p.from === 'found')
  // Not `from === 'absent'`: a placement given by flag is `asked`, so the one
  // line of `--yes` output that says which of these paths are intentions rather
  // than facts was leaving out exactly the ones the person had just typed.
  const missing = detected.filter((p) => p.from === 'absent' || !existsSync(join(root, p.dir)))

  console.log()
  console.log(`  ${bold('Where each kind of thing goes')}`)
  for (const p of detected) {
    const mark = p.from === 'found' ? green('found') : p.from === 'asked' ? green(' flag') : dim('  new')
    console.log(`    ${mark}  ${p.dir.padEnd(26)} ${dim(KIND_LABEL[p.kind])}`)
    // The runner-up is often the right answer and the tool cannot tell: a repo
    // with both `templates/layouts` and `templates/partials` keeps its page
    // shell in one and its header and footer in the other.
    if (p.alternatives?.length) {
      console.log(dim(`             or ${p.alternatives.join(', ')}`))
    }
  }

  if (acceptAll || !process.stdin.isTTY) {
    if (missing.length > 0) {
      console.log(dim(`\n  ${missing.length} of these do not exist yet — they are created when something needs them.`))
      console.log(dim('  Change any of them in gridwright.config.json (Law 9).'))
    }
    return detected
  }

  // Nothing left to ask when every kind came from a flag.
  if (given.length === detected.length) return detected

  console.log()
  const change = await confirm('  Change any of these?')
  if (!change) {
    console.log(dim(`  Kept. ${found.length} found in the repo, ${missing.length} proposed.`))
    return detected
  }

  // Choices, not a blank to fill. Every directory worth offering is already
  // known — the one detected and any runner-up — so the person picks a number,
  // and typing a path is left for the one case where none of them is right.
  console.log(dim('\n  Pick a number; Enter keeps the first.'))
  const out: Placement[] = []
  for (const p of detected) {
    if (given.some((g) => g.kind === p.kind)) { out.push(p); continue }
    const choices = [p.dir, ...(p.alternatives ?? [])]
    console.log(`\n  ${KIND_LABEL[p.kind]}`)
    choices.forEach((c, i) => {
      const note = i === 0 ? (p.from === 'found' ? 'found' : 'proposed') : 'also found'
      console.log(`    ${i + 1}) ${c.padEnd(28)} ${dim(note)}`)
    })
    console.log(`    ${choices.length + 1}) ${dim('somewhere else…')}`)

    const n = parseInt(await promptLine(`    ${dim('→')} `, '1'), 10)
    if (n >= 1 && n <= choices.length) {
      out.push(n === 1 ? p : { kind: p.kind, dir: choices[n - 1]!, from: 'asked' })
    } else if (n === choices.length + 1) {
      const typed = await promptLine(`    path ${dim('→')} `, p.dir)
      out.push(typed === p.dir ? p : { kind: p.kind, dir: typed.replace(/^\.?\//, ''), from: 'asked' })
    } else {
      out.push(p)
    }
  }
  return out
}

function showConfig(c: GridwrightConfig): void {
  console.log()
  console.log(bold('  Configuration'))
  table([
    ['framework', c.framework],
    ['library', c.library.dir],
    ['tokens', `${c.tokens.target}${c.tokens.file ? ` → ${c.tokens.file}` : ''}`],
    ['viewports', c.verify.viewports.map((v) => `${v.name}:${v.width}`).join(' ')],
    ['threshold', `${c.verify.threshold} (worst viewport)`],
  ])

  for (const s of c.conventions?.shapes ?? []) {
    const extras = s.alsoExports.length ? ` + ${s.alsoExports.join(', ')}` : ''
    console.log(dim(`    ${s.dir.padEnd(22)} ${s.file}  ${s.export}${extras}  (${s.seenIn})`))
  }
  for (const p of c.conventions?.placements ?? []) {
    console.log(dim(`    ${p.kind.padEnd(10)} ${p.dir}`))
  }
  if (c.conventions?.breakpoints?.length) {
    console.log(dim(`    breakpoints: ${c.conventions.breakpoints.map((b) => b.name).join(' ')}`))
  }
  if (c.conventions?.docs.length) {
    console.log(dim(`    ${c.conventions.docs.length} convention docs found`))
  }
}

function readPackageJson(root: string): Record<string, any> | null {
  const p = join(root, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function detectFramework(root: string): Framework {
  const pkg = readPackageJson(root)
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  if (deps.vue) return 'vue3'
  if (deps.react) return 'react19'
  info(dim('Could not detect the framework; assuming vue3. Change it in the config if that is wrong.'))
  return 'vue3'
}

/**
 * We look for where the EXISTING tokens are declared, not which version of the
 * tool is installed. Those are different questions and the real world mixes
 * them.
 */
function detectTokenTarget(root: string): { target: GridwrightConfig['tokens']['target']; file: string } | null {
  for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    // A config that only has `content` declares no tokens: useless as a target.
    if (/theme\s*:/.test(src) || /extend\s*:/.test(src)) {
      return { target: 'tailwind-config', file: name }
    }
  }

  // `src/index.css` first: it is where Vite's React template and shadcn both
  // put Tailwind, and it was not on this list — so a stock Vite + shadcn project
  // came out with no token system at all, and every value in a design was
  // proposed as new.
  for (const rel of ['src/index.css', 'src/globals.css', 'src/global.css', 'src/style.css', 'src/styles.css',
                     'src/app.css', 'src/assets/css/app.css', 'resources/css/app.css',
                     'app/globals.css', 'app/app.css', 'styles/globals.css']) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    if (/@theme\b/.test(src)) return { target: 'tailwind-theme', file: rel }
    if (/--[a-z0-9-]+\s*:/i.test(src)) return { target: 'css-vars', file: rel }
  }

  return null
}

function detectLibraryDir(root: string): string | null {
  for (const rel of ['src/components/ui', 'resources/js/Components', 'src/components',
                     'app/components', 'components/ui', 'components']) {
    if (existsSync(join(root, rel))) return rel
  }
  return null
}

/**
 * Finds the .gitignore that should hold our entries, walking up to the repo
 * root.
 *
 * Writing a fresh .gitignore next to the config looks harmless until the
 * project is nested: santillanafrancais keeps its theme in
 * src/theme/<name>/, and doing that dropped a second, near-empty .gitignore
 * into the repo when a perfectly good one already sat at the top.
 *
 * Returns the file to append to and the project's path relative to it, since
 * gitignore patterns resolve against their own file.
 */
export function findGitignore(root: string): { file: string; prefix: string } {
  let dir = resolve(root)
  let prefix = ''
  for (let up = 0; up < 20; up++) {
    const candidate = join(dir, '.gitignore')
    if (existsSync(candidate)) return { file: candidate, prefix }

    // Stop at the repo boundary: past it we would be touching someone else's
    // ignore file.
    if (existsSync(join(dir, '.git'))) break

    const parent = dirname(dir)
    if (parent === dir) break
    prefix = prefix ? `${basename(dir)}/${prefix}` : basename(dir)
    dir = parent
  }
  // Nothing to reuse — create one at the project itself.
  return { file: join(root, '.gitignore'), prefix: '' }
}

function ensureGitignore(root: string): void {
  const { file, prefix } = findGitignore(root)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const block = gitignoreBlock(prefix)
  if (current.includes(`${prefix ? prefix + '/' : ''}.gridwright/runs`)) return

  if (existsSync(file)) appendFileSync(file, block)
  else writeFileSync(file, block.trimStart())

  const where = file === join(root, '.gitignore') ? '.gitignore' : file
  info(`Added to ${where}: runs/ and dashboard/ (baselines NOT — they are tests)`)
}
