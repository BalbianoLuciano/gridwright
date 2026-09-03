/**
 * Cliente de la API de Figma.
 *
 * Ley 10.c: el token no toca ningún artefacto de la corrida, y las URLs
 * firmadas con las que Figma sirve los assets tampoco se persisten. Son
 * credenciales temporales con patas: se consumen y se descartan.
 */

import { mask } from '@gridwright/core'
import { describeStatus, FigmaError } from './errors.js'
import type { FigmaImagesResponse, FigmaMe, FigmaNode, FigmaNodesResponse } from './types.js'

const API = 'https://api.figma.com/v1'

export interface ClientOptions {
  token: string
  /** Reintentos ante 429 y errores de red. El 429 no es un fallo: es Figma
   *  pidiendo que bajes el ritmo. */
  maxRetries?: number
  fetchImpl?: typeof fetch
}

export class FigmaClient {
  private readonly token: string
  private readonly maxRetries: number
  private readonly doFetch: typeof fetch

  constructor(opts: ClientOptions) {
    this.token = opts.token
    this.maxRetries = opts.maxRetries ?? 3
    this.doFetch = opts.fetchImpl ?? fetch
  }

  /** Nunca imprimir el token entero, ni en debug. */
  get maskedToken(): string {
    return mask(this.token)
  }

  private async get<T>(path: string, context: { fileKey?: string; nodeId?: string } = {}): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response
      try {
        res = await this.doFetch(`${API}${path}`, { headers: { 'X-Figma-Token': this.token } })
      } catch (e) {
        lastError = e
        if (attempt === this.maxRetries) break
        await sleep(backoffMs(attempt))
        continue
      }

      if (res.status === 429) {
        if (attempt === this.maxRetries) throw describeStatus(429, context)
        // Respetamos Retry-After si viene; si no, backoff exponencial.
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt))
        continue
      }

      if (!res.ok) throw describeStatus(res.status, context)
      return (await res.json()) as T
    }
    throw new FigmaError(
      `No pude contactar a la API de Figma después de ${this.maxRetries + 1} intentos.`,
      0,
      lastError instanceof Error ? lastError.message : undefined,
    )
  }

  /** Se llama al guardar el token, no al usarlo: guardar uno inválido y
   *  descubrirlo tres etapas después es la peor UX posible. */
  async me(): Promise<FigmaMe> {
    return this.get<FigmaMe>('/me')
  }

  async node(fileKey: string, nodeId: string): Promise<{ document: FigmaNode; fileName?: string }> {
    const res = await this.get<FigmaNodesResponse>(
      `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
      { fileKey, nodeId },
    )
    const entry = res.nodes?.[nodeId]
    if (!entry?.document) {
      // La API devuelve 200 con `nodes: {}` cuando el id no existe pero el
      // archivo sí. Es distinto del 404 y hay que decirlo distinto.
      throw new FigmaError(
        `El archivo existe pero no tiene ningún nodo ${nodeId}.`,
        200,
        'Suele ser un node-id de otra página del archivo, o un frame que se borró. ' +
          'Volvé a copiar el link con "Copy link to selection".',
      )
    }
    return { document: entry.document, fileName: res.name }
  }

  /**
   * Devuelve URLs firmadas y temporales. Quien las consuma tiene que bajarlas
   * en el momento: NO se guardan en el manifest ni en el estado (Ley 10.c).
   */
  async imageUrls(
    fileKey: string,
    nodeIds: string[],
    opts: { scale?: number; format?: 'png' | 'svg' | 'jpg' } = {},
  ): Promise<Map<string, string>> {
    if (nodeIds.length === 0) return new Map()
    const scale = opts.scale ?? 2
    const format = opts.format ?? 'png'
    const out = new Map<string, string>()

    // La API corta pedidos muy largos; de a tandas.
    for (const batch of chunk(nodeIds, 40)) {
      const ids = batch.map(encodeURIComponent).join(',')
      const res = await this.get<FigmaImagesResponse>(
        `/images/${fileKey}?ids=${ids}&format=${format}&scale=${scale}`,
        { fileKey },
      )
      if (res.err) throw new FigmaError(`Figma no pudo exportar las imágenes: ${res.err}`, 200)
      for (const [id, url] of Object.entries(res.images ?? {})) {
        if (url) out.set(id, url)
      }
    }
    return out
  }
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
