/**
 * The perceptual diff — the noisy quarter of the score.
 *
 * Text is masked out before anything is compared. Figma and Chromium disagree
 * on kerning, hinting and subpixel placement no matter how correct the code is,
 * and a paragraph of body copy can differ on most of its pixels while being
 * exactly right. Left in, text would dominate this dimension and measure the
 * font stack rather than the layout.
 *
 * Uses sharp, which is already a dependency for asset extraction, rather than
 * adding a native diff binary for one O(n) loop over pixels.
 */

import type { Box } from '@gridwright/core'

export interface DiffOptions {
  /** Per-channel difference below which two pixels count as equal. Absorbs
   *  antialiasing on edges without hiding a wrong colour. */
  threshold?: number
  /** Regions to ignore, in the reference image's own coordinate space. */
  mask?: Box[]
}

export interface DiffResult {
  differing: number
  compared: number
  /** PNG showing the differences, for the dashboard. */
  image?: Buffer
}

/**
 * Compares two screenshots after scaling the reference to the render's size.
 *
 * Figma exports at 2x and a viewport renders at 1x, so they never match
 * naturally. The reference is what gets resampled: resizing the render would
 * mean scoring an image the browser never actually drew.
 */
export async function perceptualDiff(
  reference: Buffer,
  rendered: Buffer,
  referenceBox: Box,
  opts: DiffOptions = {},
): Promise<DiffResult> {
  const sharp = await loadSharp()
  if (!sharp) return { differing: 0, compared: 0 }

  const target = await sharp(rendered).metadata()
  const width = target.width ?? 0
  const height = target.height ?? 0
  if (width === 0 || height === 0) return { differing: 0, compared: 0 }

  const [a, b] = await Promise.all([
    sharp(reference).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer(),
    sharp(rendered).ensureAlpha().raw().toBuffer(),
  ])

  // Masks arrive in the design's coordinates; scale them into image space.
  const sx = referenceBox.width > 0 ? width / referenceBox.width : 1
  const sy = referenceBox.height > 0 ? height / referenceBox.height : 1
  const masks = (opts.mask ?? []).map((m) => ({
    x0: Math.floor((m.x - referenceBox.x) * sx),
    y0: Math.floor((m.y - referenceBox.y) * sy),
    x1: Math.ceil((m.x - referenceBox.x + m.width) * sx),
    y1: Math.ceil((m.y - referenceBox.y + m.height) * sy),
  }))

  const masked = new Uint8Array(width * height)
  for (const m of masks) {
    for (let y = Math.max(0, m.y0); y < Math.min(height, m.y1); y++) {
      for (let x = Math.max(0, m.x0); x < Math.min(width, m.x1); x++) masked[y * width + x] = 1
    }
  }

  const threshold = opts.threshold ?? 12
  const out = Buffer.alloc(width * height * 4)
  let differing = 0
  let compared = 0

  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    if (masked[i]) {
      // Masked pixels are dimmed in the diff image so the mask is visible.
      out[p] = 200; out[p + 1] = 200; out[p + 2] = 200; out[p + 3] = 40
      continue
    }
    compared++
    const dr = Math.abs(a[p]! - b[p]!)
    const dg = Math.abs(a[p + 1]! - b[p + 1]!)
    const db = Math.abs(a[p + 2]! - b[p + 2]!)
    if (dr > threshold || dg > threshold || db > threshold) {
      differing++
      out[p] = 255; out[p + 1] = 40; out[p + 2] = 90; out[p + 3] = 255
    } else {
      const grey = Math.round((b[p]! + b[p + 1]! + b[p + 2]!) / 3)
      out[p] = grey; out[p + 1] = grey; out[p + 2] = grey; out[p + 3] = 60
    }
  }

  const image = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
  return { differing, compared, image }
}

async function loadSharp(): Promise<((input?: Buffer, opts?: unknown) => any) | null> {
  try {
    const mod = await import('sharp')
    return (mod.default ?? mod) as any
  } catch {
    // Same call as asset extraction: without sharp the perceptual dimension
    // reports as unavailable rather than failing the run.
    return null
  }
}
