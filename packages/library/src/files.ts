import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What counts as a component's file inside a directory — in one place.
 *
 * `placement.ts` counts these to decide whether a directory is the one the
 * project already uses for a kind of thing; `conventions.ts` reads the same
 * files to learn how the project writes a component. The two lists drifted:
 * one knew `<Name>/index.svelte` and the other did not. A directory that only
 * one of them recognised came back `found` — so `init` proposed nothing — with
 * no shape read from it, which is the `"shapes": []` that leaves `author`
 * without an example and `verify` without an export to mount.
 */

export const COMPONENT_EXTENSIONS = ['tsx', 'jsx', 'vue', 'svelte'] as const

/**
 * A component that is one file rather than a module a bundler resolves on its
 * own. The list was written out in four places — `addToBarrel`, `inferShape`,
 * `isComponentFile` and the import detector — and the barrel kept the
 * extension while the detector did not even know which files had one.
 */
export function isSingleFileComponent(file: string): boolean {
  return /\.(vue|svelte)$/.test(file)
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/
/** `hero-banner`, the same convention in the spelling Vue and Nuxt use. */
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** A directory that can hold one component: `HeroBanner` or `hero-banner`. */
export function isComponentFolder(entry: string): boolean {
  return PASCAL.test(entry) || KEBAB.test(entry)
}

/** The spelling that ignores what folders and files disagree on: case and hyphens. */
const loose = (name: string) => name.toLowerCase().replaceAll('-', '')

/**
 * Names that are never a component, however they are spelled. `.ts` is allowed
 * under a PascalCase folder, and comparing loosely made `Types/types.ts` match
 * `Types/Types.ts` — on every filesystem now, not only the case-insensitive
 * ones — so a directory of helpers was read as the shape of a directory of
 * components. `isComponentFile` has always refused these; the folder lookup
 * never did.
 */
const NOT_A_COMPONENT = /^(index|types|utils|helpers|constants|registry)$/i

/**
 * The file that represents a component folder — `<Name>/index.*` or
 * `<Name>/<Name>.*` — or null when the folder holds neither.
 *
 * A Vue project keeps `button/Button.vue` and `dialog-header/DialogHeader.vue`:
 * kebab folder, PascalCase file. Asking `existsSync('button/button.vue')`
 * answered yes on macOS by accident (APFS ignores case) and returned the wrong
 * spelling, and answered no on Linux, so one checkout read differently on two
 * machines. The folder is read instead, the name is compared loosely, and the
 * name returned is the one that is really on disk.
 *
 * `.ts` counts only under a PascalCase folder. The kebab spelling lets in
 * `utils/utils.ts` and `lib/index.ts`, which are not components and would be
 * counted as the directory's shape.
 */
export function folderComponent(parent: string, entry: string): string | null {
  if (!isComponentFolder(entry) || NOT_A_COMPONENT.test(entry)) return null
  let present: string[]
  try {
    present = readdirSync(join(parent, entry))
  } catch {
    return null
  }
  const exts = PASCAL.test(entry) ? [...COMPONENT_EXTENSIONS, 'ts'] : COMPONENT_EXTENSIONS
  for (const ext of exts) {
    for (const name of [`index.${ext}`, `${entry}.${ext}`]) {
      // Exact first. `loose` ignores hyphens too, so a folder holding both
      // `hero-banner.vue` and `herobanner.vue` matched whichever `readdirSync`
      // returned first — the per-filesystem reading this lookup exists to close.
      const real = present.find((f) => f === name) ?? present.find((f) => loose(f) === loose(name))
      if (real) return join(parent, entry, real)
    }
  }
  return null
}

/**
 * The name the codebase uses for the component in this file, or null when the
 * file is not one: `Card/index.tsx` and `Card.tsx` are both `Card`, and
 * `pricing-table/index.vue` is `PricingTable`.
 *
 * It lived twice — in `survey.ts` and in the CLI's `library.ts` — and both
 * copies required a leading capital. The `{name}` placeholder then started
 * writing `pricing-table/PricingTable.vue`, whose folder is the name for an
 * `index` file, so the name came back null: `survey` dropped the component
 * from its index and `library:register` fell back to the Figma frame name that
 * it documents as the thing never to use.
 *
 * The kebab spelling counts only for a single-file component, which is the rule
 * `isComponentFile` already applies: `button/index.ts` is shadcn-vue's barrel
 * sitting beside `Button.vue`, not a component called `Button`.
 */
export function componentName(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/')
  const file = parts[parts.length - 1] ?? ''
  const base = file.replace(/\.[^.]+$/, '')
  const name = base === 'index' ? (parts[parts.length - 2] ?? '') : base

  if (NOT_A_COMPONENT.test(name)) return null
  if (PASCAL.test(name)) return name
  if (isSingleFileComponent(file) && KEBAB.test(name)) return pascalCase(name)
  return null
}

/** `dialog-header` → `DialogHeader`, `grid-2-col` → `Grid2Col`. */
function pascalCase(name: string): string {
  return name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}
