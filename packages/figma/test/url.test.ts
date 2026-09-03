import { describe, it, expect } from 'vitest'
import { parseFigmaUrl, normalizeNodeId } from '../src/url.js'

describe('parseFigmaUrl', () => {
  it('parsea una URL real de prolicht', () => {
    expect(parseFigmaUrl(
      'https://www.figma.com/design/D7qfUlKnGYUos6EtzFBF64/Prolicht---Website?node-id=3978-35299&m=dev',
    )).toEqual({ fileKey: 'D7qfUlKnGYUos6EtzFBF64', nodeId: '3978:35299' })
  })

  // Figma usa guión en la URL y dos puntos en la API. Mandar el guión devuelve
  // un 404 silencioso que se confunde con un problema de permisos.
  it('convierte el guión del node-id a dos puntos', () => {
    expect(normalizeNodeId('3978-35299')).toBe('3978:35299')
    expect(normalizeNodeId('3978:35299')).toBe('3978:35299')
  })

  it('acepta las URLs viejas con /file/', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/AbC123/X?node-id=1-2').fileKey).toBe('AbC123')
  })

  it('explica qué hacer cuando falta el node-id', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/design/AbC123/Proyecto'))
      .toThrow(/Copy link to selection/)
  })

  it('falla claro con basura', () => {
    expect(() => parseFigmaUrl('no soy una url')).toThrow(/No pude parsear/)
  })
})
