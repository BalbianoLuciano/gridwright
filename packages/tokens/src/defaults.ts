/**
 * The scale a framework already gives you.
 *
 * Found by running against a real project. santillanafrancais declares only
 * `spacing.72` and `spacing.124`, with a comment on the line above saying
 * Tailwind's default scale covers everything else — and gridwright, reading
 * only the config, went ahead and proposed `16px` as a new token. Tailwind has
 * had that as `spacing.4` since forever.
 *
 * Proposing a token that already exists is precisely the rot Law 4 is written
 * to prevent, produced by the tool meant to prevent it. A project that follows
 * its framework's scale is doing the right thing, and reading its config alone
 * makes that look like an empty system.
 *
 * Data, not code (Law 9). Anything the project declares wins over these.
 */

import type { ExistingToken } from './read.js'

/** Tailwind's default spacing scale, in px. `rem` values are at the 16px root
 *  the framework itself assumes. */
const TAILWIND_SPACING: Record<string, string> = {
  '0': '0px', 'px': '1px', '0.5': '2px', '1': '4px', '1.5': '6px', '2': '8px',
  '2.5': '10px', '3': '12px', '3.5': '14px', '4': '16px', '5': '20px', '6': '24px',
  '7': '28px', '8': '32px', '9': '36px', '10': '40px', '11': '44px', '12': '48px',
  '14': '56px', '16': '64px', '20': '80px', '24': '96px', '28': '112px', '32': '128px',
  '36': '144px', '40': '160px', '44': '176px', '48': '192px', '52': '208px',
  '56': '224px', '60': '240px', '64': '256px', '72': '288px', '80': '320px', '96': '384px',
}

const TAILWIND_RADIUS: Record<string, string> = {
  'none': '0px', 'sm': '2px', 'DEFAULT': '4px', 'md': '6px', 'lg': '8px',
  'xl': '12px', '2xl': '16px', '3xl': '24px', 'full': '9999px',
}

const TAILWIND_BORDER: Record<string, string> = {
  '0': '0px', 'DEFAULT': '1px', '2': '2px', '4': '4px', '8': '8px',
}

/**
 * Tailwind's default font sizes.
 *
 * Only the size is listed, matching how `read.ts` stores a project's own
 * fontSize tuples — a line-height that differs from the default is a real
 * difference and should not be matched away.
 */
const TAILWIND_FONT_SIZE: Record<string, string> = {
  'xs': '12px', 'sm': '14px', 'base': '16px', 'lg': '18px', 'xl': '20px',
  '2xl': '24px', '3xl': '30px', '4xl': '36px', '5xl': '48px', '6xl': '60px',
  '7xl': '72px', '8xl': '96px', '9xl': '128px',
}

const SOURCE = 'tailwind (framework default)'

export function frameworkDefaults(target: string): ExistingToken[] {
  // Only Tailwind for now, and only where the target says so. Inventing a scale
  // for a project that does not use one would be worse than knowing none.
  if (target !== 'tailwind-config' && target !== 'tailwind-theme') return []

  const out: ExistingToken[] = []
  const add = (section: string, kind: ExistingToken['kind'], scale: Record<string, string>) => {
    for (const [name, value] of Object.entries(scale)) {
      out.push({ name: `${section}.${name}`, kind, value, comparable: true, source: SOURCE })
    }
  }

  add('spacing', 'spacing', TAILWIND_SPACING)
  add('borderRadius', 'radius', TAILWIND_RADIUS)
  add('borderWidth', 'border', TAILWIND_BORDER)
  add('fontSize', 'typography', TAILWIND_FONT_SIZE)
  return out
}

/**
 * Project tokens first, framework defaults behind them.
 *
 * Order matters: `resolve` takes the nearest match, and where both would fit,
 * the name the project chose is the one its own code already uses. A colour
 * named `section-gap` beats `spacing.14` even at the identical value.
 */
export function withDefaults(project: ExistingToken[], target: string): ExistingToken[] {
  const declared = new Set(project.map((t) => t.name))
  return [...project, ...frameworkDefaults(target).filter((d) => !declared.has(d.name))]
}

/** Whether a match came from the framework rather than the project. Reported at
 *  the gate, because "it is already in Tailwind" and "your team chose this" are
 *  different facts. */
export function isFrameworkDefault(token: ExistingToken): boolean {
  return token.source === SOURCE
}
