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
  reference: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'reference.png'),
  runAssets: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'assets'),
  manifest: (r: string, id: string) => join(r, GW_DIR, 'runs', id, 'manifest.json'),
  // baselines lives outside runs/ precisely because it outlives the run
  baselines: (r: string) => join(r, GW_DIR, 'baselines'),
  dashboard: (r: string) => join(r, GW_DIR, 'dashboard'),
}

/** What `gw init` appends to the project's .gitignore. */
export const GITIGNORE_BLOCK = `
# gridwright — runs and dashboard are scaffolding; baselines are tests
${GW_DIR}/runs/
${GW_DIR}/dashboard/
`
