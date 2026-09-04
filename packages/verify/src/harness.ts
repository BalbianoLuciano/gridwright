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

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import type { Framework } from '@gridwright/core'

export interface HarnessOptions {
  /** Root of the consuming project — where node_modules and the CSS live. */
  projectRoot: string
  framework: Framework
  /** Absolute path to the component file. */
  component: string
  /** Props passed to the component. Figma copy arrives here as defaults. */
  props?: Record<string, unknown>
  /** Stylesheets to load first, in order. Usually the project's compiled
   *  Tailwind output — without it every utility class is inert and the render
   *  is a column of unstyled text. */
  css?: string[]
  port?: number
}

export interface Harness {
  url: string
  close: () => Promise<void>
}

const DIR = '.gridwright/harness'

export async function startHarness(opts: HarnessOptions): Promise<Harness> {
  const dir = join(opts.projectRoot, DIR)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  writeFileSync(join(dir, 'index.html'), indexHtml())
  writeFileSync(join(dir, entryName(opts.framework)), entrySource(opts, dir))
  writeFileSync(join(dir, 'vite.config.mjs'), viteConfig(opts))

  let server: ViteDevServer
  try {
    server = await createServer({
      configFile: join(dir, 'vite.config.mjs'),
      root: dir,
      logLevel: 'error',
      server: {
        port: opts.port ?? 0,   // 0 lets the OS pick, so parallel runs do not collide
        strictPort: false,
        host: '127.0.0.1',
        // The component and its CSS live above the harness root.
        fs: { allow: [opts.projectRoot] },
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

  if (opts.framework === 'vue3') {
    return `${cssImports}
import { createApp } from 'vue'
import Component from ${JSON.stringify(componentPath)}

createApp(Component, ${props}).mount('#gw-root')
`
  }

  return `${cssImports}
import React from 'react'
import { createRoot } from 'react-dom/client'
import Component from ${JSON.stringify(componentPath)}

createRoot(document.getElementById('gw-root')).render(
  React.createElement(Component, ${props}),
)
`
}

function viteConfig(opts: HarnessOptions): string {
  // The plugin is resolved from the project, not from gridwright: the component
  // has to compile against the same React or Vue version the project ships.
  const plugin = opts.framework === 'vue3'
    ? "import plugin from '@vitejs/plugin-vue'"
    : "import plugin from '@vitejs/plugin-react'"

  return `${plugin}
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [plugin()],
  resolve: {
    alias: { '@': ${JSON.stringify(join(opts.projectRoot, 'src'))} },
    // Without this the component and the harness load two copies of the
    // framework, and the render silently comes up blank.
    dedupe: ['react', 'react-dom', 'vue'],
  },
})
`
}

/** Vite wants a relative specifier or an absolute path it can serve. */
function importPath(from: string, target: string): string {
  if (!isAbsolute(target)) return target
  const rel = relative(from, target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * Guesses the project's compiled stylesheet.
 *
 * A component styled with Tailwind renders as unstyled text without it, and
 * every measurement is then wrong in a way that looks like the component's
 * fault. Better to find it automatically and say which one was used.
 */
export function findProjectCss(projectRoot: string): string[] {
  const candidates = [
    'styles/theme.css', 'styles/global.css',
    'src/style.css', 'src/styles.css', 'src/app.css',
    'src/assets/css/app.css', 'resources/css/app.css',
    'app/globals.css', 'styles/globals.css', 'dist/output.css',
  ]
  for (const rel of candidates) {
    const p = join(projectRoot, rel)
    if (existsSync(p)) return [p]
  }
  return []
}
