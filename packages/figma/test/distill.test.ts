import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { distill, shouldHalt, type FigmaNode } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')) as FigmaNode

const OPTS = { maxAbsoluteNodes: 5, maxDepth: 12 }
const SOURCE = { fileKey: 'D7qfUlKn', nodeId: '3978:35299' }

describe('distill — auto-layout es flex, uno a uno', () => {
  const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)

  it('traduce layoutMode e itemSpacing sin inventar', () => {
    expect(ir.layout).toMatchObject({ kind: 'flex', dir: 'col', gap: 24 })
  })

  it('traduce los alineamientos de ambos ejes', () => {
    expect(ir.layout.justify).toBe('center')
    expect(ir.layout.align).toBe('center')
  })

  it('lee el padding en orden CSS', () => {
    expect(ir.layout.padding).toEqual([48, 32, 48, 32])
  })

  // Es la consecuencia buscada: Figma no da margins entre hermanos, así que
  // gridwright no los puede generar. La regla se cumple sola.
  it('no produce ninguna noción de margin', () => {
    expect(JSON.stringify(ir)).not.toContain('margin')
  })
})

describe('distill — roles y contenido', () => {
  const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
  const flat = (ns = ir.children): any[] => ns.flatMap((n) => [n, ...flat(n.children ?? [])])

  it('detecta la imagen por su fill', () => {
    expect(flat().find((n) => n.role === 'image')).toMatchObject({ asset: 'hero-background.png' })
  })

  it('calcula la relación de aspecto reducida', () => {
    expect(flat().find((n) => n.role === 'image')?.ratio).toBe('32/9')
  })

  it('clasifica 48px como heading nivel 1 y 16px como texto', () => {
    expect(flat().find((n) => n.name === 'Title')).toMatchObject({ role: 'heading', level: 1 })
    expect(flat().find((n) => n.name === 'Description')?.role).toBe('text')
  })

  // El copy del diseño va como default del prop, no hardcodeado en el markup.
  it('guarda el copy como valor por defecto y le da nombre de slot', () => {
    const title = flat().find((n) => n.name === 'Title')
    expect(title?.default).toBe('Sobre nosotros')
    expect(title?.slot).toBe('title')
  })

  it('ignora los layers ocultos', () => {
    expect(flat().some((n) => n.name === 'Frame 427')).toBe(false)
  })
})

describe('distill — colapso de envoltorios', () => {
  // "Wrapper" tiene un solo hijo, sin padding, sin gap y sin fondo: no aporta
  // nada y sólo agregaría un div. Es la diferencia entre un IR de 120 líneas y
  // uno de 400.
  it('colapsa el container de un solo hijo sin estilo propio', () => {
    const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(ir.children.some((n) => n.name === 'Wrapper')).toBe(false)
    expect(ir.children.some((n) => n.name === 'Title')).toBe(true)
  })
})

describe('distill — tokens crudos', () => {
  const { ir, rawTokens } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)

  it('convierte el color de Figma a hex', () => {
    expect(ir.tokens.bg).toBe('#1a1a1a')
  })

  it('junta la tipografía como tupla, no como valores sueltos', () => {
    // Un fontSize sin su lineHeight no es un token, es un valor.
    expect(rawTokens.find((t) => t.kind === 'typography')?.value).toBe('Inter/700/48px/56px')
  })

  it('deduplica valores repetidos y registra dónde se usaron', () => {
    const colors = rawTokens.filter((t) => t.kind === 'color')
    expect(new Set(colors.map((c) => c.value)).size).toBe(colors.length)
    expect(colors[0]!.usedIn.length).toBeGreaterThan(0)
  })
})

describe('distill — frena en vez de adivinar', () => {
  const { ir } = distill(fixture('sin-auto-layout'), SOURCE, OPTS)

  it('marca cada contenedor sin auto-layout como posicionamiento absoluto', () => {
    const abs = ir.warnings.filter((w) => w.code === 'absolute-positioning')
    expect(abs.length).toBeGreaterThan(OPTS.maxAbsoluteNodes)
    expect(abs[0]!.severity).toBe('error')
  })

  it('reporta los layers sin nombrar', () => {
    expect(ir.warnings.some((w) => w.code === 'unnamed-layer')).toBe(true)
  })

  // Esto no se arregla con mejor prompt: se arregla en Figma.
  it('shouldHalt corta la corrida', () => {
    const halt = shouldHalt(ir, OPTS)
    expect(halt.halt).toBe(true)
    expect(halt.reason).toMatch(/no usa auto-layout/)
  })

  it('el frame con auto-layout NO frena', () => {
    const { ir: bueno } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(shouldHalt(bueno, OPTS).halt).toBe(false)
  })
})

describe('distill — hash semántico', () => {
  it('es estable entre corridas del mismo nodo', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const b = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    expect(a.hash).toBe(b.hash)
  })

  it('ignora la metadata: dos fetch en momentos distintos dan el mismo hash', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const b = distill(fixture('hero-auto-layout'), { ...SOURCE, nodeId: '1:1' }, OPTS).ir
    expect(a.hash).toBe(b.hash)
  })

  it('cambia cuando cambia la estructura', () => {
    const a = distill(fixture('hero-auto-layout'), SOURCE, OPTS).ir
    const mutado = fixture('hero-auto-layout')
    mutado.itemSpacing = 48
    expect(distill(mutado, SOURCE, OPTS).ir.hash).not.toBe(a.hash)
  })
})

describe('distill — reducción de contexto', () => {
  // El motivo de existir del IR (Ley 2): que entre en el contexto sin ahogar
  // al modelo en ruido.
  it('el IR pesa mucho menos que el árbol crudo', () => {
    const raw = JSON.stringify(fixture('hero-auto-layout')).length
    const { ir } = distill(fixture('hero-auto-layout'), SOURCE, OPTS)
    expect(JSON.stringify(ir).length).toBeLessThan(raw)
  })
})
