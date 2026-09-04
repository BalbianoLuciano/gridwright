/**
 * Law 1 — The workflow is state on disk, not text in a prompt.
 *
 * The opposite has already been tried: an earlier project has a five-phase
 * workflow written in prose, and the agent skips the similarity-analysis phase
 * every time the request looks simple. A prompt is a suggestion; a long prompt
 * is a suggestion that also dilutes as context grows.
 *
 * Here the order is not argued for, it is enforced: `advance()` only accepts
 * the stage that is actually current, and the mandatory ones cannot be skipped
 * even when explicitly asked.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './paths.js'
import { STAGES, STAGE_SPECS, isImplemented, type Stage, type Actor } from './stages.js'

export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'blocked'

export interface StageRecord {
  status: StageStatus
  startedAt?: string
  finishedAt?: string
  /** Required for `skipped` and `failed`: a stage that did not run has to say
   *  why. It does not vanish from the history. */
  reason?: string
  /** Data the stage produced that later stages need. */
  output?: Record<string, unknown>
}

export type RunMode = 'component' | 'view'

export interface RunState {
  version: 1
  id: string
  mode: RunMode
  source: { url: string; fileKey: string; nodeId: string }
  /** Proposed component name. Refined during `plan`. */
  name: string
  stage: Stage
  stages: Record<Stage, StageRecord>
  createdAt: string
  updatedAt: string
}

/** What `gw next` hands back to Claude. This is the whole protocol. */
export interface Directive {
  run: string
  stage: Stage
  actor: Actor
  action: string
  inputs: Record<string, unknown>
  gate: string | null
  /** When the stage is not built yet we say so explicitly instead of
   *  pretending it ran. */
  blocked?: { reason: string; phase: number }
}

export function newRunState(args: {
  id: string
  mode: RunMode
  url: string
  fileKey: string
  nodeId: string
  name: string
}): RunState {
  const now = new Date().toISOString()
  const stages = Object.fromEntries(
    STAGES.map((s) => [s, { status: 'pending' as StageStatus }]),
  ) as Record<Stage, StageRecord>
  return {
    version: 1,
    id: args.id,
    mode: args.mode,
    source: { url: args.url, fileKey: args.fileKey, nodeId: args.nodeId },
    name: args.name,
    // `init` belongs to the project, not to the run: a run starts at fetch.
    stage: 'fetch',
    stages,
    createdAt: now,
    updatedAt: now,
  }
}

export function saveState(root: string, state: RunState): void {
  const path = paths.state(root, state.id)
  mkdirSync(dirname(path), { recursive: true })
  state.updatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n')
}

export function loadState(root: string, id: string): RunState | null {
  const path = paths.state(root, id)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as RunState
}

/** Runs ordered by update time, most recent first. */
export function listRuns(root: string): RunState[] {
  const dir = paths.runs(root)
  if (!existsSync(dir)) return []
  const out: RunState[] = []
  for (const id of readdirSync(dir)) {
    const s = loadState(root, id)
    if (s) out.push(s)
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** The open run, if there is one. This is what the SessionStart hook queries in
 *  order to resume after an interruption. */
export function activeRun(root: string): RunState | null {
  return listRuns(root).find((r) => r.stage !== 'report' || r.stages.report.status !== 'done') ?? null
}

export function markRunning(state: RunState, stage: Stage): void {
  state.stages[stage] = { ...state.stages[stage], status: 'running', startedAt: new Date().toISOString() }
}

/**
 * Closes a stage and moves the pointer. It refuses to close a stage that is not
 * the current one: if Claude tries to jump from `fetch` to `author`, this
 * throws.
 */
export function advance(
  state: RunState,
  stage: Stage,
  result: { status: 'done' | 'skipped' | 'failed'; reason?: string; output?: Record<string, unknown> },
): void {
  if (state.stage !== stage) {
    throw new Error(
      `cannot close "${stage}": the run is at "${state.stage}". ` +
        `Stages are not skipped (Law 1).`,
    )
  }
  if (result.status === 'skipped') {
    // A view is a composition. Skipping survey there means reimplementing the
    // button, the card and the hero that already exist, and six views later
    // nobody can tell which Card is the real one. For a single component it is
    // merely useful; here it is the whole point.
    if (stage === 'survey' && state.mode === 'view') {
      throw new Error(
        'survey cannot be skipped in view mode. A view without it rebuilds what ' +
          'the project already has.',
      )
    }
    if (STAGE_SPECS[stage].mandatory) {
      throw new Error(
        `"${stage}" is mandatory and cannot be skipped. ` +
          `It is one of the stages that build the system.`,
      )
    }
    if (!result.reason) {
      throw new Error(`skipping "${stage}" requires a reason: a stage that did not run has to say why`)
    }
  }
  if (result.status === 'failed' && !result.reason) {
    throw new Error(`marking "${stage}" as failed requires a reason`)
  }

  state.stages[stage] = {
    ...state.stages[stage],
    status: result.status,
    finishedAt: new Date().toISOString(),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.output ? { output: result.output } : {}),
  }

  if (result.status === 'failed') return // stay on the stage so it can be retried

  const i = STAGES.indexOf(stage)
  if (i < STAGES.length - 1) state.stage = STAGES[i + 1]!
}

/**
 * The protocol. Claude does not decide which stage comes next: it asks this.
 */
export function directive(state: RunState, root: string, inputs: Record<string, unknown> = {}): Directive {
  const stage = state.stage
  const spec = STAGE_SPECS[stage]
  const base: Directive = {
    run: state.id,
    stage,
    actor: spec.actor,
    action: spec.summary,
    inputs: { root, name: state.name, mode: state.mode, ...inputs },
    gate: spec.gate ? 'Requires human approval before advancing (Law 5).' : null,
  }
  if (!isImplemented(stage)) {
    base.blocked = {
      reason: `Stage "${stage}" belongs to phase ${spec.phase} of the spec and is not built yet.`,
      phase: spec.phase,
    }
  }
  return base
}
