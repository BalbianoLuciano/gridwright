/**
 * Law 9 — Every tunable rule is data.
 *
 * Changing the fidelity threshold must not require touching the diff
 * algorithm. Everything here that has a default has one because the default is
 * useful, not because the value does not matter.
 *
 * The token NEVER goes here: this file is committed (Law 10.b).
 */

import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type Framework = 'vue3' | 'react19'

export interface Viewport {
  name: string
  width: number
  height: number
}

/** How this project writes a component, learned from the ones already there.
 *  Not the same question as where they live: a project can have several shapes
 *  and writing the wrong one produces a file that renders and does not work. */
export interface ComponentShape {
  dir: string
  file: string
  export: string
  alsoExports: string[]
  seenIn: number
  example?: string
}

export interface GridwrightConfig {
  $schema?: string
  framework: Framework
  conventions?: {
    shapes: ComponentShape[]
    /** The responsive prefixes the project has. A component written with
     *  Tailwind's defaults against a project that renamed them lays out as
     *  though it had no responsive rules — silently. */
    breakpoints?: Array<{ name: string; width: string }>
    /** The extension this project puts on a relative import, '' for none.
     *  Under `moduleResolution: node16` a bare specifier does not compile, and
     *  the barrel gridwright writes has to obey the same rule as the files
     *  around it. */
    importExtension?: string
    /**
     * Where each kind of thing goes: a page module, a whole view, a layout
     * part, a primitive, an overlay.
     *
     * `shapes` says how a file in a directory is written; this says what the
     * directory is *for*. Without it everything landed in whichever directory
     * had the most files, so a header, a modal and a view were all filed as
     * page modules — which is not untidiness, it is what stops a component
     * library being browsable at about forty entries.
     */
    placements?: Array<{ kind: string; dir: string; from: string; alternatives?: string[] }>
    /** Docs the project keeps about its own rules. `author` reads these first —
     *  they carry what no amount of file-shape inference will find. */
    docs: string[]
  }
  /** Where the component library lives. Created if missing (the
   *  `library:ensure` stage), with the bare minimum: folder, barrel, registry. */
  library: {
    dir: string
    barrel: string
    registry: string
  }
  assets: {
    dir: string
    /** How the asset is referenced from the component. `{path}` is replaced. */
    importPrefix: string
  }
  tokens: {
    /** Where the project's tokens are declared.
     *  `auto` looks for them instead of assuming a tool version: a project can
     *  run Tailwind 4 and still declare its tokens in a legacy
     *  tailwind.config.js. The real world mixes both shapes. */
    target: 'auto' | 'tailwind-config' | 'tailwind-theme' | 'css-vars'
    file?: string
    /** CIEDE2000 ΔE below which two colors are the same color. 1.0 is the
     *  "just noticeable" threshold for a trained eye. */
    colorToleranceDeltaE: number
    /** How many new tokens a single run may propose before it is a sign that
     *  the design drifted out of the system and it is worth stopping. */
    maxNewPerRun: number
  }
  verify: {
    viewports: Viewport[]
    /** The stylesheets to render with, relative to the project root, in load
     *  order. Leave it out and `verify` looks for one under the usual names;
     *  set it when the project calls its stylesheet something else. */
    css?: string[]
    /** Law 6. The weights add up to 1. Structural carries half because it is
     *  the only dimension without rendering noise. */
    weights: { structural: number; chromatic: number; perceptual: number }
    /** Minimum passing score, over the WORST viewport, not the average. */
    threshold: number
    /** Pixel tolerance when matching bounding boxes. */
    boxTolerancePx: number
    maxRefineIterations: number
  }
  distill: {
    /** How many absolutely positioned nodes are tolerated before halting. If
     *  the Figma does not use auto-layout there is no layout to extract, and
     *  halting beats emitting two hundred lines that merely look right. */
    maxAbsoluteNodes: number
    maxDepth: number
  }
}

export const DEFAULT_CONFIG: GridwrightConfig = {
  framework: 'vue3',
  library: {
    dir: 'src/components/ui',
    barrel: 'src/components/ui/index.ts',
    registry: 'src/components/ui/registry.json',
  },
  assets: {
    dir: 'src/assets/images',
    importPrefix: '@/assets/images/{path}',
  },
  tokens: {
    target: 'auto',
    colorToleranceDeltaE: 1.0,
    maxNewPerRun: 12,
  },
  verify: {
    viewports: [
      { name: 'mobile', width: 375, height: 812 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1440, height: 900 },
    ],
    weights: { structural: 0.5, chromatic: 0.25, perceptual: 0.25 },
    threshold: 90,
    boxTolerancePx: 2,
    maxRefineIterations: 4,
  },
  distill: {
    maxAbsoluteNodes: 5,
    maxDepth: 12,
  },
}

export const CONFIG_FILENAME = 'gridwright.config.json'

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME)
}

export function loadConfig(root: string): GridwrightConfig | null {
  const path = configPath(root)
  if (!existsSync(path)) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<GridwrightConfig>
  // Shallow merge per section: lets a repo keep a minimal config without
  // restating every default.
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    library: { ...DEFAULT_CONFIG.library, ...parsed.library },
    assets: { ...DEFAULT_CONFIG.assets, ...parsed.assets },
    tokens: { ...DEFAULT_CONFIG.tokens, ...parsed.tokens },
    verify: { ...DEFAULT_CONFIG.verify, ...parsed.verify },
    distill: { ...DEFAULT_CONFIG.distill, ...parsed.distill },
  }
}

export function writeConfig(root: string, config: GridwrightConfig): string {
  const path = configPath(root)
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return path
}

/** The verify weights have to add up to 1 or the score means nothing. */
export function validateConfig(c: GridwrightConfig): string[] {
  const errors: string[] = []
  const { structural, chromatic, perceptual } = c.verify.weights
  const sum = structural + chromatic + perceptual
  if (Math.abs(sum - 1) > 1e-6) {
    errors.push(`verify.weights adds up to ${sum.toFixed(3)}, it has to add up to 1`)
  }
  if (c.verify.threshold < 0 || c.verify.threshold > 100) {
    errors.push(`verify.threshold ${c.verify.threshold} is outside 0-100`)
  }
  if (c.verify.viewports.length === 0) {
    errors.push('verify.viewports cannot be empty')
  }
  if (c.verify.maxRefineIterations < 1) {
    errors.push('verify.maxRefineIterations has to be at least 1')
  }
  // Hand-edited, because the message that mentions it invites exactly that. A
  // string instead of an array iterates per character, and the run aborted
  // with "verify.css names a stylesheet that does not exist: s, r, c, /, m…".
  if (c.verify.css !== undefined) {
    if (!Array.isArray(c.verify.css)) {
      errors.push('verify.css has to be a list of paths: "css": ["src/main.css"]')
    } else if (c.verify.css.some((p) => typeof p !== 'string' || p.trim() === '')) {
      errors.push('verify.css has an entry that is not a path')
    }
  }
  return errors
}
