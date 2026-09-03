/** CLI output. No dependencies: the ANSI codes are four lines, and a colour
 *  library is supply-chain surface we do not need. */

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code: string) => (s: string) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)

export const dim = c('2')
export const bold = c('1')
export const red = c('31')
export const green = c('32')
export const yellow = c('33')
export const blue = c('34')

export const ok = (m: string) => console.log(`${green('✓')} ${m}`)
export const warn = (m: string) => console.log(`${yellow('!')} ${m}`)
export const info = (m: string) => console.log(`${blue('·')} ${m}`)
export const step = (m: string) => console.log(`${dim('→')} ${m}`)

export function fail(message: string, hint?: string): never {
  console.error(`${red('✗')} ${message}`)
  if (hint) console.error(`\n  ${dim(hint.replace(/\n/g, '\n  '))}`)
  process.exit(1)
}

/**
 * Law 10.a — the secret does not pass through the model.
 *
 * This message is deliberately an instruction for the PERSON, not something the
 * agent can run on its own. If Claude ran `gw auth login`, the token would end
 * up in the transcript, in the context and in persistent memory, and would have
 * to be treated as compromised.
 */
export function missingCredentials(): never {
  console.error(`${red('✗')} Missing Figma token.\n`)
  console.error(`  ${bold('Run this yourself, in your terminal:')}\n`)
  console.error(`      ${green('! gw auth login')}\n`)
  console.error(dim('  In Claude Code the `!` prefix runs in your shell, outside the'))
  console.error(dim('  conversation. The token must not go through the chat: once it is'))
  console.error(dim('  in a message it is in the transcript.\n'))
  console.error(dim('  Get one at figma.com/developers/api#access-tokens with read scope'))
  console.error(dim('  (file_content:read).'))
  process.exit(1)
}

const CTRL_C = '\u0003'
const BACKSPACE = '\u007f'

/**
 * Reads from stdin without echoing.
 *
 * We never accept the token as an argument (`--token=figd_x`): an argument
 * lands in the shell history and in the process list, which is exactly what we
 * are trying to avoid.
 */
export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin

    if (!stdin.isTTY) {
      // No TTY (pipe, CI): read a plain line — there is no echo to hide.
      let data = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (d) => (data += d))
      stdin.on('end', () => resolve(data.trim()))
      stdin.on('error', reject)
      return
    }

    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolve(value.trim())
        }
        if (char === CTRL_C) {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === BACKSPACE || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

export function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false)
    process.stdout.write(`${question} ${dim('[y/N]')} `)
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.once('data', (d) => {
      process.stdin.pause()
      resolve(/^y(es)?$/i.test(String(d).trim()))
    })
  })
}

export function table(rows: Array<[string, string]>, indent = '  '): void {
  const width = Math.max(...rows.map(([k]) => k.length))
  for (const [k, v] of rows) console.log(`${indent}${dim(k.padEnd(width))}  ${v}`)
}
