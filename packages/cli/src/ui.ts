/** Salida del CLI. Sin dependencias: los códigos ANSI son cuatro líneas y una
 *  librería de colores es una superficie de supply chain que no hace falta. */

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
 * Ley 10.a — el secreto no pasa por el modelo.
 *
 * Este mensaje es deliberadamente una instrucción para la PERSONA, no algo que
 * el agente pueda ejecutar por su cuenta. Si Claude corriera `gw auth login`,
 * el token terminaría en el transcript, en el contexto y en la memoria
 * persistente, y habría que considerarlo comprometido.
 */
export function missingCredentials(): never {
  console.error(`${red('✗')} Falta el token de Figma.\n`)
  console.error(`  ${bold('Corré esto vos, en tu terminal:')}\n`)
  console.error(`      ${green('! gw auth login')}\n`)
  console.error(dim('  En Claude Code el prefijo `!` ejecuta en tu shell, fuera de la'))
  console.error(dim('  conversación. El token no tiene que pasar por el chat: si aparece'))
  console.error(dim('  en un mensaje queda en el transcript.\n'))
  console.error(dim('  Se saca de figma.com/developers/api#access-tokens con scope de'))
  console.error(dim('  lectura (file_content:read).'))
  process.exit(1)
}

const CTRL_C = '\u0003'
const BACKSPACE = '\u007f'

/**
 * Lee de stdin sin eco.
 *
 * Nunca aceptamos el token como argumento (`--token=figd_x`): un argumento
 * queda en el historial del shell y en la lista de procesos, que es
 * exactamente lo que estamos tratando de evitar.
 */
export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin

    if (!stdin.isTTY) {
      // Sin TTY (pipe, CI) leemos una línea normal: no hay eco que ocultar.
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
