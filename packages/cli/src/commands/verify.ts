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
  loadConfig, paths, resolveCredentials, activeRun, listRuns, loadState, saveState, advance,
  type Measurements, type GridwrightConfig, type RunState,
} from '@gridwright/core'
import { FigmaClient, FigmaError, parseFigmaUrl, distill } from '@gridwright/figma'
import { verify, explain, resolveProjectCss } from '@gridwright/verify'
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

  // Inside a run, the component and its props come from `author` — the only
  // actor that knows either. `verify` used to demand both on the command line,
  // which meant the stage could not run as part of the pipeline at all: an
  // agent that had just written the file had to hand it back by hand.
  // The named run, then the one still in progress, then the most recent —
  // which is what `report` already does. `activeRun` returns nothing once a run
  // has finished, and "I changed the component, check it again" is the most
  // common thing anyone does next; making that ask for a run id was asking for
  // something the tool knows.
  const open = args.run ? loadState(root, args.run) : (activeRun(root) ?? listRuns(root)[0] ?? null)
  const authored = open?.stages.author.output
  const componentArg = args.component ?? (typeof authored?.file === 'string' ? authored.file : undefined)

  if (!componentArg) {
    fail(
      'Nothing to verify: pass a component with --component.',
      'gw verify --component components/modules/HeroBanner/index.tsx --figma "<url>"\n\n' +
        'Inside a run it is taken from what `author` recorded — close that stage with\n' +
        '`gw done --output \'{"file": "...", "props": {...}}\'` and it needs no flags.',
    )
  }

  const component = isAbsolute(componentArg) ? componentArg : resolvePath(root, componentArg)
  if (!existsSync(component)) fail(`No such component: ${component}`)

  // Before the design is fetched: a typo in `verify.css` used to cost a whole
  // download and a distill before it was reported.
  const { css, missing, stale } = resolveProjectCss(root, config.verify.css)
  if (missing.length > 0) {
    fail(
      `verify.css names a stylesheet that does not exist: ${missing.join(', ')}`,
      'Paths in gridwright.config.json are relative to the project root.',
    )
  }
  if (css.length === 0) {
    // Said out loud: without a stylesheet every utility class is inert, the
    // component renders as unstyled text, and the score that comes out looks
    // like a bad component rather than a missing file.
    warn('No stylesheet found — the component will render unstyled and the score will not mean much.')
    console.log(dim('  Name it in gridwright.config.json: "verify": { "css": ["src/main.css"] }'))
  }
  if (stale.length > 0) {
    // A build output only holds the classes that existed when it was built.
    warn(`verify.css points at a build output: ${stale.join(', ')}`)
    console.log(dim('  It holds the classes that existed when it was built, so a component'))
    console.log(dim('  written since renders unstyled. Name the source stylesheet instead.'))
  }

  const design = args.figma
    ? await designFromFigma(root, config, args.figma)
    : designFromRun(root, open)

  const props = args.props ? parseProps(args.props) : authoredProps(authored)

  step(`Rendering ${bold(componentArg)} at ${config.verify.viewports.length} viewports`)
  if (!design.reference) {
    // Said out loud rather than folded into the score: a missing dimension
    // changes what the number means.
    warn('No reference image — the perceptual dimension will not be measured.')
  }

  // The shape that matches where this component lives. Assuming `default`
  // mounted nothing in a project whose modules export a named `Component`.
  const shape = config.conventions
    ? (config.conventions.shapes.find((s) => componentArg.startsWith(s.dir))
       ?? config.conventions.shapes[0])
    : undefined

  const result = await verify({
    projectRoot: root,
    framework: config.framework,
    component,
    css,
    ...(shape ? { exportShape: shape.export } : {}),
    // Its own harness directory. The shared one is deleted when a harness
    // starts and when it closes, so sections verifying at the same time took
    // each other's away mid-measurement.
    ...(open ? { harnessDir: paths.runHarness(root, open.id) } : {}),
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

  // Into the run when there is one, so its evidence survives the next run.
  const out = open ? paths.runVerify(root, open.id) : paths.verify(root)
  mkdirSync(out, { recursive: true })
  for (const a of result.artifacts) {
    writeFileSync(join(out, `${a.viewport}.png`), a.screenshot)
    if (a.diff) writeFileSync(join(out, `${a.viewport}-diff.png`), a.diff)
  }

  console.log()
  console.log(explain(result))
  console.log()

  // Recorded on the run, and the run moved on. A loose calibration run — one
  // with no open run at these stages — leaves the state untouched.
  //
  // `harness` is closed here too. It is a stage in the pipeline and an
  // implementation detail of this command: verify starts its own Vite and tears
  // it down, so a run that reached `harness` and waited for someone to run it
  // separately would wait forever. It did.
  // Any open run gets the score, whatever stage it is on. Recording only at
  // `harness` and `verify` was the same mistake twice: re-verifying after a fix
  // is the normal thing to do — it is what `refine` is for — and once the run
  // had moved past those two the result was dropped on the floor. The dashboard
  // then showed fresh screenshots beside the previous run's numbers, which is
  // worse than showing nothing: the pictures said 90 and the figure said 80.
  //
  // The stage still decides whether the run *advances*. Only whether it records
  // has changed.
  //
  // A component verified against a Figma URL with no run open leaves the state
  // untouched — that is a loose calibration, not a step in building anything.
  if (open) {
    const { artifacts, ...score } = result
    if (open.stage === 'harness') {
      advance(open, 'harness', { status: 'done', output: { startedBy: 'gw verify' } })
    }
    // The score does not gate the run any more: it is evidence for whoever
    // reviews it, and the pipeline's job is to finish so there is something to
    // review.
    open.stages.verify.output = { ...open.stages.verify.output, score }
    if (open.stage === 'verify') {
      advance(open, 'verify', { status: 'done', output: { score } })
    }
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

  const dir = paths.verify(root)
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

function designFromRun(root: string, run: RunState | null): Design {
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

/**
 * The props `author` recorded, and a clear complaint when it recorded none.
 *
 * They cannot be derived from the IR. The IR names the design's slots —
 * `suscribeToOut`, `loremIpsumDolor` — and the component names its own props
 * by whatever convention the project follows; this one wraps everything in a
 * `fieldValues` its CMS supplies. Only the actor that wrote the file knows the
 * mapping, so it is the actor that has to hand it over.
 *
 * Silence here is expensive: a module rendered without props returns null, and
 * an empty render scores zero for a reason that has nothing to do with the
 * design.
 */
function authoredProps(authored: Record<string, unknown> | undefined): Record<string, unknown> {
  const props = authored?.props
  if (props && typeof props === 'object') return props as Record<string, unknown>

  warn('No props recorded on this run — rendering the component with none.')
  console.log(dim('  If it renders empty, close `author` with them:'))
  console.log(dim('    gw done --output \'{"file": "...", "props": {"fieldValues": {...}}}\''))
  console.log(dim('  The design\'s own copy is in the IR, on each node\'s `default`.'))
  return {}
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
