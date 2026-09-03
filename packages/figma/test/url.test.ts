import { describe, it, expect } from 'vitest'
import { parseFigmaUrl, normalizeNodeId } from '../src/url.js'

describe('parseFigmaUrl', () => {
  it('parses a real Figma design URL', () => {
    expect(parseFigmaUrl(
      'https://www.figma.com/design/D7qfUlKnGYUos6EtzFBF64/Some---Website?node-id=3978-35299&m=dev',
    )).toEqual({ fileKey: 'D7qfUlKnGYUos6EtzFBF64', nodeId: '3978:35299' })
  })

  // Figma uses a hyphen in the URL and a colon in the API. Sending the hyphen
  // returns a silent 404 that gets mistaken for a permissions problem.
  it('converts the node-id hyphen to a colon', () => {
    expect(normalizeNodeId('3978-35299')).toBe('3978:35299')
    expect(normalizeNodeId('3978:35299')).toBe('3978:35299')
  })

  it('accepts the older /file/ URLs', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/AbC123/X?node-id=1-2').fileKey).toBe('AbC123')
  })

  it('explains what to do when the node-id is missing', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/design/AbC123/Project'))
      .toThrow(/Copy link to selection/)
  })

  it('fails clearly on garbage', () => {
    expect(() => parseFigmaUrl('not a url')).toThrow(/Could not parse/)
  })
})
