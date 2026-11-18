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
  /** `verify.alias` from the config. */
  alias?: Record<string, string>
  /** How the component exports itself, from the project's own conventions. */
  exportShape?: string
  /** This run's own harness directory, so runs can verify at the same time. */
  harnessDir?: string
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

/**
 * The design's own width, added to the viewports if it is not already there.
 *
 * A Figma frame is one width. Rendering at three others and comparing all of
 * them against it produces two measurements with no ground truth behind them —
 * and the worst-viewport rule then lets those two decide the run. The same
 * component scored 37% at 1440 and 55% at 1920, and the difference was the
 * ruler, not the code.
 *
 * So the width the design was drawn at always gets rendered. It is the only
 * one where "does this match?" is a question with an answer.
 */
export function withDesignWidth(viewports: Viewport[], designWidth: number): Viewport[] {
  if (designWidth <= 0) return viewports
  const width = Math.round(designWidth)
  // Within 10% is the same layout; a nearer viewport already covers it.
  if (viewports.some((v) => Math.abs(v.width - width) / width < 0.1)) return viewports

  const tallest = Math.max(...viewports.map((v) => v.height), 900)
  return [...viewports, { name: 'design', width, height: tallest }]
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
    ...(opts.alias ? { alias: opts.alias } : {}),
    ...(opts.exportShape ? { exportShape: opts.exportShape } : {}),
    ...(opts.harnessDir ? { dir: opts.harnessDir } : {}),
  })

  const viewportScores: ViewportScore[] = []
  const artifacts: VerifyResult['artifacts'] = []

  try {
    await withBrowser(async (browser) => {
      for (const vp of withDesignWidth(opts.viewports, opts.measurements.root.width)) {
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
              ...(p.label ? { label: p.label } : {}),
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
      const cover = d.coverage !== undefined && d.coverage < 1
        ? ` (${Math.round(d.coverage * 100)}% of the design matched${d.collapsed ? `, ${d.collapsed} collapsed into components` : ''})`
        : ''
      lines.push(`    ${d.dimension}: ${d.score}%${cover}`)
      for (const f of d.findings.slice(0, 5)) {
        if (f.edge === 'collapsed') continue
        const delta = f.edge === 'missing'
          ? 'not found in the render — label it data-gw="' + (f.label ?? '') + '"'
          : `${f.edge} off by ${f.delta > 0 ? '+' : ''}${f.delta}px`
        // The label, not the path: the path is Figma's, and it is what made
        // every finding print sixty characters of instance plumbing.
        lines.push(`      • ${f.label || f.path} — ${delta}`)
      }
    }
  }
  return lines.join('\n')
}
