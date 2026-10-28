import { describe, it, expect } from 'vitest'
import { parseItauPdf } from './itauPdf'
import type { PdfTextItem } from '../bankReconciliation/statementPdf'

// Pedaços de texto como o pdf.js entrega o "extrato mensal" do Itaú: valores alinhados à direita
const H = 7.7
const cell = (page: number, x: number, y: number, text: string): PdfTextItem => ({ page, x, y, width: text.length * 4, height: H, text })
const right = (page: number, edge: number, y: number, text: string): PdfTextItem => ({
  page,
  x: edge - text.length * 4,
  y,
  width: text.length * 4,
  height: H,
  text,
})

// Colunas da página: a posição muda um pouco de uma página para outra, como no PDF real
function columns(page: number, y: number, shift = 0) {
  const at = {
    date: 150.5 + shift,
    description: 207.6 + shift,
    credit: 401.4 + shift,
    debit: 462.2 + shift,
    balance: 552.6 + shift,
  }
  const header = [
    cell(page, at.date, y, 'data'),
    cell(page, at.description, y, 'descrição'),
    cell(page, 357.4 + shift, y, 'entradas R$'),
    cell(page, 426.2 + shift, y, 'saídas R$'),
    cell(page, 520.6 + shift, y, 'saldo R$'),
  ]
  return { at, header }
}

function statementItems({ dropTributos = false } = {}): PdfTextItem[] {
  const p1 = columns(1, 247.6)
  const p2 = columns(2, 749.6, 1.9)
  const row = (page: number, c: typeof p1.at, y: number, date: string | null, description: string, money: Partial<Record<'credit' | 'debit' | 'balance', string>>) => [
    ...(date ? [cell(page, c.date, y, date)] : []),
    cell(page, c.description, y, description),
    ...(money.credit ? [right(page, c.credit, y, money.credit)] : []),
    ...(money.debit ? [right(page, c.debit, y, money.debit)] : []),
    ...(money.balance ? [right(page, c.balance, y, money.balance)] : []),
  ]
  return [
    // ── página 1: cabeçalho, quadro-resumo e legenda na lateral ──
    cell(1, 405.8, 763.7, 'extrato mensal'),
    cell(1, 466.1, 763.6, 'ag 1234 cc 56789-0'),
    cell(1, 514.3, 763.5, 'jan 2025'),
    cell(1, 343.4, 471.9, 'entradas (créditos)'),
    cell(1, 343.4, 462.1, 'Outras entradas'),
    right(1, 555, 462.1, '1.300,50'),
    cell(1, 343.4, 433.1, 'total'),
    right(1, 557, 432.4, '300,50'),
    cell(1, 343.4, 413.4, 'saídas (débitos)'),
    cell(1, 343.4, 373.3, 'total'),
    right(1, 557, 372.6, '2.000,00'),
    cell(1, 56.2, 250.2, 'A = agendamento'),
    ...p1.header,
    ...row(1, p1.at, 230.2, '31/12', 'Saldo anterior', { balance: '1.000,00' }),
    cell(1, 69.1, 230, 'pela Bolsa de Valores'),
    ...row(1, p1.at, 206.5, '02/01', 'Sispag Fornecedores', { debit: '500,00-' }),
    cell(1, 56.2, 199.8, 'G = aplicação programada'),
    ...row(1, p1.at, 196.6, null, 'Sispag Fornecedores TED', { debit: '1.200,00-' }),
    cell(1, 56.2, 189.7, 'P = poupança automática'),
    ...row(1, p1.at, 186.8, null, 'Dev TED 078952 MOT02', { credit: '200,00' }),
    ...row(1, p1.at, 177.0, null, 'Res Aplic Aut Mais', { credit: '1.000,00' }),
    ...row(1, p1.at, 167.1, null, 'Rend Pago Aplic Aut Mais', { credit: '0,50', balance: '500,50' }),
    ...row(1, p1.at, 157.3, null, 'SALDO APLIC AUT MAIS', { balance: '3.000,00' }),
    cell(1, 207.6, 120, 'Este material está disponível na Internet 399622 B001A 06/02/2025'),
    // ── página 2 ──
    cell(2, 406.8, 763.7, 'extrato mensal'),
    cell(2, 466.1, 763.6, 'ag 1234 cc 56789-0'),
    cell(2, 514.3, 763.5, 'jan 2025'),
    ...p2.header,
    ...(dropTributos ? [] : row(2, p2.at, 731.0, '03/01', 'Sispag Tributos', { debit: '300,00-' })),
    ...row(2, p2.at, 721.2, dropTributos ? '03/01' : null, 'PIX TRANSF JOAO LU03/01', { credit: '100,00', balance: '300,50' }),
    ...row(2, p2.at, 711.4, null, 'Saldo em C/C', { balance: '300,50' }),
    ...row(2, p2.at, 701.6, null, 'Saldo final', { balance: '300,50' }),
    cell(2, 209.5, 684, 'totalizador de aplicações automáticas'),
    cell(2, 209.5, 664, 'na conta corrente (1)'),
    right(2, 397.8, 664, '1.000,00'),
    right(2, 460.9, 664, '0,00'),
    // Quadro da aplicação depois do saldo final: tem data e valores, mas não é movimento
    cell(2, 58.1, 600, '02/01'),
    right(2, 300, 600, '1.000,00'),
  ]
}

describe('parseItauPdf', () => {
  it('lê os movimentos pelas colunas do cabeçalho, sem a legenda da lateral', () => {
    const statement = parseItauPdf(statementItems(), 'extrato.pdf')
    expect(statement.movements.map((m) => [m.date, m.description, m.amount, m.balance, m.kind, m.family])).toEqual([
      ['2025-01-02', 'Sispag Fornecedores', -500, null, 'payment', 'supplier'],
      ['2025-01-02', 'Sispag Fornecedores TED', -1200, null, 'payment', 'ted'],
      ['2025-01-02', 'Dev TED 078952 MOT02', 200, null, 'return', null],
      ['2025-01-02', 'Res Aplic Aut Mais', 1000, null, 'other', null],
      ['2025-01-02', 'Rend Pago Aplic Aut Mais', 0.5, 500.5, 'other', null],
      ['2025-01-03', 'Sispag Tributos', -300, null, 'payment', 'tax'],
      ['2025-01-03', 'PIX TRANSF JOAO LU03/01', 100, 300.5, 'other', null],
    ])
  })

  it('agência, conta, mês do extrato e saldos; "31/12" num extrato de janeiro é do ano anterior', () => {
    const statement = parseItauPdf(statementItems(), 'extrato.pdf')
    expect(statement).toMatchObject({
      source: 'pdf',
      account: '1234 / 56789-0',
      period: { start: '2025-01-01', end: '2025-01-31' },
      openingBalance: 1000,
      closingBalance: 300.5,
      warnings: [],
    })
  })

  it('confere a leitura: os totais do quadro-resumo (sem a aplicação automática) e os saldos do dia', () => {
    const statement = parseItauPdf(statementItems({ dropTributos: true }), 'extrato.pdf')
    expect(statement.warnings.join('\n')).toMatch(/saídas lidas \(R\$\s1\.700,00\) não batem com o total de saídas do PDF \(R\$\s2\.000,00\)/)
    expect(statement.warnings.join('\n')).toMatch(/saldo de 03\/01\/2025/)
  })

  it('PDF fora do layout do extrato mensal cai na leitura genérica, com aviso', () => {
    const items = [
      cell(1, 40, 700, 'Data'),
      cell(1, 100, 700, 'Histórico'),
      cell(1, 380, 700, 'Valor'),
      cell(1, 40, 686, '05/03/2025'),
      cell(1, 100, 686, 'SISPAG FORNECEDORES'),
      cell(1, 380, 686, '-150,00'),
    ]
    const statement = parseItauPdf(items, 'outro.pdf')
    expect(statement.warnings[0]).toMatch(/leitura foi genérica/)
    expect(statement.movements.map((m) => [m.date, m.amount, m.kind])).toEqual([['2025-03-05', -150, 'payment']])
  })
})
