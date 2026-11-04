/**
 * Argument parsing for `gw`.
 *
 * Hand-rolled on purpose: it is forty lines, and every dependency in a binary
 * that handles a token is supply-chain surface that has to be justified. It
 * lives in its own module so it can be tested without running the CLI.
 */

export interface Args {
  cmd: string
  sub?: string
  positional: string[]
  flags: Set<string>
  /** Flags that carry a value, e.g. `--component path`. The last one wins. */
  values: Map<string, string>
  /**
   * Every value a flag was given, in order. `values` keeps only the last, which
   * is right for `--run` and wrong for a flag that is meant to repeat, like
   * `--placement`: the earlier ones vanished without a word.
   */
  all: Map<string, string[]>
}

/** Flags that are on or off, and so never consume the token after them. */
const SWITCHES = new Set(['view', 'json', 'yes', 'force', 'approve', 'open', 'help'])

export function parse(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const all = new Map<string, string[]>()

  const give = (name: string, value: string): void => {
    values.set(name, value)
    all.set(name, [...(all.get(name) ?? []), value])
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) { positional.push(a); continue }

    // Both `--component x` and `--component=x`.
    const eq = a.indexOf('=')
    if (eq !== -1) { give(a.slice(2, eq), a.slice(eq + 1)); continue }

    const name = a.slice(2)
    const next = argv[i + 1]
    // A switch never takes a value. Without this, `gw build --view "<url>"` —
    // the form the README and the skill both give — read the URL as the value
    // of --view, and then reported that the URL was missing.
    if (!SWITCHES.has(name) && next && !next.startsWith('--')) { give(name, next); i++ }
    else flags.add(name)
  }
  return { cmd: positional[0] ?? '', sub: positional[1], positional: positional.slice(1), flags, values, all }
}
