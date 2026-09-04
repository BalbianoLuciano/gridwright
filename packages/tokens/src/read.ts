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

export function readTokenSystem(projectRoot: string, target?: string, file?: string): TokenSystem {
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

  for (const root of theme) {
    for (const prop of root.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      const section = unquote(prop.getName())
      if (section === 'extend') continue

      const init = prop.getInitializer()
      if (!init) continue
      sections.add(section)
      collect(init, section, SECTION_KINDS[section] ?? 'other', tokens, label)
    }
  }
  return { target: 'tailwind-config', file: label, tokens, sections: [...sections] }
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
): void {
  if (node.isKind?.(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of (node as ObjectLiteralExpression).getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
      const init = prop.getInitializer()
      if (init) collect(init, `${path}.${unquote(prop.getName())}`, kind, out, source)
    }
    return
  }

  if (node.isKind?.(SyntaxKind.StringLiteral) || node.isKind?.(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    const value = node.getLiteralValue?.() ?? unquote(node.getText())
    out.push({ name: path, kind, value, comparable: isComparable(value), source })
    return
  }

  if (node.isKind?.(SyntaxKind.ArrayLiteralExpression)) {
    // fontSize entries are ['1rem', { lineHeight: '1.5rem' }] — the size is what matters.
    const first = node.getElements?.()[0]
    if (first) collect(first, path, kind, out, source)
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
