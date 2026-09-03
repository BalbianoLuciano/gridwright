/**
 * Ley 1 — El workflow es estado en disco, no texto en un prompt.
 *
 * Ya se probó lo contrario: en prolicht hay un workflow de cinco fases escrito
 * en prosa y el agente se saltea la fase de análisis de similitud cada vez que
 * el pedido parece simple. Un prompt es una sugerencia; un prompt largo es una
 * sugerencia que además se diluye con el contexto.
 *
 * Acá el orden no se persuade, se impone: `advance()` sólo acepta la etapa que
 * corresponde, y las obligatorias no se pueden saltear ni pidiéndolo.
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
  /** Obligatorio para `skipped` y `failed`: una etapa que no corrió tiene que
   *  decir por qué. No desaparece del historial. */
  reason?: string
  /** Datos que la etapa produjo y que las siguientes necesitan. */
  output?: Record<string, unknown>
}

export type RunMode = 'component' | 'view'

export interface RunState {
  version: 1
  id: string
  mode: RunMode
  source: { url: string; fileKey: string; nodeId: string }
  /** Nombre propuesto del componente. Se afina en `plan`. */
  name: string
  stage: Stage
  stages: Record<Stage, StageRecord>
  createdAt: string
  updatedAt: string
}

/** Lo que `gw next` le devuelve a Claude. Es el protocolo entero. */
export interface Directive {
  run: string
  stage: Stage
  actor: Actor
  action: string
  inputs: Record<string, unknown>
  gate: string | null
  /** Cuando la etapa todavía no está construida, se dice explícitamente en vez
   *  de fingir que se ejecutó. */
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
    // `init` es del proyecto, no de la corrida: un run arranca en fetch.
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

/** Corridas ordenadas por actualización, la más reciente primero. */
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

/** La corrida abierta, si hay una. Es lo que el hook de SessionStart consulta
 *  para poder retomar después de un corte. */
export function activeRun(root: string): RunState | null {
  return listRuns(root).find((r) => r.stage !== 'report' || r.stages.report.status !== 'done') ?? null
}

export function markRunning(state: RunState, stage: Stage): void {
  state.stages[stage] = { ...state.stages[stage], status: 'running', startedAt: new Date().toISOString() }
}

/**
 * Cierra una etapa y mueve el puntero. No acepta cerrar una etapa que no es la
 * actual: si Claude intenta saltar de `fetch` a `author`, esto tira error.
 */
export function advance(
  state: RunState,
  stage: Stage,
  result: { status: 'done' | 'skipped' | 'failed'; reason?: string; output?: Record<string, unknown> },
): void {
  if (state.stage !== stage) {
    throw new Error(
      `no se puede cerrar "${stage}": la corrida está en "${state.stage}". ` +
        `Las etapas no se saltean (Ley 1).`,
    )
  }
  if (result.status === 'skipped') {
    if (STAGE_SPECS[stage].mandatory) {
      throw new Error(
        `"${stage}" es obligatoria y no se puede saltear. ` +
          `Es una de las que construyen el sistema.`,
      )
    }
    if (!result.reason) {
      throw new Error(`saltear "${stage}" requiere un motivo: una etapa que no corrió tiene que decir por qué`)
    }
  }
  if (result.status === 'failed' && !result.reason) {
    throw new Error(`marcar "${stage}" como fallida requiere un motivo`)
  }

  state.stages[stage] = {
    ...state.stages[stage],
    status: result.status,
    finishedAt: new Date().toISOString(),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.output ? { output: result.output } : {}),
  }

  if (result.status === 'failed') return // se queda en la etapa para reintentar

  const i = STAGES.indexOf(stage)
  if (i < STAGES.length - 1) state.stage = STAGES[i + 1]!
}

/**
 * El protocolo. Claude no decide qué etapa viene: se la pregunta a esto.
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
    gate: spec.gate ? 'Requiere aprobación humana antes de avanzar (Ley 5).' : null,
  }
  if (!isImplemented(stage)) {
    base.blocked = {
      reason: `La etapa "${stage}" entra en la fase ${spec.phase} de la spec y todavía no está construida.`,
      phase: spec.phase,
    }
  }
  return base
}
