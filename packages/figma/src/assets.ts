/**
 * Extracción de assets. Es el puerto de
 * `prolicht/tools/figma/figma-image-extractor.cjs`, con tres cambios.
 *
 * 1. Encuentra el frame MÁS CHICO que contiene una imagen, no la imagen suelta.
 *    Ese detalle venía del original y es el que hace que el asset salga con el
 *    tamaño del diseño y no con el tamaño de origen del bitmap.
 * 2. `sharp.trim()` para sacar las transparencias que Figma agrega alrededor
 *    del contenido: sin esto aparecen los cuadraditos de checkerboard sobre
 *    fondos claros y las dimensiones no coinciden con el diseño.
 * 3. Las URLs firmadas de Figma NO se guardan en el manifest (Ley 10.c). El
 *    original las tenía a mano; son credenciales temporales con patas.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FigmaClient } from './client.js'
import type { FigmaNode } from './types.js'
import { hasImageFill, slugify } from './distill.js'

export interface AssetRecord {
  file: string
  layer: string
  layerPath: string
  nodeId: string
  width: number
  height: number
  bytes: number
  /** Cuánto achicó el trim, si achicó. Es la señal de que había transparencias. */
  trimmed?: { from: string; to: string }
}

export interface AssetManifest {
  extractedAt: string
  sourceFile: string
  sourceNode: string
  assets: AssetRecord[]
  /** Si sharp no estaba disponible se guardan igual, sin optimizar, y se avisa. */
  optimized: boolean
}

interface ImageTarget {
  id: string
  name: string
  path: string
  width: number
  height: number
}

/** Frames con imagen, no imágenes sueltas. Cuando un nodo tiene image fill
 *  directo se exporta ESE nodo y se corta la recursión: capturar además a sus
 *  hijos duplicaría el mismo bitmap. */
export function findImageTargets(node: FigmaNode, parentPath = '', out: ImageTarget[] = []): ImageTarget[] {
  const path = parentPath ? `${parentPath} / ${node.name}` : node.name
  if (node.visible === false) return out

  if (hasImageFill(node)) {
    const box = node.absoluteBoundingBox
    out.push({
      id: node.id,
      name: node.name,
      path,
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    })
    return out
  }
  for (const child of node.children ?? []) findImageTargets(child, path, out)
  return out
}

export async function extractAssets(
  client: FigmaClient,
  root: FigmaNode,
  source: { fileKey: string; nodeId: string },
  outDir: string,
  opts: { scale?: number; prefix?: string } = {},
): Promise<AssetManifest> {
  const targets = findImageTargets(root)
  mkdirSync(outDir, { recursive: true })

  const sharp = await loadSharp()
  const manifest: AssetManifest = {
    extractedAt: new Date().toISOString(),
    sourceFile: source.fileKey,
    sourceNode: source.nodeId,
    assets: [],
    optimized: sharp !== null,
  }

  if (targets.length === 0) {
    writeManifest(outDir, manifest)
    return manifest
  }

  // Las URLs viven sólo dentro de esta función: se consumen y se descartan.
  const urls = await client.imageUrls(source.fileKey, targets.map((t) => t.id), { scale: opts.scale ?? 2 })

  const used = new Set<string>()
  for (const target of targets) {
    const url = urls.get(target.id)
    if (!url) continue

    const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
    const file = uniqueName(nameFor(target.name, opts.prefix), used)
    const dest = join(outDir, file)

    const record: AssetRecord = {
      file, layer: target.name, layerPath: target.path, nodeId: target.id,
      width: target.width, height: target.height, bytes: buf.length,
    }

    if (sharp) {
      const before = await sharp(buf).metadata()
      const out = await sharp(buf).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toBuffer()
      const after = await sharp(out).metadata()
      writeFileSync(dest, out)
      record.bytes = out.length
      if (before.width !== after.width || before.height !== after.height) {
        record.trimmed = { from: `${before.width}x${before.height}`, to: `${after.width}x${after.height}` }
      }
      record.width = after.width ?? record.width
      record.height = after.height ?? record.height
    } else {
      writeFileSync(dest, buf)
    }

    manifest.assets.push(record)
  }

  writeManifest(outDir, manifest)
  return manifest
}

function writeManifest(dir: string, m: AssetManifest): void {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
}

function nameFor(layerName: string, prefix?: string): string {
  const slug = slugify(layerName)
  // El original trataba hero/banner distinto porque es el asset que casi
  // siempre se usa como fondo y conviene poder encontrarlo por nombre.
  if (/hero|banner/.test(slug)) return prefix ? `hero-${prefix}.png` : 'hero.png'
  return prefix ? `${prefix}-${slug}.png` : `${slug}.png`
}

/** Dos layers pueden llamarse igual. El original resolvía con índice global,
 *  lo que hacía que agregar una imagen renombrara todas las demás. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name }
  const base = name.replace(/\.png$/, '')
  let i = 2
  while (used.has(`${base}-${i}.png`)) i++
  const final = `${base}-${i}.png`
  used.add(final)
  return final
}

/** sharp es un módulo nativo: si no está, se guardan los assets sin optimizar
 *  en vez de romper toda la corrida. */
async function loadSharp(): Promise<((input?: Buffer) => any) | null> {
  try {
    const mod = await import('sharp')
    return (mod.default ?? mod) as any
  } catch {
    return null
  }
}
