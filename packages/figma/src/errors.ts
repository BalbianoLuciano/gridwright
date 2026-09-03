/**
 * Los errores de Figma que hacen perder tiempo.
 *
 * El 404 es el peor: parece "el archivo no existe" y casi siempre es "el
 * archivo existe y tu token no tiene acceso" — está en un equipo del que la
 * cuenta no es miembro. Un mensaje que sólo dice lo primero manda a la persona
 * a revisar la URL durante veinte minutos.
 */

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'FigmaError'
  }
}

export function describeStatus(status: number, context: { fileKey?: string; nodeId?: string }): FigmaError {
  switch (status) {
    case 401:
    case 403:
      return new FigmaError(
        'Figma rechazó el token (403).',
        status,
        'Suele ser un token expirado o sin el scope de lectura, no un token mal copiado. ' +
          'Regeneralo en figma.com/developers/api#access-tokens con `file_content:read` y volvé a correr `gw auth login`.',
      )
    case 404:
      return new FigmaError(
        `Figma devolvió 404 para el nodo ${context.nodeId ?? '?'} del archivo ${context.fileKey ?? '?'}.`,
        status,
        'El nodo no existe **o** tu cuenta no tiene acceso a ese archivo. ' +
          'Si el link te abre bien en el navegador, es lo segundo: el archivo está en un equipo ' +
          'del que tu cuenta no es miembro, y el token hereda esos permisos.',
      )
    case 429:
      return new FigmaError('Figma está limitando la tasa de pedidos (429).', status, 'Se reintenta solo con backoff.')
    default:
      return new FigmaError(`Figma respondió ${status}.`, status)
  }
}
