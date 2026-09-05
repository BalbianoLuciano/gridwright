/**
 * Layout of `.gridwright/` inside the consuming project.
 *
 * It is neither all disposable nor all versionable: `runs/` and `dashboard/`
 * are scaffolding, `baselines/` is test code (Law 7) and gets committed. If the
 * baselines are not in the repo, the regression suite does not exist for anyone
 * but whoever ran it.
 */

import { join } from 'node:path'

export const GW_DIR = '.gridwright'

export const paths = {
  root: (r: string) => join(r, GW_DIR),
  runs: (r: string) => join(r, GW_DIR, 'runs'),
  run: (r: string, id: string) => join(r, GW_DIR, 'runs', id),
  state: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'state.json'),
  rawTree: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'figma-node.json'),
  ir: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'ir.json'),
  // Separate file, separate audience: the model reads ir.json, verify reads this.
  measurements: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'measurements.json'),
  rawTokens: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'raw-tokens.json'),
  resolutions: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'resolutions.json'),
  survey: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'survey.json'),
  reference: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'reference.png'),
  runAssets: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'assets'),
  manifest: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'manifest.json'),
  // baselines lives outside runs/ precisely because it outlives the run
  baselines: (r: string) => join(r, GW_DIR, 'baselines'),
  dashboard: (r: string) => join(r, GW_DIR, 'dashboard'),
  /** Screenshots and diffs from the last `gw verify`. Scaffolding: they are
   *  replaced on every run, and the ones worth keeping are copied to
   *  `baselines/` by `golden`. */
  verify: (r: string) => join(r, GW_DIR, 'verify'),
}

/**
 * What `gw init` appends to the project's .gitignore.
 *
 * `prefix` is the project's path relative to the .gitignore that will hold the
 * block, because gitignore patterns resolve against their own file. A project
 * nested under src/theme/ needs `src/theme/<name>/.gridwright/runs/`, not a
 * bare `.gridwright/runs/`.
 */
export function gitignoreBlock(prefix = ''): string {
  const at = prefix ? `${prefix.replace(/\/+$/, '')}/` : ''
  return `
# gridwright — everything here is scaffolding except baselines, which are tests
${at}${GW_DIR}/runs/
${at}${GW_DIR}/dashboard/
${at}${GW_DIR}/verify/
${at}${GW_DIR}/harness/
`
}
