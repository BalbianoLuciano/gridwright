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
