/**
 * Figma API client.
 *
 * Law 10.c: the token never touches a run artifact, and neither do the signed
 * URLs Figma serves assets from. Those are temporary credentials with legs:
 * they get consumed and dropped.
 */

import { mask } from '@gridwright/core'
import { describeStatus, FigmaError } from './errors.js'
import type { FigmaImagesResponse, FigmaMe, FigmaNode, FigmaNodesResponse } from './types.js'

const API = 'https://api.figma.com/v1'

export interface ClientOptions {
  token: string
  /** Retries on 429 and network errors. A 429 is not a failure: it is Figma
   *  asking you to slow down. */
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

  /** Never print the whole token, not even when debugging. */
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
        // Honour Retry-After when present; otherwise exponential backoff.
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt))
        continue
      }

      if (!res.ok) throw describeStatus(res.status, context)
      return (await res.json()) as T
    }
    throw new FigmaError(
      `Could not reach the Figma API after ${this.maxRetries + 1} attempts.`,
      0,
      lastError instanceof Error ? lastError.message : undefined,
    )
  }

  /** Called when the token is saved, not when it is used: saving an invalid
   *  token and finding out three stages later is the worst possible UX. */
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
      // The API answers 200 with `nodes: {}` when the id is missing but the
      // file is not. That is different from a 404 and deserves a different
      // message.
      throw new FigmaError(
        `The file exists but has no node ${nodeId}.`,
        200,
        'Usually a node-id from another page of the file, or a frame that was deleted. ' +
          'Copy the link again with "Copy link to selection".',
      )
    }
    return { document: entry.document, fileName: res.name }
  }

  /**
   * Returns signed, temporary URLs. Callers must download them right away:
   * they are NOT stored in the manifest or in the run state (Law 10.c).
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

    // The API rejects very long requests; batch them.
    for (const batch of chunk(nodeIds, 40)) {
      const ids = batch.map(encodeURIComponent).join(',')
      const res = await this.get<FigmaImagesResponse>(
        `/images/${fileKey}?ids=${ids}&format=${format}&scale=${scale}`,
        { fileKey },
      )
      if (res.err) throw new FigmaError(`Figma could not export the images: ${res.err}`, 200)
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
