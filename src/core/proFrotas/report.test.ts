import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildProFrotasWorkbook, formatSources, reportFileName } from './report'
import { validateProFrotas } from './validator'
import type { SheetLine, XmlNote } from '../../types/proFrotas'

const EMPRESA = '11222333000181'
const POSTO = '44555666000172'

let row = 1
function line(noteText: string, amount: number, fuelDate = '2026-09-10'): SheetLine {
  row++
  return {
    source: { file: 'cobranca.xlsx', row },
    noteText,
    series: '1',
    stationCnpj: POSTO,
    stationName: 'Posto Alfa',
    companyCnpj: EMPRESA,
    companyName: 'Transportadora Exemplo',
    fuelDate,
    amount,
    postponed: false,
  }
}

function xml(number: string, amount: number, issueDate = '2026-09-12'): XmlNote {
  return {
    key: `4126094455566600017255001${number.padStart(19, '0')}`,
    number,
    series: '1',
    type: 1,
    issueDate,
    issuerCnpj: POSTO,
    issuerName: 'POSTO ALFA LTDA',
    recipientCnpj: EMPRESA,
    recipientName: 'TRANSPORTADORA EXEMPLO',
    amount,
    fileName: `${number}.xml`,
    items: [],
    cancelled: false,
    cancelledAt: null,
  }
}

async function roundTrip() {
  row = 1
  const result = validateProFrotas(
    [line('NFe10', 100), line('NFe11', 50), line('NFe20, NFe21', 90), line('NFe30', 70), line('NFe40', 15, '2026-06-01')],
    [xml('10', 100), xml('11', 58), xml('20', 60), xml('21', 20), xml('40', 15, '2026-08-15')],
    { companyCnpj: EMPRESA, periodEnd: '2026-09-15', maxDays: 60, tolerance: 1.01 }
  )
  const buffer = await (await buildProFrotasWorkbook(result)).xlsx.writeBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

describe('buildProFrotasWorkbook', () => {
  it('as cinco abas do relatório antigo, na mesma ordem', async () => {
    const workbook = await roundTrip()
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'NFe Idênticas',
      'NFe Divergentes Agrupadas',
      'NFe Divergentes',
      'NFe Canceladas',
      'NFe Não Encontradas',
      'NFe Desconsideradas',
    ])
  })

  it('divergente: valores, diferença em fórmula e totais com SUBTOTAL', async () => {
    const ws = (await roundTrip()).getWorksheet('NFe Divergentes')!
    expect(ws.getCell('A1').value).toBe('NOTAS DIVERGENTES SEM GRUPO')
    expect(ws.getRow(2).values).toEqual([
      undefined, 'Nº Nota', 'Data Abastecimento', 'CNPJ Emitente', 'Posto', 'CNPJ Destinatário', 'Valor XML', 'Valor Planilha', 'Diferença', 'Linhas na Planilha', 'Chave de Acesso', 'Observação',
    ])
    expect(ws.getCell('A3').value).toBe(11)
    expect(ws.getCell('B3').value).toEqual(new Date(Date.UTC(2026, 8, 10)))
    expect(ws.getCell('C3').value).toBe('44.555.666/0001-72')
    expect(ws.getCell('F3').value).toBe(58)
    expect(ws.getCell('G3').value).toBe(50)
    expect(ws.getCell('H3').value).toMatchObject({ formula: 'F3-G3' })
    expect(ws.getCell('I3').value).toBe('linha 3')
    expect(ws.getCell('A4').value).toBe('Qtd Nfe')
    expect(ws.getCell('B4').value).toMatchObject({ formula: 'SUBTOTAL(103,A3:A3)' })
    expect(ws.getCell('F4').value).toMatchObject({ formula: 'SUBTOTAL(109,F3:F3)' })
  })

  it('agrupada leva o número do grupo; desconsiderada, o prazo no título', async () => {
    const workbook = await roundTrip()
    const groups = workbook.getWorksheet('NFe Divergentes Agrupadas')!
    expect([groups.getCell('A3').value, groups.getCell('B3').value, groups.getCell('A4').value, groups.getCell('B4').value]).toEqual([20, 1, 21, 1])
    const disregarded = workbook.getWorksheet('NFe Desconsideradas')!
    expect(disregarded.getCell('A1').value).toBe('NOTAS DESCONSIDERADAS (+60 DIAS POSTERGADAS)')
    expect(disregarded.getCell('A3').value).toBe(40)
    expect(disregarded.getCell('E3').value).toBe(75)
  })

  it('aba sem notas avisa em vez de deixar a tabela vazia', async () => {
    const workbook = await roundTrip()
    const identical = workbook.getWorksheet('NFe Idênticas')!
    expect(identical.getCell('A3').value).toBe(10)
    const workbookEmpty = new ExcelJS.Workbook()
    const empty = await buildProFrotasWorkbook(
      validateProFrotas([], [], { companyCnpj: EMPRESA, periodEnd: '2026-09-15', maxDays: 60, tolerance: 1.01 })
    )
    await workbookEmpty.xlsx.load(await empty.xlsx.writeBuffer())
    expect(workbookEmpty.getWorksheet('NFe Divergentes')!.getCell('A3').value).toBe('Nenhuma nota nesta situação.')
  })
})

describe('peças do relatório', () => {
  it('formatSources resume muitas linhas e nomeia o arquivo quando há mais de um', () => {
    const rows = [257, 260, 264, 265, 266, 267, 268].map((r) => ({ file: 'set.xlsx', row: r }))
    expect(formatSources(rows, false)).toBe('linhas 257, 260, 264, 265, 266 (+2)')
    expect(formatSources([{ file: 'a.xlsx', row: 2 }, { file: 'b.xlsx', row: 9 }], true)).toBe('a.xlsx: linha 2 · b.xlsx: linha 9')
  })

  it('reportFileName', () => {
    expect(reportFileName('2026-09-15')).toBe('Validação Pro Frotas_15.09.2026.xlsx')
  })
})
