/**
 * Verification — Law 6, assembled.
 *
 * Renders the component at every viewport, scores each one on three
 * dimensions, and takes the worst. Not the average: if it breaks on mobile, it
 * is broken.
 */

import { readFileSync, existsSync } from 'node:fs'
import {
  combine, combineViewports, deltaE, scoreChromatic, scorePerceptual, scoreStructural,
  type Measurements, type RunScore, type ViewportScore, type DimensionScore,
  type Viewport, type Weights, type Framework, type Box,
} from '@gridwright/core'
import { startHarness, findProjectCss } from './harness.js'
import { render, withBrowser } from './browser.js'
import { perceptualDiff } from './diff.js'

export * from './harness.js'
export * from './browser.js'
export * from './diff.js'

export interface VerifyOptions {
  projectRoot: string
  framework: Framework
  /** Absolute path to the component to render. */
  component: string
  /** The design's own numbers, from distill. */
  measurements: Measurements
  /** Figma's export of the frame. Optional: without it the perceptual
   *  dimension reports unavailable and the other two carry the score. */
  referencePng?: string
  props?: Record<string, unknown>
  css?: string[]
  viewports: Viewport[]
  weights: Weights
  threshold: number
  boxTolerancePx: number
  onViewport?: (name: string, score: number) => void
}

export interface VerifyResult extends RunScore {
  /** Rendered screenshots and diffs, per viewport, for the dashboard. */
  artifacts: Array<{ viewport: string; screenshot: Buffer; diff?: Buffer }>
}

export async function verify(opts: VerifyOptions): Promise<VerifyResult> {
  const css = opts.css ?? findProjectCss(opts.projectRoot)
  const reference = opts.referencePng && existsSync(opts.referencePng)
    ? readFileSync(opts.referencePng)
    : undefined

  const harness = await startHarness({
    projectRoot: opts.projectRoot,
    framework: opts.framework,
    component: opts.component,
    props: opts.props,
    css,
  })

  const viewportScores: ViewportScore[] = []
  const artifacts: VerifyResult['artifacts'] = []

  try {
    await withBrowser(async (browser) => {
      for (const vp of opts.viewports) {
        const shot = await render(browser, {
          url: harness.url,
          width: vp.width,
          height: vp.height,
          probes: opts.measurements.probes,
        })

        const structural = scoreStructural(
          opts.measurements.nodes, opts.measurements.root,
          shot.nodes, shot.root, opts.boxTolerancePx,
        )

        const chromatic = scoreChromatic(
          opts.measurements.probes.map((p, i) => {
            const got = shot.sampled[i] ?? 'transparent'
            return {
              from: p.from,
              expected: p.hex,
              got,
              // A transparent sample means nothing painted there, which is a
              // real difference rather than a colour to compare.
              deltaE: got === 'transparent' ? 100 : deltaE(p.hex, got),
            }
          }),
        )

        let perceptual: DimensionScore
        let diffImage: Buffer | undefined
        if (reference) {
          const d = await perceptualDiff(reference, shot.screenshot, opts.measurements.root, {
            mask: opts.measurements.textRegions,
          })
          perceptual = d.compared === 0
            ? { dimension: 'perceptual', score: 0, findings: [], unavailable: 'sharp is not installed' }
            : scorePerceptual(d.differing, d.compared)
          diffImage = d.image
        } else {
          perceptual = {
            dimension: 'perceptual', score: 0, findings: [],
            unavailable: 'no reference image — run `gw build` first, or pass --reference',
          }
        }

        const dimensions = [structural, chromatic, perceptual]
        const total = combine(dimensions, opts.weights)
        viewportScores.push({ viewport: vp.name, width: vp.width, total, dimensions })
        artifacts.push({ viewport: vp.name, screenshot: shot.screenshot, diff: diffImage })
        opts.onViewport?.(vp.name, total)
      }
    })
  } finally {
    // Always: a harness left behind in someone's repo looks like their code.
    await harness.close()
  }

  return { ...combineViewports(viewportScores, opts.threshold), artifacts }
}

/**
 * Turns a score into something a person — or a refine pass — can act on.
 *
 * "Structural 71%" is a verdict. "[heading] top: expected 148, got 156" is an
 * instruction, and it is the difference between converging in two iterations
 * and burning through the cap.
 */
export function explain(result: RunScore): string {
  const lines: string[] = []
  for (const vp of result.viewports) {
    const flag = vp.total >= result.threshold ? '✓' : '✗'
    lines.push(`${flag} ${vp.viewport} (${vp.width}px) — ${vp.total}%`)
    for (const d of vp.dimensions) {
      if (d.unavailable) {
        lines.push(`    ${d.dimension}: not measured — ${d.unavailable}`)
        continue
      }
      lines.push(`    ${d.dimension}: ${d.score}%`)
      for (const f of d.findings.slice(0, 5)) {
        const delta = f.edge === 'missing'
          ? 'missing from the render'
          : `${f.edge} off by ${f.delta > 0 ? '+' : ''}${f.delta}px`
        lines.push(`      • ${f.path} — ${delta}`)
      }
    }
  }
  return lines.join('\n')
}
