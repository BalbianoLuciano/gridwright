/**
 * Reading the design tokens a project already has.
 *
 * Parsed from source rather than imported and executed. A real Tailwind config
 * imports plugins, and importing it from gridwright would resolve those against
 * the wrong node_modules — santillanafrancais brings in `@tailwindcss/typography`
 * and a `plugin()` helper, and evaluating that file out of context fails before
 * a single token is read.
 *
 * The cost is that computed values are opaque: a colour built as
 * `rgb(var(--sf-primary-500, 0 134 155) / <alpha-value>)` is recorded as
 * existing, but cannot be compared by ΔE. That is the honest outcome — it is
 * recorded as unmatchable rather than quietly ignored.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Project, SyntaxKind, type ObjectLiteralExpression } from 'ts-morph'
import { withDefaults } from './defaults.js'

export type TokenKind = 'color' | 'spacing' | 'typography' | 'radius' | 'shadow' | 'border' | 'other'

export interface ExistingToken {
  /** Dotted path as the project names it, e.g. "colors.primary.500". */
  name: string
  kind: TokenKind
  value: string
  /** A literal we can compare against, or a computed expression we cannot. */
  comparable: boolean
  source: string
}

export interface TokenSystem {
  target: 'tailwind-config' | 'tailwind-theme' | 'css-vars' | 'none'
  file?: string
  tokens: ExistingToken[]
  /** Section paths found in the config, so new tokens land where their kind
   *  already lives rather than in a section invented for them. */
  sections: string[]
}

const SECTION_KINDS: Record<string, TokenKind> = {
  colors: 'color', backgroundColor: 'color', textColor: 'color', borderColor: 'color',
  spacing: 'spacing', gap: 'spacing', padding: 'spacing', margin: 'spacing',
  fontSize: 'typography', fontFamily: 'typography', fontWeight: 'typography', lineHeight: 'typography',
  borderRadius: 'radius', boxShadow: 'shadow', borderWidth: 'border',
}

/**
 * The project's tokens, plus the scale its framework already provides.
 *
 * Reading the config alone makes a project that follows Tailwind's default
 * scale look like it has no scale at all, and every value in the design then
 * arrives as new.
 */
export function readTokenSystem(projectRoot: string, target?: string, file?: string): TokenSystem {
  const system = readDeclared(projectRoot, target, file)
  return { ...system, tokens: withDefaults(system.tokens, system.target) }
}

function readDeclared(projectRoot: string, target?: string, file?: string): TokenSystem {
  if (file) {
    const abs = join(projectRoot, file)
    if (existsSync(abs)) {
      if (target === 'tailwind-config') return readTailwindConfig(abs, file)
      if (target === 'tailwind-theme' || target === 'css-vars') return readCss(abs, file, target)
    }
  }

  for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']) {
    const abs = join(projectRoot, name)
    if (existsSync(abs)) return readTailwindConfig(abs, name)
  }
  return { target: 'none', tokens: [], sections: [] }
}

/**
 * Walks `theme` (and `theme.extend`) collecting every string leaf.
 *
 * Nested objects become dotted names, which is how Tailwind addresses them
 * anyway: `colors.primary.500` is the `primary-500` utility.
 */
export function readTailwindConfig(absPath: string, label: string): TokenSystem {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  const source = project.addSourceFileAtPath(absPath)
  const tokens: ExistingToken[] = []
  const sections = new Set<string>()

  const theme = findTheme(source)
  if (!theme) return { target: 'tailwind-config', file: label, tokens: [], sections: [] }

  const literals = collectLiteralMaps(source)

  for (const root of theme) {
    for (const prop of root.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      const section = unquote(prop.getName())
      if (section === 'extend') continue

      const init = prop.getInitializer()
      if (!init) continue
      sections.add(section)
      collect(init, section, SECTION_KINDS[section] ?? 'other', tokens, label, literals)
    }
  }
  return { target: 'tailwind-config', file: label, tokens, sections: [...sections] }
}

/**
 * Module-level maps of plain string values, keyed by their own key.
 *
 * Configs of any size stop writing values inline. santillanafrancais keeps a
 * `HEX` map and emits every colour as `color('neutral-700')`, so a reader that
 * stops at the function call sees a config with no comparable colours at all —
 * and then proposes `#4b5561` as new when `neutral-700` has been exactly that
 * since the palette was dumped from Figma.
 *
 * Following one level of indirection is the difference between resolving
 * against a project's palette and inventing a second one beside it.
 */
function collectLiteralMaps(source: ReturnType<Project['addSourceFileAtPath']>): Map<string, string> {
  const out = new Map<string, string>()
  for (const decl of source.getVariableDeclarations()) {
    const init = decl.getInitializer()
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    for (const prop of init.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      const value = prop.getInitializer()
      if (!value?.isKind(SyntaxKind.StringLiteral)) continue
      const key = unquote(prop.getName())
      // First declaration wins: a later map keyed the same way is a different
      // scale, and guessing between them is worse than using neither.
      if (!out.has(key)) out.set(key, value.getLiteralValue())
    }
  }
  return out
}

function findTheme(source: ReturnType<Project['addSourceFileAtPath']>): ObjectLiteralExpression[] {
  const out: ObjectLiteralExpression[] = []
  for (const obj of source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of obj.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      if (unquote(prop.getName()) !== 'theme') continue
      const init = prop.getInitializer()
      if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) continue
      out.push(init)
      // `extend` is where projects actually put their own tokens.
      const ext = init.getProperty('extend')
      if (ext?.isKind(SyntaxKind.PropertyAssignment)) {
        const extInit = ext.getInitializer()
        if (extInit?.isKind(SyntaxKind.ObjectLiteralExpression)) out.push(extInit)
      }
    }
  }
  return out
}

function collect(
  node: ReturnType<ObjectLiteralExpression['getProperties']>[number] | any,
  path: string,
  kind: TokenKind,
  out: ExistingToken[],
  source: string,
  literals: Map<string, string> = new Map(),
): void {
  if (node.isKind?.(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of (node as ObjectLiteralExpression).getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      const init = prop.getInitializer()
      if (init) collect(init, `${path}.${unquote(prop.getName())}`, kind, out, source, literals)
    }
    return
  }

  // `color('neutral-700')` — a helper over a map of values. One level of
  // indirection, and only when the argument is a literal we can look up.
  if (node.isKind?.(SyntaxKind.CallExpression)) {
    const args = node.getArguments?.() ?? []
    const first = args[0]
    if (args.length === 1 && first?.isKind?.(SyntaxKind.StringLiteral)) {
      const resolved = literals.get(first.getLiteralValue())
      if (resolved) {
        out.push({ name: path, kind, value: resolved, comparable: isComparable(resolved), source })
        return
      }
    }
  }

  if (node.isKind?.(SyntaxKind.StringLiteral) || node.isKind?.(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    const value = node.getLiteralValue?.() ?? unquote(node.getText())
    out.push({ name: path, kind, value, comparable: isComparable(value), source })
    return
  }

  if (node.isKind?.(SyntaxKind.ArrayLiteralExpression)) {
    // fontSize entries are ['1rem', { lineHeight: '1.5rem' }] — the size is what matters.
    const first = node.getElements?.()[0]
    if (first) collect(first, path, kind, out, source, literals)
    return
  }

  // Anything else — a call, a template with substitutions, a variable — exists
  // but cannot be compared. Recorded so it is never proposed as "new".
  out.push({ name: path, kind, value: node.getText?.() ?? '', comparable: false, source })
}

/** A value we can hold against a design value: a hex, or a plain length. */
function isComparable(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())
    || /^-?\d+(\.\d+)?(px|rem|em|%)$/.test(value.trim())
}

/** Tailwind v4's `@theme` block, and plain custom properties. */
export function readCss(absPath: string, label: string, target?: string): TokenSystem {
  const src = readFileSync(absPath, 'utf8')
  const tokens: ExistingToken[] = []
  const sections = new Set<string>()

  for (const m of src.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = m[1]!.trim()
    const value = m[2]!.trim()
    const kind = kindFromName(name)
    sections.add(name.split('-')[0]!)
    tokens.push({ name: `--${name}`, kind, value, comparable: isComparable(value), source: label })
  }

  return {
    target: (target as TokenSystem['target']) ?? (/@theme\b/.test(src) ? 'tailwind-theme' : 'css-vars'),
    file: label,
    tokens,
    sections: [...sections],
  }
}

function kindFromName(name: string): TokenKind {
  if (/^color|^bg|colou?r/.test(name)) return 'color'
  if (/^spacing|^space|^gap/.test(name)) return 'spacing'
  if (/^font|^text|^leading|^tracking/.test(name)) return 'typography'
  if (/^radius|^rounded/.test(name)) return 'radius'
  if (/^shadow/.test(name)) return 'shadow'
  if (/^border/.test(name)) return 'border'
  return 'other'
}

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '')
}
