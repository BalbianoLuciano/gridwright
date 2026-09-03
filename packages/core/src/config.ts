/**
 * Ley 9 — Toda regla ajustable es dato.
 *
 * Cambiar el umbral de fidelidad no puede requerir tocar el algoritmo de diff.
 * Todo lo que acá tiene un default es porque el default sirve, no porque no
 * importe.
 *
 * El token NUNCA va acá: este archivo se commitea (Ley 10.b).
 */

import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type Framework = 'vue3' | 'react19'

export interface Viewport {
  name: string
  width: number
  height: number
}

export interface GridwrightConfig {
  $schema?: string
  framework: Framework
  /** Dónde vive la component library. Se crea si no existe (etapa
   *  `library:ensure`), con lo mínimo: carpeta + barrel + registry. */
  library: {
    dir: string
    barrel: string
    registry: string
  }
  assets: {
    dir: string
    /** Cómo se referencia el asset desde el componente. `{path}` se reemplaza. */
    importPrefix: string
  }
  tokens: {
    /** Dónde están declarados los tokens del proyecto.
     *  `auto` los busca en vez de asumir la versión de la herramienta: prolicht
     *  corre Tailwind 4.1.18 y a la vez tiene tailwind.config.js con
     *  theme.extend. El mundo real mezcla las dos formas. */
    target: 'auto' | 'tailwind-config' | 'tailwind-theme' | 'css-vars'
    file?: string
    /** ΔE CIEDE2000 por debajo del cual dos colores son el mismo color.
     *  1.0 es el umbral de "apenas perceptible" para un ojo entrenado. */
    colorToleranceDeltaE: number
    /** Cuántos tokens nuevos puede proponer una corrida antes de que sea señal
     *  de que el diseño se salió del sistema y conviene frenar. */
    maxNewPerRun: number
  }
  verify: {
    viewports: Viewport[]
    /** Ley 6. Los pesos suman 1. La estructural pesa la mitad porque es la
     *  única sin ruido de rendering. */
    weights: { structural: number; chromatic: number; perceptual: number }
    /** Score mínimo para aprobar, sobre el PEOR viewport, no el promedio. */
    threshold: number
    /** Tolerancia en píxeles para el matcheo de bounding boxes. */
    boxTolerancePx: number
    maxRefineIterations: number
  }
  distill: {
    /** Cuántos nodos con posición absoluta se toleran antes de frenar. Si el
     *  Figma no usa auto-layout no hay layout que extraer, y es preferible
     *  frenar que generar doscientas líneas que parecen bien. */
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
  // Merge superficial por sección: permite un config mínimo en el repo sin
  // tener que repetir todos los defaults.
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

/** Los pesos de verify tienen que sumar 1 o el score no significa nada. */
export function validateConfig(c: GridwrightConfig): string[] {
  const errors: string[] = []
  const { structural, chromatic, perceptual } = c.verify.weights
  const sum = structural + chromatic + perceptual
  if (Math.abs(sum - 1) > 1e-6) {
    errors.push(`verify.weights suma ${sum.toFixed(3)}, tiene que sumar 1`)
  }
  if (c.verify.threshold < 0 || c.verify.threshold > 100) {
    errors.push(`verify.threshold ${c.verify.threshold} está fuera de 0-100`)
  }
  if (c.verify.viewports.length === 0) {
    errors.push('verify.viewports no puede estar vacío')
  }
  if (c.verify.maxRefineIterations < 1) {
    errors.push('verify.maxRefineIterations tiene que ser al menos 1')
  }
  return errors
}
