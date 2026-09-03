/**
 * `gw init` — configuración del proyecto consumidor. Una vez por repo.
 *
 * Detecta lo que puede en vez de preguntar: el framework sale del package.json
 * y el destino de los tokens se busca, no se asume. Prolicht corre Tailwind
 * 4.1.18 Y tiene tailwind.config.js con theme.extend a la vez; preguntar "qué
 * versión de Tailwind usás" daría la respuesta equivocada.
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
    warn(`Ya existe ${configPath(root)}`)
    if (existing) showConfig(existing)
    console.log(dim('\n  Usá `gw init --force` para regenerarlo.'))
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
  if (errors.length) fail('El config generado es inválido:', errors.join('\n'))

  const path = writeConfig(root, config)
  mkdirSync(paths.baselines(root), { recursive: true })
  ensureGitignore(root)

  ok(`Escrito ${path}`)
  showConfig(config)
  console.log(dim('\n  Revisalo antes de la primera corrida: todo esto es dato, no código (Ley 9).'))
}

function showConfig(c: GridwrightConfig): void {
  console.log()
  console.log(bold('  Configuración'))
  table([
    ['framework', c.framework],
    ['library', c.library.dir],
    ['tokens', `${c.tokens.target}${c.tokens.file ? ` → ${c.tokens.file}` : ''}`],
    ['viewports', c.verify.viewports.map((v) => `${v.name}:${v.width}`).join(' ')],
    ['umbral', `${c.verify.threshold} (peor viewport)`],
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
  info(dim('No pude detectar el framework; asumo vue3. Cambialo en el config si no es.'))
  return 'vue3'
}

/**
 * Buscamos dónde están declarados los tokens que YA existen, no qué versión de
 * la herramienta está instalada. Son cosas distintas y el mundo real las mezcla.
 */
function detectTokenTarget(root: string): { target: GridwrightConfig['tokens']['target']; file: string } | null {
  for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    const src = readFileSync(p, 'utf8')
    // Un config que sólo tiene `content` no declara tokens: no sirve de destino.
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
  info('Agregado a .gitignore: runs/ y dashboard/ (baselines NO — son tests)')
}
