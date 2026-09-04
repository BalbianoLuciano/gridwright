import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findGitignore } from '../src/commands/init.js'
import { gitignoreBlock } from '@gridwright/core'

let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'gw-gi-')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))

/**
 * Found by running `gw init` on a real project: santillanafrancais keeps its
 * frontend at src/theme/<name>/, and init dropped a second, near-empty
 * .gitignore there while a perfectly good one already sat at the repo root.
 */
describe('finding the .gitignore to write into', () => {
  it('reuses the repo root one from a nested project, with the right prefix', () => {
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const nested = join(repo, 'src/theme/site')
    mkdirSync(nested, { recursive: true })

    const found = findGitignore(nested)
    expect(found.file).toBe(join(repo, '.gitignore'))
    expect(found.prefix).toBe('src/theme/site')
  })

  // Patterns resolve against their own file, so a root .gitignore needs the
  // full path or it silently ignores nothing.
  it('prefixes the entries so they actually match', () => {
    expect(gitignoreBlock('src/theme/site')).toContain('src/theme/site/.gridwright/runs/')
    expect(gitignoreBlock()).toContain('\n.gridwright/runs/')
  })

  it('prefers a closer .gitignore over the repo root one', () => {
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const nested = join(repo, 'packages/app')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, '.gitignore'), 'dist/\n')

    expect(findGitignore(nested)).toEqual({ file: join(nested, '.gitignore'), prefix: '' })
  })

  // Past the repo boundary we would be editing an unrelated project's file.
  it('does not escape the repo when there is no .gitignore anywhere', () => {
    mkdirSync(join(repo, '.git'), { recursive: true })
    const nested = join(repo, 'src/app')
    mkdirSync(nested, { recursive: true })
    expect(findGitignore(nested).file).toBe(join(nested, '.gitignore'))
  })
})
