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
  if (!isComponentFolder(entry)) return null
  let present: string[]
  try {
    present = readdirSync(join(parent, entry))
  } catch {
    return null
  }
  const exts = PASCAL.test(entry) ? [...COMPONENT_EXTENSIONS, 'ts'] : COMPONENT_EXTENSIONS
  for (const ext of exts) {
    for (const name of [`index.${ext}`, `${entry}.${ext}`]) {
      const real = present.find((f) => loose(f) === loose(name))
      if (real) return join(parent, entry, real)
    }
  }
  return null
}
