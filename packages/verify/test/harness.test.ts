import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findProjectCss, resolveProjectCss, harnessFsAllow, projectDependsOn, resolveProjectModule,
  tailwindSourceStylesheet, viteConfig, indexHtml, entryName, resolveProjectAliases, freePort,
} from '../src/harness.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gw-harness-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const file = (rel: string, body: string) => {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
}

const packageJson = (deps: Record<string, string>, devDeps: Record<string, string> = {}) =>
  file('package.json', JSON.stringify({ name: 'app', dependencies: deps, devDependencies: devDeps }))

/**
 * A Vite 8 + Tailwind v4 project — the shape `npm create vite` and `shadcn init`
 * produce today — could not be rendered at all. The harness served the
 * project's `@vitejs/plugin-react` 6 with gridwright's own Vite 6 and failed on
 * "Missing field `moduleType`"; had it got past that, it would have found no
 * stylesheet in `src/index.css`, and with no postcss config it would not have
 * compiled Tailwind anyway. Three separate ways to report a correct component
 * as rendering nothing.
 */
describe('rendering a Vite 8 + Tailwind v4 project', () => {
  it('reads the dependency from either list', () => {
    packageJson({ react: '^19' }, { '@tailwindcss/vite': '^4' })
    expect(projectDependsOn(root, '@tailwindcss/vite')).toBe(true)
    expect(projectDependsOn(root, 'vue')).toBe(false)
  })

  it('has no dependencies when there is no package.json', () => {
    expect(projectDependsOn(root, 'vite')).toBe(false)
  })

  it('resolves the project\'s own Vite, through its exports', () => {
    packageJson({}, { vite: '^8' })
    file('node_modules/vite/package.json', JSON.stringify({
      name: 'vite', type: 'module',
      exports: { '.': './dist/node/index.js', './package.json': './package.json' },
    }))
    expect(resolveProjectModule(root, 'vite')).toBe(join(root, 'node_modules/vite/dist/node/index.js'))
  })

  it('takes the import condition when exports are conditional', () => {
    packageJson({ lib: '^1' })
    file('node_modules/lib/package.json', JSON.stringify({
      name: 'lib',
      exports: { '.': { types: './index.d.ts', import: './esm.js', require: './cjs.cjs' } },
    }))
    expect(resolveProjectModule(root, 'lib')).toBe(join(root, 'node_modules/lib/esm.js'))
  })

  it('reports a package the project does not have as missing', () => {
    packageJson({})
    expect(resolveProjectModule(root, 'vite')).toBeNull()
  })

  it('loads the Tailwind Vite plugin when the project compiles Tailwind with it', () => {
    packageJson({}, { '@tailwindcss/vite': '^4', '@vitejs/plugin-react': '^6' })
    const config = viteConfig({ projectRoot: root, framework: 'react19' })
    expect(config).toContain("import tailwindcss from '@tailwindcss/vite'")
    expect(config).toContain('plugins: [plugin(), tailwindcss()]')
  })

  it('leaves the plugin out when the project does not use it', () => {
    packageJson({}, { '@vitejs/plugin-react': '^6' })
    const config = viteConfig({ projectRoot: root, framework: 'react19' })
    expect(config).not.toContain('tailwindcss')
    expect(config).toContain('plugins: [plugin()]')
  })

  it('finds src/index.css and prefers it as source when the Vite plugin compiles it', () => {
    packageJson({}, { '@tailwindcss/vite': '^4' })
    file('src/index.css', '@import "tailwindcss";\n')
    file('dist/output.css', '.p-4{padding:1rem}\n')
    expect(findProjectCss(root)).toEqual([join(root, 'src/index.css')])
  })

  // A Vite + Tailwind 3 project whose stylesheet is `src/main.css`. No name on
  // the list matched, so the harness loaded nothing and a correct component
  // rendered as unstyled text.
  it('finds src/main.css', () => {
    packageJson({})
    file('postcss.config.js', 'export default {}\n')
    file('src/main.css', '@tailwind base;\n')
    expect(findProjectCss(root)).toEqual([join(root, 'src/main.css')])
  })

  it('takes the stylesheets the config names over the search', () => {
    file('src/index.css', '@tailwind base;\n')
    file('src/theme/site.css', '@tailwind base;\n')
    expect(resolveProjectCss(root, ['src/theme/site.css']))
      .toEqual({ css: [join(root, 'src/theme/site.css')], missing: [], stale: [] })
    expect(resolveProjectCss(root)).toEqual({ css: [join(root, 'src/index.css')], missing: [], stale: [] })
  })

  // Naming a path skips the search, and with it the rule the search is there
  // to enforce. A build output holds the classes that existed when it was
  // built, which is the run that scored 30% on a correct component.
  it('says so when a configured stylesheet is a build output it could compile itself', () => {
    packageJson({})
    file('postcss.config.js', 'export default {}\n')
    file('src/index.css', '@tailwind base;\n')
    file('dist/output.css', '.px-4 { padding: 1rem }\n')

    expect(resolveProjectCss(root, ['dist/output.css']))
      .toEqual({ css: [join(root, 'dist/output.css')], missing: [], stale: ['dist/output.css'] })

    // Nothing to compile it with: the build output is the only stylesheet
    // there is, and preferring a source would render nothing at all.
    const bare = mkdtempSync(join(tmpdir(), 'gw-bare-'))
    mkdirSync(join(bare, 'dist'), { recursive: true })
    writeFileSync(join(bare, 'dist/output.css'), '.px-4 { padding: 1rem }\n')
    expect(resolveProjectCss(bare, ['dist/output.css']).stale).toEqual([])
    rmSync(bare, { recursive: true, force: true })
  })

  // Falling back to the search would hide the typo behind a plausible render.
  it('reports a configured stylesheet that is not there instead of searching', () => {
    file('src/index.css', '@tailwind base;\n')
    expect(resolveProjectCss(root, ['src/mian.css']))
      .toEqual({ css: [], missing: ['src/mian.css'], stale: [] })
  })

  // Vite serves what it is allowed to read. A sheet outside the project got a
  // 403 and the page came back blank — a worse failure than the one the
  // config field exists to prevent.
  it('lets Vite read a stylesheet that lives outside the project', () => {
    const outside = join(root, '..', 'shared', 'base.css')
    expect(harnessFsAllow(root, [outside])).toContain(join(root, '..', 'shared'))
    expect(harnessFsAllow(root, [])).toEqual([root])
  })

  it('still prefers a build output when nothing can compile the source', () => {
    packageJson({})
    file('src/index.css', '@import "tailwindcss";\n')
    file('dist/output.css', '.p-4{padding:1rem}\n')
    // Candidate order puts src/index.css first; without a compiler it is the
    // first found that wins, as before.
    expect(findProjectCss(root)).toEqual([join(root, 'src/index.css')])
    rmSync(join(root, 'src/index.css'))
    expect(findProjectCss(root)).toEqual([join(root, 'dist/output.css')])
  })

  it('points Tailwind v4 at the project, since the harness root is not where the component lives', () => {
    file('src/index.css', '@import "tailwindcss";\n@theme inline {}\n')
    const dir = join(root, '.gridwright/harness')
    const css = tailwindSourceStylesheet(dir, root, [join(root, 'src/index.css')])
    expect(css).toBe('@import "../../src/index.css";\n@source "../..";\n')
  })

  it('leaves a Tailwind v3 or compiled stylesheet alone', () => {
    file('src/app.css', '@tailwind base;\n@tailwind utilities;\n')
    file('dist/output.css', '.p-4{padding:1rem}\n')
    const dir = join(root, '.gridwright/harness')
    expect(tailwindSourceStylesheet(dir, root, [join(root, 'src/app.css')])).toBeNull()
    expect(tailwindSourceStylesheet(dir, root, [join(root, 'dist/output.css')])).toBeNull()
    expect(tailwindSourceStylesheet(dir, root, [])).toBeNull()
  })
})

/**
 * `gw verify` on a Vue component failed every time with "The component
 * rendered nothing". The page loaded `/entry.jsx` while the Vue entry is
 * written as `entry.js`: Vite answered 404 for the module, the app never
 * mounted, and a correct component was scored as an empty one.
 */
describe('the page loads the entry the harness actually writes', () => {
  const loaded = (html: string) => /<script type="module" src="\/([^"]+)"/.exec(html)?.[1]

  it.each(['vue3', 'react19'] as const)('names the %s entry in the page', (framework) => {
    expect(loaded(indexHtml(framework))).toBe(entryName(framework))
  })

  it('keeps the two frameworks on different entry files', () => {
    expect(entryName('vue3')).toBe('entry.js')
    expect(entryName('react19')).toBe('entry.jsx')
  })
})

/**
 * The harness only knew `@` -> `<root>/src`. A project that imports through
 * `@modules/programs/...` (and whose `@` is not `src` at all) failed to resolve
 * every such import, and the render came back blank. The project already says
 * where its aliases point, in `tsconfig.json` `paths`; the harness does not
 * load the project's own vite.config, so that is where they are read from.
 */
describe('resolving the project\'s path aliases', () => {
  const tsconfig = (body: string) => file('tsconfig.json', body)

  it('reads `paths` wildcards as prefix aliases, relative to the tsconfig', () => {
    tsconfig(JSON.stringify({ compilerOptions: { paths: {
      '@modules/programs/*': ['./Modules/Programs/resources/js/*'],
      '@/*': ['./resources/js/*'],
    } } }))
    expect(resolveProjectAliases(root)).toEqual({
      '@modules/programs': join(root, 'Modules/Programs/resources/js'),
      '@': join(root, 'resources/js'),
    })
  })

  it('resolves against baseUrl when there is one', () => {
    tsconfig(JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '~/*': ['app/*'] } } }))
    expect(resolveProjectAliases(root)).toEqual({ '~': join(root, 'src/app') })
  })

  it('tolerates comments and trailing commas, which tsconfig allows', () => {
    tsconfig(`{
      // the alias the editor uses
      "compilerOptions": { "paths": { "@/*": ["./src/*",], /* x */ }, },
    }`)
    expect(resolveProjectAliases(root)).toEqual({ '@': join(root, 'src') })
  })

  it('keeps a url-looking value with // inside a string', () => {
    tsconfig('{ "$schema": "https://json.schemastore.org/tsconfig", "compilerOptions": { "paths": { "@/*": ["./a/*"] } } }')
    expect(resolveProjectAliases(root)).toEqual({ '@': join(root, 'a') })
  })

  it('falls back to jsconfig.json, and to the old `@` -> src when nothing says otherwise', () => {
    file('jsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./web/*'] } } }))
    expect(resolveProjectAliases(root)).toEqual({ '@': join(root, 'web') })
    rmSync(join(root, 'jsconfig.json'))
    expect(resolveProjectAliases(root)).toEqual({ '@': join(root, 'src') })
  })

  it('lets verify.alias win over the tsconfig, relative to the project root', () => {
    tsconfig(JSON.stringify({ compilerOptions: { paths: { '@/*': ['./resources/js/*'] } } }))
    expect(resolveProjectAliases(root, { '@': 'other/js', '@lib': 'packages/lib' })).toEqual({
      '@': join(root, 'other/js'),
      '@lib': join(root, 'packages/lib'),
    })
  })

  it('does not choke on a tsconfig it cannot parse', () => {
    tsconfig('{ not json')
    expect(resolveProjectAliases(root)).toEqual({ '@': join(root, 'src') })
  })

  it('writes every alias into the generated vite config, longest first', () => {
    tsconfig(JSON.stringify({ compilerOptions: { paths: {
      '@/*': ['./resources/js/*'], '@modules/programs/*': ['./Modules/Programs/resources/js/*'],
    } } }))
    const config = viteConfig({ projectRoot: root, framework: 'vue3' })
    expect(config).toContain(JSON.stringify(join(root, 'Modules/Programs/resources/js')))
    expect(config.indexOf('@modules/programs')).toBeLessThan(config.indexOf('"@"'))
  })
})

/**
 * `port: 0` was meant to let the OS pick, but the project's Vite 6 reads a falsy
 * port as "use the default" and the harness landed on 5173 — where a Docker
 * dev server often already listens (on IPv6, so the IPv4 bind still succeeds),
 * and where a harness that is still closing from the previous run is. About one
 * run in six came back "rendered nothing". The port is now picked here.
 */
describe('the harness picks its own port', () => {
  it('returns a real, bindable port', async () => {
    const port = await freePort()
    expect(port).toBeGreaterThan(0)
  })

  it('does not hand out a port that is taken', async () => {
    const { createServer } = await import('node:net')
    const taken = await freePort()
    const holder = createServer()
    await new Promise<void>((r) => holder.listen(taken, '127.0.0.1', r))
    try {
      expect(await freePort()).not.toBe(taken)
    } finally {
      await new Promise((r) => holder.close(r))
    }
  })
})
