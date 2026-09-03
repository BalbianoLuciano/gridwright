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
import { join } from 'node:path'
import {
  DEFAULT_CONFIG, writeConfig, configPath, loadConfig, validateConfig,
  GITIGNORE_BLOCK, paths, type GridwrightConfig, type Framework,
} from '@gridwright/core'
import { ok, info, warn, fail, dim, table, bold } from '../ui.js'

export function init(root: string, opts: { force?: boolean } = {}): void {
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

  const lib = detectLibraryDir(root)
  if (lib) {
    config.library = { dir: lib, barrel: join(lib, 'index.ts'), registry: join(lib, 'registry.json') }
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

  for (const rel of ['src/style.css', 'src/styles.css', 'src/app.css', 'src/assets/css/app.css',
                     'resources/css/app.css', 'app/globals.css', 'styles/globals.css']) {
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

function ensureGitignore(root: string): void {
  const p = join(root, '.gitignore')
  const current = existsSync(p) ? readFileSync(p, 'utf8') : ''
  if (current.includes('.gridwright/runs')) return
  if (existsSync(p)) appendFileSync(p, GITIGNORE_BLOCK)
  else writeFileSync(p, GITIGNORE_BLOCK.trimStart())
  info('Added to .gitignore: runs/ and dashboard/ (baselines NOT — they are tests)')
}
