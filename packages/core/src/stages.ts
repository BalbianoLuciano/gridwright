/**
 * Las etapas del pipeline, en orden. Es la tabla de la spec, en código.
 *
 * `auth` no está acá a propósito: es una precondición, no una etapa. `gw next`
 * la chequea antes de abrir el run, porque no tiene sentido dejar una corrida a
 * medio crear para que muera en `fetch`.
 */

export const STAGES = [
  'init',
  'fetch',
  'distill',
  'resolve',
  'tokens',
  'library:ensure',
  'survey',
  'plan',
  'author',
  'harness',
  'verify',
  'refine',
  'golden',
  'library:register',
  'report',
] as const

export type Stage = (typeof STAGES)[number]

/** Quién ejecuta la etapa. Ley 3: si se puede verificar con un assert, no la
 *  hace el modelo; si necesita criterio sobre el código existente, no la hace
 *  el programa. */
export type Actor = 'code' | 'agent' | 'human'

export interface StageSpec {
  id: Stage
  actor: Actor
  /** Requiere aprobación humana antes de avanzar (Ley 5). */
  gate: boolean
  /** No se puede marcar `skipped`. Son las tres que construyen el sistema. */
  mandatory: boolean
  /** Si todavía no se implementó, en qué fase de la spec entra. Se reporta
   *  explícitamente en vez de fingir que se ejecutó. */
  phase: 1 | 2 | 3 | 4 | 5
  summary: string
}

export const STAGE_SPECS: Record<Stage, StageSpec> = {
  'init': {
    id: 'init', actor: 'human', gate: true, mandatory: false, phase: 1,
    summary: 'Configurar el proyecto: framework, rutas, tokens, viewports',
  },
  'fetch': {
    id: 'fetch', actor: 'code', gate: false, mandatory: false, phase: 1,
    summary: 'Traer de Figma el árbol, la imagen de referencia y los assets',
  },
  'distill': {
    id: 'distill', actor: 'code', gate: false, mandatory: false, phase: 1,
    summary: 'Destilar el árbol crudo al IR',
  },
  'resolve': {
    id: 'resolve', actor: 'code', gate: false, mandatory: false, phase: 4,
    summary: 'Clasificar los valores del diseño en exact / near / new',
  },
  'tokens': {
    id: 'tokens', actor: 'agent', gate: true, mandatory: true, phase: 4,
    summary: 'Nombrar y escribir los tokens nuevos al sistema del proyecto',
  },
  'library:ensure': {
    id: 'library:ensure', actor: 'code', gate: true, mandatory: true, phase: 4,
    summary: 'Garantizar que exista la component library',
  },
  'survey': {
    id: 'survey', actor: 'code', gate: false, mandatory: false, phase: 5,
    summary: 'Indexar el repo y buscar componentes reutilizables',
  },
  'plan': {
    id: 'plan', actor: 'agent', gate: true, mandatory: false, phase: 3,
    summary: 'Proponer archivos, props y qué se reutiliza',
  },
  'author': {
    id: 'author', actor: 'agent', gate: false, mandatory: false, phase: 3,
    summary: 'Escribir el componente',
  },
  'harness': {
    id: 'harness', actor: 'code', gate: false, mandatory: false, phase: 2,
    summary: 'Montar el componente en un Vite efímero aislado',
  },
  'verify': {
    id: 'verify', actor: 'code', gate: false, mandatory: false, phase: 2,
    summary: 'Renderizar, medir las tres dimensiones y calcular el score',
  },
  'refine': {
    id: 'refine', actor: 'agent', gate: false, mandatory: false, phase: 3,
    summary: 'Corregir con el diff enfocado por dimensión',
  },
  'golden': {
    id: 'golden', actor: 'human', gate: true, mandatory: false, phase: 4,
    summary: 'Congelar el baseline y escribir el test de regresión',
  },
  'library:register': {
    id: 'library:register', actor: 'code', gate: false, mandatory: true, phase: 4,
    summary: 'Agregar el componente al barrel y al registry',
  },
  'report': {
    id: 'report', actor: 'code', gate: false, mandatory: false, phase: 4,
    summary: 'Generar el dashboard de la corrida',
  },
}

/** Fase de desarrollo que está construida hoy. Todo lo de fases superiores
 *  reporta "no implementado" en vez de fingir. */
export const IMPLEMENTED_THROUGH_PHASE = 1

export function isImplemented(stage: Stage): boolean {
  return STAGE_SPECS[stage].phase <= IMPLEMENTED_THROUGH_PHASE
}

export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current)
  return i === -1 || i === STAGES.length - 1 ? null : STAGES[i + 1]!
}
