/**
 * The harness — an ephemeral Vite that renders one component, alone.
 *
 * It is generated inside the consuming project (`.gridwright/harness/`) rather
 * than in a temp directory, and that is not a detail: a component imports from
 * the project's `node_modules`, resolves the project's path aliases, and is
 * styled by the project's compiled CSS. Build it anywhere else and you are
 * measuring a component that never had its dependencies.
 *
 * Nothing survives the run. The directory is removed even when verification
 * throws, because a stray harness left in someone's repo looks like their code.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, isAbsolute, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ViteDevServer } from 'vite'
import type { Framework } from '@gridwright/core'

type CreateServer = typeof import('vite')['createServer']

export interface HarnessOptions {
  /** Root of the consuming project — where node_modules and the CSS live. */
  projectRoot: string
  framework: Framework
  /** Absolute path to the component file. */
  component: string
  /** Props passed to the component. Figma copy arrives here as defaults. */
  props?: Record<string, unknown>
  /**
   * How the component exports itself: `default`, or `named:Component`.
   *
   * The harness assumed `default` and mounted a project whose 38 modules
   * export a named `Component`. The failure surfaced as an esbuild error about
   * a missing default export, several layers below where the assumption was
   * made — and `init` had already detected the right answer and written it to
   * the config. It just was not being read.
   */
  exportShape?: string
  /** Stylesheets to load first, in order. Usually the project's compiled
   *  Tailwind output — without it every utility class is inert and the render
   *  is a column of unstyled text. */
  css?: string[]
  port?: number
  /**
   * Where to generate the harness. Defaults to `.gridwright/harness/`.
   *
   * A run passes its own directory: the default is deleted when a harness
   * starts and again when it closes, so two running at once took each other's
   * away mid-measurement.
   */
  dir?: string
}

export interface Harness {
  url: string
  close: () => Promise<void>
}

const DIR = '.gridwright/harness'

export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const dir = opts.dir ?? join(opts.projectRoot, DIR)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  writeFileSync(join(dir, 'index.html'), indexHtml())
  const stylesheet = tailwindSourceStylesheet(dir, opts.projectRoot, opts.css ?? [])
  if (stylesheet) writeFileSync(join(dir, 'harness.css'), stylesheet)
  const css = stylesheet ? [join(dir, 'harness.css')] : opts.css
  writeFileSync(join(dir, entryName(opts.framework)), entrySource({ ...opts, css }, dir))
  writeFileSync(join(dir, 'vite.config.mjs'), viteConfig(opts))

  let server: ViteDevServer
  try {
    const { createServer } = await loadVite(opts.projectRoot)
    server = await createServer({
      configFile: join(dir, 'vite.config.mjs'),
      root: dir,
      logLevel: 'error',
      server: {
        port: opts.port ?? 0,   // 0 lets the OS pick, so parallel runs do not collide
        strictPort: false,
        host: '127.0.0.1',
        // The component and its CSS live above the harness root. A stylesheet
        // the config names can live outside it altogether — a monorepo pointing
        // at `../../packages/ui/base.css` got a 403, the entry module failed to
        // load, and the page came back blank: scored as a component that
        // rendered nothing, which is worse than the unstyled render `verify.css`
        // exists to prevent.
        fs: { allow: harnessFsAllow(opts.projectRoot, opts.css ?? []) },
      },
    })
    await server.listen()
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }

  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : opts.port
  if (!port) {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
    throw new Error('Vite started but reported no port.')
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function indexHtml(): string {
  // No page margin and no max-width: the component's own box is what gets
  // measured, and a stray 8px body margin would shift every box in the render.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; }
      #gw-root { display: block; }
    </style>
  </head>
  <body>
    <div id="gw-root"></div>
    <script type="module" src="/${entryNamePlaceholder}"></script>
  </body>
</html>
`.replace(entryNamePlaceholder, ENTRY_TSX)
}

const ENTRY_TSX = 'entry.jsx'
const entryNamePlaceholder = '__ENTRY__'

function entryName(framework: Framework): string {
  return framework === 'vue3' ? 'entry.js' : ENTRY_TSX
}

/**
 * Mount code is the adapter's job (Law 8). Until the adapters exist as their
 * own package this is the whole of it, and it is deliberately the only place
 * in verify that knows a framework name.
 */
function entrySource(opts: HarnessOptions, dir: string): string {
  const componentPath = importPath(dir, opts.component)
  const cssImports = (opts.css ?? [])
    .map((c) => `import ${JSON.stringify(importPath(dir, c))}`)
    .join('\n')
  const props = JSON.stringify(opts.props ?? {})

  const named = opts.exportShape?.startsWith('named:')
    ? opts.exportShape.slice('named:'.length)
    : null
  const importLine = named
    ? `import { ${named} as Component } from ${JSON.stringify(componentPath)}`
    : `import Component from ${JSON.stringify(componentPath)}`

  if (opts.framework === 'vue3') {
    return `${cssImports}
import { createApp } from 'vue'
${importLine}

createApp(Component, ${props}).mount('#gw-root')
`
  }

  return `${cssImports}
import React from 'react'
import { createRoot } from 'react-dom/client'
${importLine}

createRoot(document.getElementById('gw-root')).render(
  React.createElement(Component, ${props}),
)
`
}

export function viteConfig(opts: Pick<HarnessOptions, 'projectRoot' | 'framework'>): string {
  // The plugin is resolved from the project, not from gridwright: the component
  // has to compile against the same React or Vue version the project ships.
  const plugin = opts.framework === 'vue3'
    ? "import plugin from '@vitejs/plugin-vue'"
    : "import plugin from '@vitejs/plugin-react'"

  // Tailwind v4 through its Vite plugin has no postcss config to find: the
  // project's own vite.config is what compiles it, and the harness does not
  // load that file. Without the plugin every utility class is inert and the
  // component renders as unstyled text, scoring as though it were wrong.
  const tailwind = projectDependsOn(opts.projectRoot, '@tailwindcss/vite')

  return `${plugin}
${tailwind ? "import tailwindcss from '@tailwindcss/vite'\n" : ''}import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [plugin()${tailwind ? ', tailwindcss()' : ''}],
  resolve: {
    alias: { '@': ${JSON.stringify(join(opts.projectRoot, 'src'))} },
    // Without this the component and the harness load two copies of the
    // framework, and the render silently comes up blank.
    dedupe: ['react', 'react-dom', 'vue'],
  },
})
`
}

/** The project, plus wherever the stylesheets it named actually live. */
export function harnessFsAllow(projectRoot: string, css: string[]): string[] {
  const allow = new Set([projectRoot])
  for (const sheet of css) allow.add(dirname(isAbsolute(sheet) ? sheet : join(projectRoot, sheet)))
  return [...allow]
}

/** Vite wants a relative specifier or an absolute path it can serve. */
function importPath(from: string, target: string): string {
  if (!isAbsolute(target)) return target
  const rel = relative(from, target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * Finds the project's stylesheet — the source, not the build output.
 *
 * This one cost a whole run. The harness loaded `styles/theme.css`, a compiled
 * Tailwind bundle from eight days earlier, and Tailwind only emits the classes
 * it finds while scanning `content`. A component written today was not in that
 * scan, so **none** of its classes existed: it rendered as unstyled text and
 * scored 30% while being correct.
 *
 * Nothing about that looks like a failure. The component appears, the words are
 * there, and every number is wrong.
 *
 * So a source file wins over a build output. Vite runs the project's own
 * postcss config, which means Tailwind rescans `content` and the component
 * being verified is in it — which is the entire point.
 */
export function findProjectCss(projectRoot: string): string[] {
  const candidates = [
    'styles/global.css', 'styles/theme.css',
    // src/index.css is where Vite's React template puts it, and where shadcn's
    // init writes its theme.
    // src/main.css is the other common spelling: the stylesheet named after
    // the `main.tsx` that imports it.
    'src/style.css', 'src/styles.css', 'src/app.css', 'src/index.css', 'src/main.css',
    'src/assets/css/app.css', 'resources/css/app.css',
    'app/globals.css', 'styles/globals.css', 'dist/output.css',
  ]

  const found: Array<{ path: string; source: boolean }> = []
  for (const rel of candidates) {
    const p = join(projectRoot, rel)
    if (!existsSync(p)) continue
    found.push({ path: p, source: isSourceStylesheet(p) })
  }
  if (found.length === 0) return []

  const preferred = canCompileCss(projectRoot) ? found.find((f) => f.source) : undefined
  return [(preferred ?? found[0]!).path]
}

/**
 * Whether the project can turn a source stylesheet into CSS on its own: a
 * postcss config, or Tailwind v4's Vite plugin, which `viteConfig` loads.
 *
 * Without one, a build output is the only stylesheet there is and preferring
 * the source would render nothing at all.
 */
export function canCompileCss(projectRoot: string): boolean {
  return ['postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts']
    .some((c) => existsSync(join(projectRoot, c)))
    || projectDependsOn(projectRoot, '@tailwindcss/vite')
}

/**
 * The stylesheets to render with: the ones the project names, or the search.
 *
 * The search is a fixed list of names, and a project is free to call its
 * stylesheet anything. One that called it `src/main.css` rendered every
 * component as unstyled text — nothing failed, the score was simply wrong — and
 * the only way out was to add a file under a name the list knew. `verify.css`
 * in the config is that way out, and it is data (Law 9).
 *
 * A configured path that does not exist comes back in `missing` rather than
 * being skipped: falling through to the search would hide a typo behind a
 * plausible render.
 *
 * `stale` is the other half of that. Naming a path skips the search, and with
 * it the rule the search exists to enforce — a build output is a snapshot of
 * the classes that existed when it was built, so a component written today
 * renders unstyled and scores 30% while being correct. Pointing `verify.css`
 * at `dist/output.css` is a plausible thing to do, so it is said out loud
 * rather than refused: the project may have a reason, and it may also have a
 * source file that would have been compiled on the spot.
 */
export function resolveProjectCss(
  projectRoot: string,
  configured?: string[],
): { css: string[]; missing: string[]; stale: string[] } {
  if (!configured || configured.length === 0) {
    return { css: findProjectCss(projectRoot), missing: [], stale: [] }
  }

  const css: string[] = []
  const missing: string[] = []
  const stale: string[] = []
  const canCompile = canCompileCss(projectRoot)
  for (const rel of configured) {
    const abs = isAbsolute(rel) ? rel : join(projectRoot, rel)
    if (!existsSync(abs)) {
      missing.push(rel)
      continue
    }
    css.push(abs)
    if (canCompile && !isSourceStylesheet(abs)) stale.push(rel)
  }
  return { css, missing, stale }
}

/** A stylesheet that still has to be built: it declares Tailwind rather than
 *  containing its output. */
function isSourceStylesheet(path: string): boolean {
  try {
    const src = readFileSync(path, 'utf8')
    return /@tailwind\b|@import\s+['"]tailwindcss/.test(src)
  } catch {
    return false
  }
}

/**
 * Vite as the project has it, not as gridwright does.
 *
 * The generated config imports the project's framework plugin, and that plugin
 * is built for the project's Vite. Serving it with gridwright's own Vite 6 put
 * a Vite 8 project's `@vitejs/plugin-react` — rolldown-only — inside a Vite 6
 * server: "Missing field `moduleType`", a blank page, and "rendered nothing at
 * 375px" about a component that compiled. gridwright's copy is the fallback for
 * a project that has no Vite of its own.
 */
export async function loadVite(projectRoot: string): Promise<{ createServer: CreateServer; from: 'project' | 'gridwright' }> {
  const entry = resolveProjectModule(projectRoot, 'vite')
  if (entry) {
    const mod = await import(pathToFileURL(entry).href) as { createServer: CreateServer }
    return { createServer: mod.createServer, from: 'project' }
  }
  const mod = await import('vite')
  return { createServer: mod.createServer, from: 'gridwright' }
}

/** The ESM entry of a package installed in the project, or null. */
export function resolveProjectModule(projectRoot: string, name: string): string | null {
  const pkgPath = projectPackageJson(projectRoot, name)
  if (!pkgPath) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      exports?: unknown; module?: string; main?: string
    }
    const exp = pkg.exports && typeof pkg.exports === 'object' && '.' in pkg.exports
      ? (pkg.exports as Record<string, unknown>)['.']
      : pkg.exports
    const entry = exportTarget(exp) ?? pkg.module ?? pkg.main
    return entry ? join(dirname(pkgPath), entry) : null
  } catch {
    return null
  }
}

/**
 * Node's lookup, minus NODE_PATH.
 *
 * `createRequire(...).resolve` consults NODE_PATH, and the pnpm shim that
 * launches `gw` sets it to gridwright's own store — so a project with no Vite
 * of its own resolved gridwright's Vite 5 and reported it as the project's.
 * Walking up `node_modules` from the project is the part of the algorithm that
 * is actually about the project.
 */
function projectPackageJson(projectRoot: string, name: string): string | null {
  let dir = projectRoot
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The file an `exports` entry points at for `import`. */
function exportTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const conditions = entry as Record<string, unknown>
    for (const key of ['import', 'node', 'default']) {
      const target = exportTarget(conditions[key])
      if (target) return target
    }
  }
  return undefined
}

/** Whether the project declares a package, in either dependency list. */
export function projectDependsOn(projectRoot: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    return [pkg.dependencies, pkg.devDependencies].some((deps) => deps !== undefined && name in deps)
  } catch {
    return false
  }
}

/**
 * The stylesheet the harness loads when the project is on Tailwind v4.
 *
 * v4 decides which classes to generate by scanning from its base, and under
 * Vite the base is the Vite root — `.gridwright/harness`, which is gitignored
 * and holds nothing but the entry. The component lives in the project's `src/`,
 * so not one of its classes was generated: the theme and the font loaded, and
 * the render was a column of unstyled text beside full-size images, scored as
 * a layout 1,250px off.
 *
 * Wrapping the project's stylesheet and pointing `@source` at the project root
 * puts the component back in the scan; the project's .gitignore still keeps
 * node_modules out of it. Null when no stylesheet is v4 — v3 reads `content`
 * from its own config and needs none of this.
 */
export function tailwindSourceStylesheet(dir: string, projectRoot: string, css: string[]): string | null {
  const v4 = css.some((c) => {
    try {
      return /@import\s+['"]tailwindcss['"]/.test(readFileSync(c, 'utf8'))
    } catch {
      return false
    }
  })
  if (!v4) return null

  const imports = css.map((c) => `@import ${JSON.stringify(importPath(dir, c))};`)
  return `${imports.join('\n')}\n@source ${JSON.stringify(relative(dir, projectRoot) || '.')};\n`
}
