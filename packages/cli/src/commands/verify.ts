/**
 * `gw verify` — the ruler.
 *
 * Runnable outside a run on purpose. Inside the state machine `verify` sits at
 * stage 10, behind `tokens` and `library:ensure`, which are mandatory and
 * cannot be skipped; until phase 4 exists no run can reach it. Worse, phase 2
 * is meant to be calibrated "on a hand-written component" — and a hand-written
 * component never came out of a run in the first place.
 *
 * So it takes a component and a design, from wherever they happen to be.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import {
  loadConfig, paths, resolveCredentials, activeRun, loadState, saveState,
  type Measurements, type GridwrightConfig,
} from '@gridwright/core'
import { FigmaClient, FigmaError, parseFigmaUrl, distill } from '@gridwright/figma'
import { verify, explain } from '@gridwright/verify'
import { ok, fail, info, warn, step, dim, bold, green, yellow, red, missingCredentials } from '../ui.js'

export interface VerifyArgs {
  component?: string
  figma?: string
  run?: string
  reference?: string
  props?: string
  json?: boolean
}

export async function runVerify(root: string, args: VerifyArgs): Promise<void> {
  const config = loadConfig(root)
  if (!config) fail('This project is not configured.', 'Run `gw init` first.')

  if (!args.component) {
    fail(
      'Nothing to verify: pass a component with --component.',
      'gw verify --component components/modules/HeroBanner/index.tsx --figma "<url>"\n\n' +
        'The design can come from a Figma URL (--figma) or from an existing run (--run).',
    )
  }

  const component = isAbsolute(args.component) ? args.component : resolvePath(root, args.component)
  if (!existsSync(component)) fail(`No such component: ${component}`)

  const design = args.figma
    ? await designFromFigma(root, config, args.figma)
    : designFromRun(root, args.run)

  const props = parseProps(args.props)

  step(`Rendering ${bold(args.component)} at ${config.verify.viewports.length} viewports`)
  if (!design.reference) {
    // Said out loud rather than folded into the score: a missing dimension
    // changes what the number means.
    warn('No reference image — the perceptual dimension will not be measured.')
  }

  // The shape that matches where this component lives. Assuming `default`
  // mounted nothing in a project whose modules export a named `Component`.
  const shape = config.conventions
    ? (config.conventions.shapes.find((s) => args.component!.startsWith(s.dir))
       ?? config.conventions.shapes[0])
    : undefined

  const result = await verify({
    projectRoot: root,
    framework: config.framework,
    component,
    ...(shape ? { exportShape: shape.export } : {}),
    measurements: design.measurements,
    referencePng: design.reference,
    props,
    viewports: config.verify.viewports,
    weights: config.verify.weights,
    threshold: config.verify.threshold,
    boxTolerancePx: config.verify.boxTolerancePx,
    onViewport: (name, score) => {
      const mark = score >= config.verify.threshold ? green('✓') : yellow('!')
      console.log(`    ${mark} ${name.padEnd(8)} ${score}%`)
    },
  })

  if (args.json) {
    const { artifacts, ...rest } = result
    console.log(JSON.stringify(rest, null, 2))
    return
  }

  const out = join(root, '.gridwright', 'verify')
  mkdirSync(out, { recursive: true })
  for (const a of result.artifacts) {
    writeFileSync(join(out, `${a.viewport}.png`), a.screenshot)
    if (a.diff) writeFileSync(join(out, `${a.viewport}-diff.png`), a.diff)
  }

  console.log()
  console.log(explain(result))
  console.log()

  // Recorded on the run when verify is the stage the run is on, so `refine` has
  // something to read. A loose calibration run leaves the state untouched.
  const open = args.run ? loadState(root, args.run) : activeRun(root)
  if (open && open.stage === 'verify') {
    const { artifacts, ...score } = result
    open.stages.verify.output = { ...open.stages.verify.output, score }
    saveState(root, open)
  }

  const label = `${result.total}% on ${result.worstViewport}, threshold ${result.threshold}`
  if (result.passed) ok(`Passed — ${label}`)
  else console.log(`${red('✗')} Below threshold — ${label}`)

  console.log(dim(`  Screenshots in ${out}`))
  if (!result.passed) {
    console.log(dim('  The worst viewport decides the run, never the average (Law 6).'))
  }
}

interface Design { measurements: Measurements; reference?: string }

/**
 * Fetches and distills on the spot.
 *
 * Deliberately does not open a run: this is a measurement of something that
 * already exists, not a step in building it. Opening a run would leave a
 * half-finished pipeline behind every time someone checked a number.
 */
async function designFromFigma(root: string, config: GridwrightConfig, url: string): Promise<Design> {
  const creds = resolveCredentials(root)
  if (!creds) missingCredentials()
  const ref = parseFigmaUrl(url)
  const client = new FigmaClient({ token: creds.figmaToken })

  step(`Fetching ${ref.nodeId} from Figma`)
  let doc
  try {
    doc = (await client.node(ref.fileKey, ref.nodeId)).document
  } catch (e) {
    if (e instanceof FigmaError) fail(e.message, e.hint)
    throw e
  }

  const { measurements, ir } = distill(doc, ref, config.distill)
  if (ir.warnings.some((w) => w.severity === 'error')) {
    warn(`${ir.warnings.filter((w) => w.severity === 'error').length} layout warnings — the structural score may be misleading.`)
  }

  const dir = join(root, '.gridwright', 'verify')
  mkdirSync(dir, { recursive: true })
  const referencePath = join(dir, 'reference.png')
  const urls = await client.imageUrls(ref.fileKey, [ref.nodeId], { scale: 2 })
  const refUrl = urls.get(ref.nodeId)
  if (refUrl) {
    writeFileSync(referencePath, Buffer.from(await (await fetch(refUrl)).arrayBuffer()))
    return { measurements, reference: referencePath }
  }
  return { measurements }
}

function designFromRun(root: string, id?: string): Design {
  const run = id ? loadState(root, id) : activeRun(root)
  if (!run) {
    fail(
      'No design to compare against.',
      'Pass --figma "<url>" to measure against a Figma node, or --run <id> to reuse one already fetched.',
    )
  }
  const mPath = paths.measurements(root, run.id)
  if (!existsSync(mPath)) {
    fail(
      `Run ${run.id} has no measurements.`,
      'It predates them, or distill did not finish. Re-run `gw build` for that node.',
    )
  }
  const measurements = JSON.parse(readFileSync(mPath, 'utf8')) as Measurements
  const refPath = paths.reference(root, run.id)
  info(`Comparing against run ${run.id}`)
  return { measurements, reference: existsSync(refPath) ? refPath : undefined }
}

/** Props for the harness. The component renders empty without them if its own
 *  defaults are absent, and an empty render scores zero for the wrong reason. */
function parseProps(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  const text = existsSync(raw) ? readFileSync(raw, 'utf8') : raw
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    fail('--props is neither valid JSON nor a path to a JSON file.')
  }
}
