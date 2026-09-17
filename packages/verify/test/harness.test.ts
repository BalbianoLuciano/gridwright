import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findProjectCss, resolveProjectCss, harnessFsAllow, projectDependsOn, resolveProjectModule,
  tailwindSourceStylesheet, viteConfig,
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
