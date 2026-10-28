import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildSispagWorkbook, sispagFileName } from './exporter'
import { reconcileSispag } from './matcher'
import { classifyMovement, paymentFamily } from './classify'
import type { ItauMovement, SispagPayment, SispagResult } from '../../types/sispag'

const MARCH = { start: '2025-03-01', end: '2025-03-31' }

function mov(id: string, date: string, description: string, amount: number): ItauMovement {
  return { id, order: Number(id.slice(1)), date, description, counterparty: '', document: '', amount, balance: null, ...classifyMovement(description, amount) }
}

function pay(id: string, date: string, payee: string, amount: number, type: string, status = 'Efetuado'): SispagPayment {
  return { id, row: Number(id.slice(1)) + 19, payee, document: '', type, reference: '', date, amount, status, done: status === 'Efetuado', family: paymentFamily(type) }
}

function result(): SispagResult {
  return reconcileSispag(
    {
      fileName: 'MARCO ITAU.pdf',
      source: 'pdf',
      account: '1234 / 56789-0',
      company: '',
      period: MARCH,
      openingBalance: null,
      closingBalance: null,
      movements: [
        mov('m1', '2025-03-05', 'Sispag Fornecedores TED', -1500),
        mov('m2', '2025-03-05', 'Dev TED 078952 MOT02', 200),
        mov('m3', '2025-03-05', 'Sispag Fornecedores', -99),
      ],
      warnings: [],
    },
    {
      fileName: 'SISPAG.xls',
      company: 'EMPRESA EXEMPLO LTDA',
      cnpj: '99.999.999/0001-99',
      account: '1234 / 56789-0',
      modality: 'Fornecedores / Impostos e tributos',
      period: MARCH,
      payments: [
        pay('p1', '2025-03-05', 'ALFA', 1000, 'TED outro titular'),
        pay('p2', '2025-03-05', 'BETA', 300, 'TED outro titular'),
        pay('p3', '2025-03-05', 'GAMA', 200, 'TED outro titular', 'Não efetuado'),
        pay('p4', '2025-03-06', 'DELTA', 45, 'Boleto Itaú'),
      ],
      fileTotal: null,
      warnings: [],
    }
  )
}

async function roundTrip(): Promise<ExcelJS.Workbook> {
  const workbook = await buildSispagWorkbook(result())
  const reread = new ExcelJS.Workbook()
  await reread.xlsx.load(await workbook.xlsx.writeBuffer())
  return reread
}

function column(ws: ExcelJS.Worksheet, header: string): number {
  const headers = ws.getRow(2).values as unknown[]
  return headers.indexOf(header)
}

describe('buildSispagWorkbook', () => {
  it('abas: resumo, o que conferir, o relatório com a conferência de cada pagamento e o extrato', async () => {
    const workbook = await roundTrip()
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Resumo', 'Para conferir', 'Pagamentos SISPAG', 'Extrato SISPAG'])
  })

  it('cada pagamento do relatório sai com a situação e a linha do extrato', async () => {
    const ws = (await roundTrip()).getWorksheet('Pagamentos SISPAG')!
    const rows = [3, 4, 5, 6].map((r) => ({
      payee: ws.getCell(r, column(ws, 'Favorecido')).value,
      situation: ws.getCell(r, column(ws, 'Conferência')).value,
      line: ws.getCell(r, column(ws, 'Lançamento no Extrato')).value,
    }))
    expect(rows).toEqual([
      { payee: 'ALFA', situation: 'Conciliado', line: 'Sispag Fornecedores TED (lote de 3)' },
      { payee: 'BETA', situation: 'Conciliado', line: 'Sispag Fornecedores TED (lote de 3)' },
      { payee: 'GAMA', situation: 'Devolvido', line: 'Dev TED 078952 MOT02' },
      { payee: 'DELTA', situation: 'Só no SISPAG', line: null },
    ])
    // Linha de totais com SUBTOTAL, que acompanha o filtro
    const total = ws.getCell(7, column(ws, 'Valor')).value as { formula: string }
    expect(total.formula).toMatch(/^SUBTOTAL\(109,/)
  })

  it('"Para conferir" traz as divergências com observação', async () => {
    const ws = (await roundTrip()).getWorksheet('Para conferir')!
    const situations = [3, 4].map((r) => ws.getCell(r, 1).value)
    expect(situations).toEqual(['Só no extrato', 'Só no SISPAG'])
  })

  it('o resumo mostra o fechamento do período', async () => {
    const ws = (await roundTrip()).getWorksheet('Resumo')!
    const labels = new Map<string, unknown>()
    ws.eachRow((row) => labels.set(String(row.getCell(1).value), row.getCell(2).value))
    expect(labels.get('Débitos do SISPAG no extrato')).toBe(1599)
    expect(labels.get('(−) Pagamentos efetuados no relatório')).toBe(1345)
    expect(labels.get('Diferença')).toBe(54)
  })
})

describe('sispagFileName', () => {
  it('mês inteiro vira "03.2025"; período parcial leva as datas', () => {
    expect(sispagFileName({ period: MARCH } as SispagResult)).toBe('Conferência SISPAG_03.2025.xlsx')
    expect(sispagFileName({ period: { start: '2025-03-01', end: '2025-03-15' } } as SispagResult)).toBe('Conferência SISPAG_01.03.2025 a 15.03.2025.xlsx')
  })
})
