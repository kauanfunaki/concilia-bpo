import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  columnSample,
  detectLayout,
  isYes,
  mappingTitles,
  missingRequired,
  parseProFrotasSheets,
  parseSheetLines,
  readProFrotasWorkbook,
  sheetColumns,
} from './sheet'
import type { ProFrotasSheet } from './sheet'

// Recorte das colunas do "Relatório Detalhamento da Cobrança", na ordem do arquivo de set/2025
const HEADER = ['Período', 'Data Abastecimento', 'CNPJ do Posto', 'Nome do Posto ', 'CNPJ da Empresa', 'Empresa', 'Vlr Total da Transação (R$)', 'Valor no Boleto', 'Número do documento', 'Postergado', 'Número da Nota Fiscal', 'Número de Série']

function sheet(rows: unknown[][], firstRow = 1, firstCol = 0, sheetName = 'Detalhe Cobrança'): ProFrotasSheet {
  return { sheetName, rows, firstRow, firstCol }
}

const ROW = ['01-15 SET', 46275, '44.555.666/0001-72', 'Posto Alfa', '11.222.333/0001-81', 'Transportadora Exemplo', '160,005', 160.005, '1', 'Não', 'NFe289', '4']

describe('parseProFrotasSheets', () => {
  it('acha as colunas pelo título e lê cada lançamento com a linha do Excel', () => {
    const rows = [
      HEADER,
      ROW,
      [null, null, null, null, null, null, null, null, null, null, null, null],
      ['01-15 SET', '11/09/2026', '44.555.666/0001-72', 'Posto Alfa', '11.222.333/0001-81', 'Transportadora Exemplo', '0', 0, '1', 'Sim', '-', '-'],
    ]
    const lines = parseProFrotasSheets([sheet(rows)], 'cobranca.xlsx')
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
      postponed: false,
    })
    expect(lines[1]).toMatchObject({ source: { row: 4 }, noteText: '-', fuelDate: '2026-09-11', amount: 0, postponed: true })
  })

  it('título fora da 1ª linha e planilha começando mais abaixo', () => {
    const rows = [['Relatório Pro Frotas'], HEADER, ['', '10/09/2026', '44555666000172', '', '11222333000181', '', '', 'R$ 1.234,56', '', '', 'NFe7', '']]
    const [only] = parseProFrotasSheets([sheet(rows, 3)], 'x.xlsx')
    expect(only).toMatchObject({ source: { row: 5 }, amount: 1234.56, noteText: 'NFe7', postponed: false })
  })

  it('diz quais colunas faltam', () => {
    const rows = [['Data Abastecimento', 'CNPJ do Posto', 'CNPJ da Empresa', 'Número da Nota Fiscal']]
    expect(() => parseProFrotasSheets([sheet(rows)], 'x.xlsx')).toThrow(/Valor no Boleto/)
  })
})

describe('detectLayout', () => {
  it('colunas em outra posição são achadas pelo título (CNPJ da Empresa em H, Postergado em AO, nota em AP)', () => {
    const header: string[] = Array.from({ length: 42 }, (_, i) => `Coluna ${i}`)
    header[3] = 'Data Abastecimento'
    header[5] = 'CNPJ do Posto'
    header[7] = 'CNPJ da Empresa'
    header[39] = 'Valor no Boleto'
    header[40] = 'Postergado'
    header[41] = 'Número da Nota Fiscal'
    const ws = sheet([header])
    const { mapping } = detectLayout([ws])
    const letters = sheetColumns(ws, 0)
    expect({
      companyCnpj: letters[mapping.companyCnpj!].letter,
      postponed: letters[mapping.postponed!].letter,
      note: letters[mapping.note!].letter,
      amount: letters[mapping.amount!].letter,
    }).toEqual({ companyCnpj: 'H', postponed: 'AO', note: 'AP', amount: 'AN' })
  })

  it('escolhe a aba e a linha de título que mais reconhecem campos', () => {
    const resumo = sheet([['Colunas:', 'Mês', 'Ano', 'Empresa']], 1, 0, 'Formatação')
    const detalhe = sheet([['Relatório'], HEADER, ROW], 1, 0, 'Detalhe Cobrança')
    expect(detectLayout([resumo, detalhe])).toMatchObject({ sheetIndex: 1, headerIndex: 1 })
  })

  it('a escolha feita antes (pelo título) vence a pré-seleção padrão; "" desliga o campo', () => {
    const { mapping } = detectLayout([sheet([HEADER])], { amount: 'Vlr Total da Transação (R$)', postponed: '' })
    expect(mapping.amount).toBe(6)
    expect(mapping.postponed).toBeNull()
    expect(mapping.note).toBe(10)
  })

  it('sem nenhum título conhecido: 1ª linha preenchida como título e nada pré-selecionado', () => {
    const layout = detectLayout([sheet([[], ['A', 'B'], [1, 2]])])
    expect(layout.headerIndex).toBe(1)
    expect(missingRequired(layout.mapping).map((f) => f.label)).toEqual([
      'Número da Nota Fiscal', 'Valor no Boleto', 'CNPJ do Posto', 'CNPJ da Empresa', 'Data do Abastecimento',
    ])
  })
})

describe('peças da configuração', () => {
  it('letras das colunas contam a partir de onde a planilha começa', () => {
    expect(sheetColumns(sheet([['x', 'y']], 1, 2), 0).map((c) => `${c.letter}:${c.title}`)).toEqual(['C:x', 'D:y'])
  })

  it('mappingTitles guarda o título escolhido e "" para campo sem coluna', () => {
    const ws = sheet([HEADER])
    const titles = mappingTitles(ws, 0, detectLayout([ws]).mapping)
    expect(titles).toMatchObject({ note: 'Número da Nota Fiscal', amount: 'Valor no Boleto', postponed: 'Postergado' })
  })

  it('exemplo de cada coluna já lido como o campo', () => {
    const ws = sheet([HEADER, ['', 46275, '44555666000172', '', '', '', '', 160.005, '', 'Sim', '-', ''], ['', '', '', '', '', '', '', '', '', 'Não', 'NFe12', '']])
    expect(columnSample(ws, 0, 1, 'fuelDate')).toBe('10/09/2026')
    expect(columnSample(ws, 0, 7, 'amount')).toMatch(/R\$\s160,01/)
    expect(columnSample(ws, 0, 2, 'stationCnpj')).toBe('44.555.666/0001-72')
    expect(columnSample(ws, 0, 9, 'postponed')).toBe('Sim em 1 de 2 linhas')
    expect(columnSample(ws, 0, 10, 'note')).toBe('NFe12')
  })

  it('Postergado conta a planilha inteira, não só o começo', () => {
    const rows: unknown[][] = [HEADER, ...Array.from({ length: 400 }, () => ['', '', '', '', '', '', '', '', '', 'Não']), ['', '', '', '', '', '', '', '', '', 'Sim']]
    expect(columnSample(sheet(rows), 0, 9, 'postponed')).toBe('Sim em 1 de 401 linhas')
  })

  it('parseSheetLines pede as colunas obrigatórias', () => {
    const ws = sheet([HEADER, ROW])
    const { mapping } = detectLayout([ws])
    expect(() => parseSheetLines(ws, 0, { ...mapping, amount: null }, 'x.xlsx')).toThrow(/Valor no Boleto/)
  })

  it.each([['Sim', true], ['SIM', true], [' sim ', true], ['S', true], ['Não', false], ['Nao', false], ['-', false], [null, false]])(
    'Postergado %j → %j',
    (value, expected) => {
      expect(isYes(value)).toBe(expected)
    }
  )
})

describe('readProFrotasWorkbook', () => {
  it('mantém as linhas em branco, para o número da linha bater com o Excel', () => {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, [], ['', '10/09/2026', '44555666000172', '', '11222333000181', '', '', 10, '', 'Não', 'NFe1', '']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhe Cobrança')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const [line] = parseProFrotasSheets(readProFrotasWorkbook(data), 'x.xlsx')
    expect(line.source.row).toBe(3)
  })
})
