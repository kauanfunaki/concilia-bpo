import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import * as XLSX from 'xlsx'
import { parseFile, getSheetHeaders } from './parser'
import type { UploadedFile } from '../types'

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

/**
 * Cria um File a partir de um workbook XLSX em memória.
 */
function workbookToFile(wb: XLSX.WorkBook, name = 'test.xlsx'): File {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * Cria um workbook sintético com as abas e cabeçalhos fornecidos.
 * Usa aoa_to_sheet para preservar a ordem exata dos cabeçalhos.
 */
function makeWorkbook(sheets: Array<{ name: string; headers: string[] }>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const { name, headers } of sheets) {
    // aoa_to_sheet: primeira linha = cabeçalhos, segunda linha = valores vazios
    const aoa = headers.length > 0 ? [headers, headers.map(() => '')] : [['']]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return wb
}

// ────────────────────────────────────────────────
// Testes unitários — parseFile
// ────────────────────────────────────────────────
describe('parseFile — unitários', () => {
  it('lê arquivo Excel simples e retorna abas e dados', async () => {
    const wb = makeWorkbook([{ name: 'Planilha1', headers: ['CNPJ', 'VALOR'] }])
    const file = workbookToFile(wb)
    const result = await parseFile(file)

    expect(result.name).toBe('test.xlsx')
    expect(result.sheets).toEqual(['Planilha1'])
    expect(result.rawData['Planilha1']).toBeDefined()
  })

  it('preserva o nome do arquivo', async () => {
    const wb = makeWorkbook([{ name: 'Sheet1', headers: ['A'] }])
    const file = workbookToFile(wb, 'meu_arquivo.xlsx')
    const result = await parseFile(file)
    expect(result.name).toBe('meu_arquivo.xlsx')
  })

  it('lança erro para arquivo corrompido', async () => {
    // Começa com magic bytes do ZIP (PK\x03\x04) mas estrutura inválida
    // → XLSX detecta ZIP mas falha ao ler a estrutura interna
    const buf = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0xFF, 0xFF, 0xFF, 0xFF])
    const file = new File([buf], 'corrupto.xlsx')
    await expect(parseFile(file)).rejects.toThrow('Não foi possível ler o arquivo')
  })

  it('lê a aba inteira quando o arquivo grava um tamanho de aba menor que o dos dados', async () => {
    // O extrato do Itaú em Excel diz A1:F13 numa aba de 4.769 linhas
    const ws = XLSX.utils.aoa_to_sheet([['CNPJ', 'VALOR'], ['111', 10], ['222', 20], ['333', 30]])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Plan1')
    const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer), { type: 'array' })
    const entry = zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith('xl/worksheets/sheet1.xml'))]
    const xml = new TextDecoder().decode(entry.content as Uint8Array)
    expect(xml).toContain('<dimension ref="A1:B4"/>')
    entry.content = new TextEncoder().encode(xml.replace('<dimension ref="A1:B4"/>', '<dimension ref="A1:A2"/>'))
    const file = new File([XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' })], 'extrato.xlsx')
    const result = await parseFile(file)
    expect(result.rawData['Plan1']).toEqual([
      { CNPJ: '111', VALOR: 10 },
      { CNPJ: '222', VALOR: 20 },
      { CNPJ: '333', VALOR: 30 },
    ])
  })
})

// ────────────────────────────────────────────────
// Testes unitários — getSheetHeaders
// ────────────────────────────────────────────────
describe('getSheetHeaders — unitários', () => {
  it('retorna cabeçalhos da aba', () => {
    const file: UploadedFile = {
      name: 'test.xlsx',
      sheets: ['Plan1'],
      rawData: {
        Plan1: [{ CNPJ: '12345', VALOR: 100 }],
      },
    }
    expect(getSheetHeaders(file, 'Plan1')).toEqual(['CNPJ', 'VALOR'])
  })

  it('lança erro para aba vazia', () => {
    const file: UploadedFile = {
      name: 'test.xlsx',
      sheets: ['Vazia'],
      rawData: { Vazia: [] },
    }
    expect(() => getSheetHeaders(file, 'Vazia')).toThrow('A aba selecionada não contém dados ou cabeçalhos.')
  })
})

// ────────────────────────────────────────────────
// PBT — Property 4: Parser extrai abas e cabeçalhos corretamente
// Feature: excel-reconciliation, Property 4: Parser extrai abas e cabeçalhos corretamente
// ────────────────────────────────────────────────
describe('PBT — Property 4: parser extrai abas e cabeçalhos', () => {
  // Caracteres inválidos em nomes de abas Excel
  const INVALID_SHEET_CHARS = /[:/\\?*[\]]/g
  const validSheetName = fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => s.replace(INVALID_SHEET_CHARS, '_').trim())
    .filter((s) => s.length > 0 && s.length <= 31)

  it('retorna exatamente N abas para workbook com N abas', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validSheetName, { minLength: 1, maxLength: 5 }),
        async (sheetNames) => {
          // Garantir nomes únicos
          const unique = [...new Set(sheetNames)]
          if (unique.length === 0) return

          const wb = makeWorkbook(unique.map((name) => ({ name, headers: ['A', 'B'] })))
          const file = workbookToFile(wb)
          const result = await parseFile(file)

          expect(result.sheets.length).toBe(unique.length)
          for (const name of unique) {
            expect(result.sheets).toContain(name)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('cabeçalhos retornados correspondem à primeira linha da aba', async () => {
    // Excluir nomes que conflitem com Object.prototype (SheetJS faz mangle desses)
    const RESERVED = new Set(['valueOf', 'toString', 'hasOwnProperty', 'isPrototypeOf',
      'propertyIsEnumerable', 'toLocaleString', 'constructor', '__proto__'])
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 15 })
            .filter((s) => s.trim().length > 0 && !RESERVED.has(s.trim())),
          { minLength: 1, maxLength: 8 }
        ),
        async (headers) => {
          const unique = [...new Set(headers)]
          if (unique.length === 0) return

          const wb = makeWorkbook([{ name: 'Sheet1', headers: unique }])
          const file = workbookToFile(wb)
          const result = await parseFile(file)
          const extracted = getSheetHeaders(result, 'Sheet1')

          // Verifica que os mesmos cabeçalhos estão presentes (SheetJS pode ordenar)
          expect(extracted).toHaveLength(unique.length)
          expect(extracted).toEqual(expect.arrayContaining(unique))
        }
      ),
      { numRuns: 100 }
    )
  })
})
