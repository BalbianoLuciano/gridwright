import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../src/commands/init.js'

let repo: string
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gw-init-'))
  // Keeps the .gitignore lookup from walking out of the temp dir.
  mkdirSync(join(repo, '.git'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.5.0' } }))
  // The case that started this: a monorepo whose portal has a Components
  // directory, and whose module keeps its own pattern library elsewhere.
  mkdirSync(join(repo, 'resources/js/Components'), { recursive: true })
  mkdirSync(join(repo, 'Modules/Programs/resources/js/patterns'), { recursive: true })
  mkdirSync(join(repo, 'Modules/Programs/resources/js/modules'), { recursive: true })
  writeFileSync(
    join(repo, 'Modules/Programs/resources/js/modules/Hero.vue'),
    '<script setup lang="ts">\nexport interface Props { title: string }\n</script>\n<template><h1>{{ title }}</h1></template>\n',
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(repo, { recursive: true, force: true })
})

const readConfig = () => JSON.parse(readFileSync(join(repo, 'gridwright.config.json'), 'utf8'))

/**
 * Found on tgf-web: with no TTY `gw init` takes the detection as it is, the
 * first library directory on a fixed list won, and the config had to be
 * rewritten by hand.
 */
describe('gw init --library / --placement', () => {
  it('without flags, keeps picking the library from the fixed list', async () => {
    await init(repo, { yes: true })
    expect(readConfig().library.dir).toBe('resources/js/Components')
  })

  it('--library overrides the detected directory and derives barrel and registry from it', async () => {
    await init(repo, { yes: true, library: 'Modules/Programs/resources/js/patterns' })
    expect(readConfig().library).toEqual({
      dir: 'Modules/Programs/resources/js/patterns',
      barrel: 'Modules/Programs/resources/js/patterns/index.ts',
      registry: 'Modules/Programs/resources/js/patterns/registry.json',
    })
  })

  it('--placement records the directory as asked, and wins over the detected one', async () => {
    await init(repo, {
      yes: true,
      placements: ['view=Modules/Programs/resources/js/views', 'layout=./Modules/Programs/resources/js/layouts/'],
    })
    const placements = readConfig().conventions.placements
    expect(placements).toContainEqual({ kind: 'view', dir: 'Modules/Programs/resources/js/views', from: 'asked' })
    expect(placements).toContainEqual({ kind: 'layout', dir: 'Modules/Programs/resources/js/layouts', from: 'asked' })
    // The kinds that were not given keep their detection.
    expect(placements).toContainEqual({ kind: 'module', dir: 'components/modules', from: 'absent' })
    expect(placements).toHaveLength(5)
  })

  it('re-reads the shapes from a directory given by --placement', async () => {
    await init(repo, { yes: true, placements: ['module=Modules/Programs/resources/js/modules'] })
    const dirs = readConfig().conventions.shapes.map((s: any) => s.dir)
    expect(dirs).toContain('Modules/Programs/resources/js/modules')
  })

  it('rejects a kind that does not exist and writes nothing', async () => {
    await expect(init(repo, { yes: true, placements: ['page=views'] })).rejects.toThrow(
      /unknown placement kind "page".*module, view, layout, primitive, overlay/,
    )
    expect(existsSync(join(repo, 'gridwright.config.json'))).toBe(false)
  })

  it.each([['view'], ['view='], ['=views']])('rejects the malformed placement %j', async (raw) => {
    await expect(init(repo, { yes: true, placements: [raw!] })).rejects.toThrow(/--placement/)
  })

  it('rejects the same kind given twice instead of picking one silently', async () => {
    await expect(init(repo, { yes: true, placements: ['view=a', 'view=b'] })).rejects.toThrow(/twice/)
  })
})

/**
 * The flag set `library.dir` and nothing else. `detectConventions` builds its
 * candidate list from a fixed array plus the placement directories, so a
 * library nowhere on that list — which is the whole reason the flag exists —
 * got no shape read from it. Downstream, `verify` matched the component against
 * the portal's shape and `library:register` omitted `exportShape` entirely:
 * the "harness mounts `default` in a project that exports a name" failure the
 * comment in `conventions.ts` was written about.
 */
describe('the library directory is read for its shape, wherever it is', () => {
  const inPatterns = (name: string, body: string) =>
    writeFileSync(join(repo, 'Modules/Programs/resources/js/patterns', name), body)

  it('--library reads the shape of the directory it names', async () => {
    inPatterns('Btn.vue', '<template><button /></template>\n')
    inPatterns('Chip.vue', '<template><span /></template>\n')

    await init(repo, { yes: true, library: 'Modules/Programs/resources/js/patterns' })

    const dirs = readConfig().conventions.shapes.map((s: { dir: string }) => s.dir)
    expect(dirs).toContain('Modules/Programs/resources/js/patterns')
  })

  it('warns when the directory it names is not there', async () => {
    const lines: string[] = []
    vi.mocked(console.log).mockImplementation((...args) => { lines.push(args.join(' ')) })
    await init(repo, { yes: true, library: 'Modules/Programs/resources/js/nope' })
    expect(lines.join('\n')).toContain('does not exist')
  })
})

/**
 * `normalizeDir` was `.replace(/^\.?\//, '')`, which strips the leading slash
 * off an absolute path instead of refusing it: `--library "$(pwd)/src/ui"`
 * wrote `Users/me/.../src/ui` into the config — a relative path that is not
 * there — and `init` still printed `Wrote …`. `validateConfig` checks the
 * verify weights and nothing about these, so the failure surfaced at `author`.
 * `detectLibraryDir` only ever returns directories that exist, so the flag was
 * strictly weaker than the detection it replaces.
 */
describe('a flag cannot point outside the project', () => {
  it.each([
    ['--library', { library: '/Users/me/app/src/ui' }, 'relative to the project root'],
    ['--placement', { placements: ['view=/var/www/views'] }, 'relative to the project root'],
  ])('%s rejects an absolute path', async (_flag, opts, message) => {
    await expect(init(repo, { yes: true, ...opts })).rejects.toThrow(message)
    expect(existsSync(join(repo, 'gridwright.config.json'))).toBe(false)
  })

  it.each([
    ['--library', { library: '../shared/ui' }],
    ['--placement', { placements: ['module=../shared/blocks'] }],
  ])('%s rejects a path that leaves the root', async (_flag, opts) => {
    await expect(init(repo, { yes: true, ...opts })).rejects.toThrow('cannot leave the project root')
    expect(existsSync(join(repo, 'gridwright.config.json'))).toBe(false)
  })
})

// The one line of `--yes` output that says which paths are intentions rather
// than facts counted only `absent`, and a flag-given placement is `asked`. It
// undercounted exactly the directories the person had just typed.
it('counts a flag-given directory that does not exist yet', async () => {
  const lines: string[] = []
  vi.mocked(console.log).mockImplementation((...args) => { lines.push(args.join(' ')) })

  await init(repo, { yes: true, placements: ['module=brand/new/dir'] })

  const notice = lines.find((l) => l.includes('do not exist yet'))!
  const withFlag = Number(notice.trim().split(' ')[0])

  lines.length = 0
  await init(repo, { yes: true, force: true })
  const base = Number(lines.find((l) => l.includes('do not exist yet'))!.trim().split(' ')[0])

  expect(withFlag).toBe(base)
})
