/**
 * Layout de `.gridwright/` en el proyecto consumidor.
 *
 * No es todo descartable ni todo versionable: `runs/` y `dashboard/` son
 * andamio, `baselines/` es código de test (Ley 7) y se commitea. Si los
 * baselines no están en el repo, la suite de regresión no existe para nadie
 * más que quien la corrió.
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
  // baselines vive fuera de runs/ justamente porque sobrevive a la corrida
  baselines: (r: string) => join(r, GW_DIR, 'baselines'),
  dashboard: (r: string) => join(r, GW_DIR, 'dashboard'),
}

/** Lo que `gw init` escribe en el .gitignore del proyecto. */
export const GITIGNORE_BLOCK = `
# gridwright — runs y dashboard son andamio; baselines son tests
${GW_DIR}/runs/
${GW_DIR}/dashboard/
`
