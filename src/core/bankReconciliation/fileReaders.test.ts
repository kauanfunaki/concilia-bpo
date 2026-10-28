import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { workbookRows } from './fileReaders'

function xlsxFile(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Extrato')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('workbookRows', () => {
  it('lê a aba inteira quando o arquivo grava um tamanho de aba menor que o dos dados', () => {
    // O extrato do Itaú em Excel diz A1:F13 numa aba de 4.769 linhas
    const rows = [
      ['Data', 'Lançamento', 'Valor'],
      ['01/12/2025', 'PIX RECEBIDO', 100],
      ['02/12/2025', 'TARIFA', -5],
      ['03/12/2025', 'TED ENVIADA', -40],
    ]
    const zip = XLSX.CFB.read(xlsxFile(rows), { type: 'array' })
    const entry = zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith('xl/worksheets/sheet1.xml'))]
    const xml = new TextDecoder().decode(entry.content as Uint8Array)
    expect(xml).toContain('<dimension ref="A1:C4"/>')
    entry.content = new TextEncoder().encode(xml.replace('<dimension ref="A1:C4"/>', '<dimension ref="A1:B2"/>'))
    const [sheet] = workbookRows(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' }) as Uint8Array)
    expect(sheet.rows).toEqual(rows)
  })

  it('arquivo normal sai como antes, com a coluna vazia do começo', () => {
    // O tamanho gravado começa em A1 e a 1ª célula está em B2: a coluna A continua vindo, vazia
    const [sheet] = workbookRows(xlsxFile([[null], [null, 'Data', 'Valor'], [null, '01/12/2025', 10]]))
    expect(sheet.rows).toEqual([
      [null, 'Data', 'Valor'],
      [null, '01/12/2025', 10],
    ])
  })
})
