import { describe, it, expect } from 'vitest'
import { counterpart, counterpartHeader, indexResult, itemPayments, paymentItems, paymentsForExcel } from './view'
import { reconcileSispag } from './matcher'
import { classifyMovement, paymentFamily } from './classify'
import type { ItauMovement, SispagPayment } from '../../types/sispag'

const APRIL = { start: '2025-04-01', end: '2025-04-30' }

function mov(id: string, date: string, description: string, amount: number): ItauMovement {
  return { id, order: Number(id.slice(1)), date, description, counterparty: '', document: '', amount, balance: null, ...classifyMovement(description, amount) }
}

function pay(id: string, payee: string, amount: number, status = 'Efetuado', document = ''): SispagPayment {
  const type = 'TED outro titular'
  return { id, row: Number(id.slice(1)) + 19, payee, document, type, reference: '', date: '2025-04-07', amount, status, done: status === 'Efetuado', family: paymentFamily(type) }
}

// Lote de TED em duas linhas no dia; uma das TEDs voltou no mesmo dia
function setup() {
  const result = reconcileSispag(
    {
      fileName: 'ABRIL ITAU.pdf',
      source: 'pdf',
      account: '1234 / 56789-0',
      company: '',
      period: APRIL,
      openingBalance: null,
      closingBalance: null,
      movements: [
        mov('m1', '2025-04-07', 'Sispag Fornecedores TED', -2000),
        mov('m2', '2025-04-07', 'Sispag Fornecedores TED', -480.5),
        mov('m3', '2025-04-07', 'Dev TED 311980 MOT05', 891.6),
      ],
      warnings: [],
    },
    {
      fileName: 'SISPAG.xls',
      company: 'EMPRESA EXEMPLO LTDA',
      cnpj: '99.999.999/0001-99',
      account: '1234 / 56789-0',
      modality: 'Fornecedores / Impostos e tributos',
      period: APRIL,
      payments: [
        pay('p1', 'ALFA', 1000, 'Efetuado', '123.456.789-09'),
        pay('p2', '=BETA', 588.9),
        pay('p3', 'GAMA', 891.6, 'Não efetuado'),
      ],
      fileTotal: null,
      warnings: [],
    }
  )
  const index = indexResult(result)
  const debit = result.items.find((i) => i.situation === 'matched')!
  const refund = result.items.find((i) => i.situation === 'returned')!
  return { index, debit, refund }
}

describe('paymentItems', () => {
  it('a TED devolvida está no débito do lote e na devolução', () => {
    const { index, debit, refund } = setup()
    expect(itemPayments(debit, index).map((p) => p.payee)).toEqual(['ALFA', '=BETA', 'GAMA'])
    expect(debit.statementAmount).toBe(2480.5)
    expect(paymentItems('p3', index)).toEqual({ debit, refund })
    expect(paymentItems('p1', index)).toEqual({ debit, refund: null })
  })
})

describe('counterpart', () => {
  it('no débito mostra a devolução; na devolução, o débito', () => {
    const { index, debit, refund } = setup()
    const gama = index.payment.get('p3')!
    expect(counterpartHeader(debit)).toBe('Devolução')
    expect(counterpart(gama, debit, index)).toEqual({ date: '2025-04-07', label: 'Dev TED 311980 MOT05' })
    expect(counterpart(index.payment.get('p1')!, debit, index)).toBeNull()
    expect(counterpartHeader(refund)).toBe('Débito')
    expect(counterpart(gama, refund, index)).toEqual({ date: '2025-04-07', label: '2 linhas · Sispag Fornecedores TED' })
  })
})

describe('paymentsForExcel', () => {
  it('todos os pagamentos, separados por tabulação, com valor de vírgula decimal e a devolução', () => {
    const { index, debit } = setup()
    const lines = paymentsForExcel(itemPayments(debit, index), debit, index).split('\r\n')
    expect(lines).toEqual([
      'Linha no Relatório\tData do Pagamento\tFavorecido\tCPF/CNPJ\tTipo de Pagamento\tStatus SISPAG\tDevolução\tValor',
      '20\t07/04/2025\tALFA\t123.456.789-09\tTED outro titular\tEfetuado\t\t1000,00',
      // "=" no início viraria fórmula no Excel
      '21\t07/04/2025\tBETA\t\tTED outro titular\tEfetuado\t\t588,90',
      '22\t07/04/2025\tGAMA\t\tTED outro titular\tNão efetuado\t07/04/2025 · Dev TED 311980 MOT05\t891,60',
    ])
  })

  it('sem pagamento devolvido, a coluna da devolução não vai', () => {
    const { index, debit } = setup()
    const alfa = index.payment.get('p1')!
    expect(paymentsForExcel([alfa], debit, index).split('\r\n')[0]).not.toContain('Devolução')
  })
})
