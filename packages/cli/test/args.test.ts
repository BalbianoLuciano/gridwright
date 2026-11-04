import { describe, it, expect } from 'vitest'
import { parse } from '../src/args.js'

describe('argument parsing', () => {
  // `values` is a Map, so a repeated flag used to keep only the last one: with
  // `--placement view=a --placement layout=b` the view silently vanished.
  it('keeps every occurrence of a repeated flag, in order', () => {
    const args = parse(['init', '--placement', 'view=a', '--placement=layout=b', '--placement', 'module=c'])
    expect(args.all.get('placement')).toEqual(['view=a', 'layout=b', 'module=c'])
  })

  it('still exposes the last occurrence through `values`, as before', () => {
    const args = parse(['init', '--library', 'one', '--library', 'two'])
    expect(args.values.get('library')).toBe('two')
    expect(args.all.get('library')).toEqual(['one', 'two'])
  })

  it('does not let a switch swallow the next token', () => {
    const args = parse(['build', '--view', 'https://figma.com/x'])
    expect(args.flags.has('view')).toBe(true)
    expect(args.positional).toEqual(['https://figma.com/x'])
  })
})
