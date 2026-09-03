/**
 * Parseo de la URL de Figma. El extractor de prolicht hacía esto en bash con
 * sed; acá se valida de verdad porque un nodeId mal parseado produce un 404
 * que se confunde con un problema de permisos (ver errors.ts).
 */

export interface FigmaRef { fileKey: string; nodeId: string }

/**
 * Acepta la URL completa, o `fileKey nodeId` sueltos.
 *
 * Figma usa `3978-35299` en la URL y `3978:35299` en la API. La conversión es
 * obligatoria: mandar el guión a la API devuelve un 404 silencioso.
 */
export function parseFigmaUrl(input: string): FigmaRef {
  const trimmed = input.trim()

  const fileMatch = trimmed.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/)
  const nodeMatch = trimmed.match(/[?&]node-id=([0-9]+[-:][0-9]+)/)

  if (fileMatch && nodeMatch) {
    return { fileKey: fileMatch[1]!, nodeId: normalizeNodeId(nodeMatch[1]!) }
  }
  if (fileMatch && !nodeMatch) {
    throw new Error(
      'La URL no trae `node-id`. En Figma seleccioná el frame y usá ' +
        '"Copy link to selection" — el link de la barra de direcciones sin selección no sirve.',
    )
  }
  throw new Error(
    `No pude parsear "${truncate(trimmed)}" como una URL de Figma.\n` +
      'Esperaba algo como:\n' +
      '  https://www.figma.com/design/<FILE_KEY>/<nombre>?node-id=3978-35299',
  )
}

export function normalizeNodeId(id: string): string {
  return id.replace('-', ':')
}

/** El nodeId en el formato que usa la URL, para poder reconstruir el link. */
export function denormalizeNodeId(id: string): string {
  return id.replace(':', '-')
}

export function figmaUrlFor(ref: FigmaRef): string {
  return `https://www.figma.com/design/${ref.fileKey}/?node-id=${denormalizeNodeId(ref.nodeId)}`
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
