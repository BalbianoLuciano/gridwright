/**
 * Figma URL parsing. The earlier shell script did this with sed; here it is
 * actually validated, because a mis-parsed nodeId produces a 404 that gets
 * mistaken for a permissions problem (see errors.ts).
 */

export interface FigmaRef { fileKey: string; nodeId: string }

/**
 * Accepts the full URL.
 *
 * Figma uses `3978-35299` in the URL and `3978:35299` in the API. The
 * conversion is mandatory: sending the hyphen to the API returns a silent 404.
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
      'The URL has no `node-id`. In Figma, select the frame and use ' +
        '"Copy link to selection" — the address bar URL without a selection will not do.',
    )
  }
  throw new Error(
    `Could not parse "${truncate(trimmed)}" as a Figma URL.\n` +
      'Expected something like:\n' +
      '  https://www.figma.com/design/<FILE_KEY>/<name>?node-id=3978-35299',
  )
}

export function normalizeNodeId(id: string): string {
  return id.replace('-', ':')
}

/** The nodeId in the shape the URL uses, so the link can be rebuilt. */
export function denormalizeNodeId(id: string): string {
  return id.replace(':', '-')
}

export function figmaUrlFor(ref: FigmaRef): string {
  return `https://www.figma.com/design/${ref.fileKey}/?node-id=${denormalizeNodeId(ref.nodeId)}`
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
