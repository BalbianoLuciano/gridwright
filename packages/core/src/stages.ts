/**
 * The pipeline stages, in order. It is the spec's table, in code.
 *
 * `auth` is deliberately absent: it is a precondition, not a stage. `gw next`
 * checks it before opening the run, because there is no point leaving a
 * half-created run behind only for it to die in `fetch`.
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

/** Who runs the stage. Law 3: if it can be checked with an assert, the model
 *  does not do it; if it needs judgment about existing code, the program does
 *  not do it. */
export type Actor = 'code' | 'agent' | 'human'

export interface StageSpec {
  id: Stage
  actor: Actor
  /** Needs human approval before advancing (Law 5). */
  gate: boolean
  /** Cannot be marked `skipped`. These are the three that build the system. */
  mandatory: boolean
  /** If not built yet, which spec phase it belongs to. Reported explicitly
   *  rather than pretending the stage ran. */
  phase: 1 | 2 | 3 | 4 | 5
  summary: string
}

export const STAGE_SPECS: Record<Stage, StageSpec> = {
  'init': {
    id: 'init', actor: 'human', gate: true, mandatory: false, phase: 1,
    summary: 'Configure the project: framework, paths, tokens, viewports',
  },
  'fetch': {
    id: 'fetch', actor: 'code', gate: false, mandatory: false, phase: 1,
    summary: 'Pull the tree, the reference image and the assets from Figma',
  },
  'distill': {
    id: 'distill', actor: 'code', gate: false, mandatory: false, phase: 1,
    summary: 'Distill the raw tree into the IR',
  },
  'resolve': {
    id: 'resolve', actor: 'code', gate: false, mandatory: false, phase: 4,
    summary: 'Sort the design values into exact / near / new',
  },
  'tokens': {
    id: 'tokens', actor: 'agent', gate: true, mandatory: true, phase: 4,
    summary: "Name and write the new tokens into the project's system",
  },
  'library:ensure': {
    id: 'library:ensure', actor: 'code', gate: true, mandatory: true, phase: 4,
    summary: 'Make sure the component library exists',
  },
  'survey': {
    id: 'survey', actor: 'code', gate: false, mandatory: false, phase: 5,
    summary: 'Index the repo and look for reusable components',
  },
  'plan': {
    id: 'plan', actor: 'agent', gate: true, mandatory: false, phase: 3,
    summary: 'Propose files, props and what gets reused',
  },
  'author': {
    id: 'author', actor: 'agent', gate: false, mandatory: false, phase: 3,
    summary: 'Write the component',
  },
  'harness': {
    id: 'harness', actor: 'code', gate: false, mandatory: false, phase: 2,
    summary: 'Mount the component in an isolated ephemeral Vite',
  },
  'verify': {
    id: 'verify', actor: 'code', gate: false, mandatory: false, phase: 2,
    summary: 'Render, measure the three dimensions and compute the score',
  },
  'refine': {
    id: 'refine', actor: 'agent', gate: false, mandatory: false, phase: 3,
    summary: 'Fix using the diff focused by dimension',
  },
  'golden': {
    id: 'golden', actor: 'human', gate: true, mandatory: false, phase: 4,
    summary: 'Freeze the baseline and write the regression test',
  },
  'library:register': {
    id: 'library:register', actor: 'code', gate: false, mandatory: true, phase: 4,
    summary: 'Add the component to the barrel and the registry',
  },
  'report': {
    id: 'report', actor: 'code', gate: false, mandatory: false, phase: 4,
    summary: 'Generate the run dashboard',
  },
}

/**
 * Development phase that is built today. Anything in a higher phase reports
 * "not implemented" instead of pretending.
 *
 * Being built is not the same as being reachable. Phases 2 and 3 are done, but
 * `tokens` and `library:ensure` sit at stages 4 and 5, are mandatory, and
 * belong to phase 4 — so a run still stops before it can get to `author` or
 * `verify`. `gw verify` and `gw refine` work standalone precisely because of
 * this; phase 4 is what opens the pipeline end to end.
 */
export const IMPLEMENTED_THROUGH_PHASE = 3

/** The first stage a run cannot get past today, or null when it can run through. */
export function firstBlockingStage(): Stage | null {
  return STAGES.find((s) => !isImplemented(s)) ?? null
}

export function isImplemented(stage: Stage): boolean {
  return STAGE_SPECS[stage].phase <= IMPLEMENTED_THROUGH_PHASE
}

export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current)
  return i === -1 || i === STAGES.length - 1 ? null : STAGES[i + 1]!
}
