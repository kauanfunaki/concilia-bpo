import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { cnpjDigits, parseProFrotasSheets, readProFrotasWorkbook } from './sheet'

// Recorte das colunas do "Relatório Detalhamento da Cobrança", na ordem do arquivo real
const HEADER = ['Período', 'Data Abastecimento', 'CNPJ do Posto', 'Nome do Posto ', 'CNPJ da Empresa', 'Empresa', 'Vlr Total da Transação (R$)', 'Valor no Boleto', 'Número do documento', 'Número da Nota Fiscal', 'Número de Série']

function sheet(rows: unknown[][], firstRow = 1) {
  return [{ sheetName: 'Detalhe Cobrança', rows, firstRow }]
}

describe('parseProFrotasSheets', () => {
  it('acha as colunas pelo título e lê cada lançamento com a linha do Excel', () => {
    const rows = [
      HEADER,
      ['01-15 SET', 46275, '44.555.666/0001-72', 'Posto Alfa', '11.222.333/0001-81', 'Transportadora Exemplo', '160,005', 160.005, '1', 'NFe289', '4'],
      [null, null, null, null, null, null, null, null, null, null, null],
      ['01-15 SET', '11/09/2026', '44.555.666/0001-72', 'Posto Alfa', '11.222.333/0001-81', 'Transportadora Exemplo', '0', 0, '1', '-', '-'],
    ]
    const lines = parseProFrotasSheets(sheet(rows), 'cobranca.xlsx')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      source: { file: 'cobranca.xlsx', row: 2 },
      noteText: 'NFe289',
      series: '4',
      stationCnpj: '44555666000172',
      stationName: 'Posto Alfa',
      companyCnpj: '11222333000181',
      companyName: 'Transportadora Exemplo',
      fuelDate: '2026-09-10',
      amount: 160.005,
    })
    expect(lines[1]).toMatchObject({ source: { row: 4 }, noteText: '-', fuelDate: '2026-09-11', amount: 0 })
  })

  it('título fora da 1ª linha e planilha começando mais abaixo', () => {
    const rows = [['Relatório Pro Frotas'], HEADER, ['', '10/09/2026', '44555666000172', '', '11222333000181', '', '', 'R$ 1.234,56', '', 'NFe7', '']]
    const [only] = parseProFrotasSheets(sheet(rows, 3), 'x.xlsx')
    expect(only).toMatchObject({ source: { row: 5 }, amount: 1234.56, noteText: 'NFe7' })
  })

  it('diz quais colunas faltam', () => {
    const rows = [['Data Abastecimento', 'CNPJ do Posto', 'CNPJ da Empresa', 'Número da Nota Fiscal']]
    expect(() => parseProFrotasSheets(sheet(rows), 'x.xlsx')).toThrow(/Valor no Boleto/)
  })
})

describe('readProFrotasWorkbook', () => {
  it('mantém as linhas em branco, para o número da linha bater com o Excel', () => {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, [], ['', '10/09/2026', '44555666000172', '', '11222333000181', '', '', 10, '', 'NFe1', '']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhe Cobrança')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const [line] = parseProFrotasSheets(readProFrotasWorkbook(data), 'x.xlsx')
    expect(line.source.row).toBe(3)
  })
})

describe('cnpjDigits', () => {
  it.each([
    ['44.555.666/0001-72', '44555666000172'],
    [4555666000172, '04555666000172'],
    [null, ''],
  ])('%j → %j', (input, expected) => {
    expect(cnpjDigits(input)).toBe(expected)
  })
})
