import { describe, it, expect } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { extractXmlFiles, zipXmlFiles } from './archive'

const encode = (s: string) => new TextEncoder().encode(s)
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

describe('extractXmlFiles', () => {
  it('XML solto', () => {
    expect(extractXmlFiles(encode('<a/>'), 'nota.xml')).toEqual([{ name: 'nota.xml', bytes: encode('<a/>') }])
  })

  it('XMLs de um ZIP, inclusive de ZIP dentro do ZIP, ignorando o resto', () => {
    const inner = zipSync({ 'c.xml': encode('<c/>') })
    const outer = zipSync({ 'pasta/a.xml': encode('<a/>'), 'b.XML': encode('<b/>'), 'leia-me.txt': encode('x'), 'dentro.zip': inner })
    const files = extractXmlFiles(outer, '01-09-2026 a 15-09-2026.zip')
    expect(files.map((f) => [f.name, decode(f.bytes)]).sort()).toEqual([
      ['a.xml', '<a/>'],
      ['b.XML', '<b/>'],
      ['c.xml', '<c/>'],
    ])
  })

  it('RAR não é aceito no navegador', () => {
    expect(() => extractXmlFiles(new Uint8Array(4), 'notas.rar')).toThrow(/não suportado/)
  })

  it('ZIP corrompido', () => {
    expect(() => extractXmlFiles(encode('não é zip'), 'notas.zip')).toThrow(/corrompido/)
  })
})

describe('zipXmlFiles', () => {
  it('nome repetido ganha sufixo em vez de sobrescrever', () => {
    const zip = zipXmlFiles([
      { name: 'a.xml', bytes: encode('1') },
      { name: 'a.xml', bytes: encode('2') },
    ])
    const entries = unzipSync(zip)
    expect(Object.keys(entries).sort()).toEqual(['a (2).xml', 'a.xml'])
    expect(decode(entries['a (2).xml'])).toBe('2')
  })
})
